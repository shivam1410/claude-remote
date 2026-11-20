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

// --- push rule (D10) ---------------------------------------------------------
import { shouldPush, PUSH_STATES } from '../src/service/sessionState.mjs';

test('pushes when a session starts needing the user or finishes', () => {
  assert.equal(shouldPush('running', 'waiting_input'), true);
  assert.equal(shouldPush('running', 'waiting_approval'), true);
  assert.equal(shouldPush('running', 'done'), true);
  assert.equal(shouldPush('running', 'error'), true);
});

test('never pushes for work simply carrying on', () => {
  assert.equal(shouldPush('waiting_input', 'running'), false);
  assert.equal(shouldPush(undefined, 'running'), false);
});

test('does not push twice for the same state', () => {
  assert.equal(shouldPush('waiting_input', 'waiting_input'), false);
  assert.equal(shouldPush('done', 'done'), false);
});

test('pushes on a first sighting that already needs the user', () => {
  assert.equal(shouldPush(undefined, 'waiting_input'), true);
});

test('push states are exactly the ones D10 names', () => {
  assert.deepEqual([...PUSH_STATES].sort(), ['done', 'error', 'waiting_approval', 'waiting_input']);
});

test('projectLabel names the repository, not the subdirectory you happen to be in', () => {
  // A session working in a subdirectory was labelled by that subdirectory —
  // "android" instead of the project — which is useless on a phone listing
  // several sessions at once.
  const isRepoRoot = (dir) => dir === '/Users/me/code/my-project';
  assert.equal(projectLabel('/Users/me/code/my-project/android/app', isRepoRoot), 'my-project');
  assert.equal(projectLabel('/Users/me/code/my-project', isRepoRoot), 'my-project');
});

test('projectLabel falls back to the leaf outside a repository', () => {
  const never = () => false;
  assert.equal(projectLabel('/tmp/scratch/deep', never), 'deep');
  assert.equal(projectLabel('', never), 'unknown');
  assert.equal(projectLabel(undefined, never), 'unknown');
});
