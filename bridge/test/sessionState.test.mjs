import test from 'node:test';
import assert from 'node:assert/strict';
import { stateForEvent, projectLabel, fold } from '../src/service/sessionState.mjs';

test('maps hook events to the spec state vocabulary', () => {
  assert.equal(stateForEvent({ event: 'SessionStart' }), 'running');
  assert.equal(stateForEvent({ event: 'PostToolUse' }), 'running');
  assert.equal(stateForEvent({ event: 'Stop' }), 'waiting_input');
  assert.equal(stateForEvent({ event: 'SessionEnd' }), 'done');
  assert.equal(stateForEvent({ event: 'SomethingNew' }), 'running');
});

test('separates a permission prompt from a plain idle wait', () => {
  assert.equal(
    stateForEvent({ event: 'Notification', message: 'Claude needs your permission to use Bash' }),
    'waiting_approval',
  );
  assert.equal(
    stateForEvent({ event: 'Notification', message: 'Waiting for your input' }),
    'waiting_input',
  );
  assert.equal(stateForEvent({ event: 'Notification' }), 'waiting_input');
});

test('project label is the working directory name, never the full path', () => {
  assert.equal(projectLabel('/Users/someone/work/ai-backend'), 'ai-backend');
  assert.equal(projectLabel('/Users/someone/work/ai-backend/'), 'ai-backend');
  assert.equal(projectLabel(''), 'unknown');
  assert.equal(projectLabel(undefined), 'unknown');
});

test('folds a batch to one entry per session, latest event winning', () => {
  const folded = fold([
    { ts: 1, event: 'SessionStart', sessionId: 'a', cwd: '/w/api' },
    { ts: 2, event: 'SessionStart', sessionId: 'b', cwd: '/w/web' },
    { ts: 3, event: 'Notification', sessionId: 'a', message: 'needs permission to use Bash' },
  ]);

  assert.equal(folded.length, 2);
  const a = folded.find((s) => s.sessionId === 'a');
  assert.equal(a.state, 'waiting_approval');
  assert.equal(a.project, 'api');
  assert.equal(a.ended, false);
});

test('carries cwd and transcript path forward when a later event omits them', () => {
  const [session] = fold([
    { ts: 1, event: 'SessionStart', sessionId: 'a', cwd: '/w/api', transcriptPath: '/t.jsonl' },
    { ts: 2, event: 'Stop', sessionId: 'a' },
  ]);
  assert.equal(session.project, 'api');
  assert.equal(session.transcriptPath, '/t.jsonl');
});

test('marks an ended session so the caller deletes it', () => {
  const [session] = fold([
    { ts: 1, event: 'SessionStart', sessionId: 'a', cwd: '/w/api' },
    { ts: 2, event: 'SessionEnd', sessionId: 'a', cwd: '/w/api' },
  ]);
  assert.equal(session.ended, true);
  assert.equal(session.state, 'done');
});

test('ignores records with no session id', () => {
  assert.deepEqual(fold([{ ts: 1, event: 'Stop' }]), []);
});
