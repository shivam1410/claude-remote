import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalise, isEnrolled, isFlagged, shouldWait, decisionOutput,
  DEFAULT_TOOLS, DEFAULT_TIMEOUT_MS,
} from '../src/core/approval.mjs';

// --- policy ------------------------------------------------------------------

test('an absent or malformed settings file enrols nothing', () => {
  for (const raw of [null, undefined, 'nonsense', 42]) {
    const settings = normalise(raw);
    assert.deepEqual(settings.sessions, []);
    assert.equal(isEnrolled(settings, { sessionId: 's', cwd: '/w' }), false);
  }
});

test('tools default to Bash, Write and Edit but an explicit empty list wins', () => {
  assert.deepEqual(normalise({}).tools, DEFAULT_TOOLS);
  assert.deepEqual(normalise({ tools: [] }).tools, []);
  assert.deepEqual(normalise({ tools: ['Bash', 7, ''] }).tools, ['Bash']);
});

test('the timeout is clamped so a typo cannot stall a session', () => {
  assert.equal(normalise({}).timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(normalise({ timeoutMs: 0 }).timeoutMs, 1000);
  assert.equal(normalise({ timeoutMs: -5 }).timeoutMs, 1000);
  assert.equal(normalise({ timeoutMs: 10 ** 9 }).timeoutMs, 60_000);
  assert.equal(normalise({ timeoutMs: 'soon' }).timeoutMs, DEFAULT_TIMEOUT_MS);
});

test('a session enrols by id or by working directory', () => {
  const byId = normalise({ sessions: ['sess-1'] });
  assert.equal(isEnrolled(byId, { sessionId: 'sess-1', cwd: '/w/api' }), true);
  assert.equal(isEnrolled(byId, { sessionId: 'sess-2', cwd: '/w/api' }), false);

  const byDir = normalise({ sessions: ['/w/api/'] });
  assert.equal(isEnrolled(byDir, { sessionId: 'any', cwd: '/w/api' }), true);
  assert.equal(isEnrolled(byDir, { sessionId: 'any', cwd: '/w/api-other' }), false);
  assert.equal(isEnrolled(byDir, { sessionId: 'any', cwd: null }), false);
});

test('only a listed tool is flagged', () => {
  const settings = normalise({ tools: ['Bash'], sessions: ['s'] });
  assert.equal(isFlagged(settings, 'Bash'), true);
  assert.equal(isFlagged(settings, 'Read'), false);
  assert.equal(isFlagged(settings, null), false);
});

test('the hook waits only when enrolled, flagged, and the service is alive', () => {
  const settings = normalise({ tools: ['Bash'], sessions: ['sess-1'] });
  const input = { sessionId: 'sess-1', cwd: '/w', toolName: 'Bash' };

  assert.equal(shouldWait(settings, input, 500), true);
  assert.equal(shouldWait(settings, input, 60_000), false, 'stale heartbeat: do not wait');
  assert.equal(shouldWait(settings, input, Infinity), false, 'no service: do not wait');
  assert.equal(shouldWait(settings, { ...input, toolName: 'Read' }, 500), false);
  assert.equal(shouldWait(settings, { ...input, sessionId: 'other' }, 500), false);
});

test('anything that is not an explicit allow or deny becomes ask', () => {
  assert.equal(decisionOutput({ decision: 'allow' }).hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(decisionOutput({ decision: 'deny' }).hookSpecificOutput.permissionDecision, 'deny');
  for (const raw of [null, {}, { decision: 'maybe' }, { decision: true }]) {
    assert.equal(decisionOutput(raw).hookSpecificOutput.permissionDecision, 'ask');
  }
  assert.equal(decisionOutput({ decision: 'allow' }).hookSpecificOutput.hookEventName, 'PreToolUse');
});

// --- the hook, end to end ----------------------------------------------------

const EMIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hooks', 'emit.mjs');

function makeHome({ approvals, heartbeat = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bridge-home-'));
  if (approvals) writeFileSync(join(home, 'approvals.json'), JSON.stringify(approvals));
  if (heartbeat) writeFileSync(join(home, 'heartbeat'), '');
  return home;
}

function runHook(home, input) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [EMIT],
      { env: { ...process.env, CLAUDE_BRIDGE_HOME: home }, timeout: 20_000 },
      (error, stdout) => resolve({
        code: error?.code ?? 0,
        stdout: String(stdout ?? ''),
        elapsed: Date.now() - started,
      }),
    );
    child.stdin.end(JSON.stringify(input));
  });
}

function spooled(home) {
  const dir = join(home, 'spool');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').trim().split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const preToolUse = {
  hook_event_name: 'PreToolUse',
  session_id: 'sess-1',
  cwd: '/w/api',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf build' },
};

test('an unanswered request falls back to ask within its timeout', async () => {
  const home = makeHome({ approvals: { tools: ['Bash'], sessions: ['sess-1'], timeoutMs: 1000 } });
  const { code, stdout, elapsed } = await runHook(home, preToolUse);

  assert.equal(code, 0, 'the hook must always exit zero');
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'ask');
  assert.ok(elapsed < 6000, `must not block indefinitely, took ${elapsed}ms`);
  assert.ok(elapsed >= 900, `must actually wait for the phone, took ${elapsed}ms`);
  rmSync(home, { recursive: true, force: true });
});

test('a decision written while the hook waits is honoured and consumed', async () => {
  const home = makeHome({ approvals: { tools: ['Bash'], sessions: ['sess-1'], timeoutMs: 8000 } });
  const pending = runHook(home, preToolUse);

  // The request id is generated inside the hook, so watch the spool for it.
  let requestId;
  for (let i = 0; i < 100 && !requestId; i += 1) {
    requestId = spooled(home).find((r) => r.requestId)?.requestId;
    if (!requestId) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(requestId, 'the hook must spool a request before waiting');

  mkdirSync(join(home, 'decisions'), { recursive: true });
  writeFileSync(join(home, 'decisions', `${requestId}.json`), JSON.stringify({ decision: 'allow' }));

  const { code, stdout } = await pending;
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(existsSync(join(home, 'decisions', `${requestId}.json`)), false, 'answered once');
  rmSync(home, { recursive: true, force: true });
});

test('a session that is not enrolled is not delayed and prints nothing', async () => {
  const home = makeHome({ approvals: { tools: ['Bash'], sessions: [], timeoutMs: 8000 } });
  const { code, stdout, elapsed } = await runHook(home, preToolUse);

  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.ok(elapsed < 2000, `no enrolment must mean no wait, took ${elapsed}ms`);
  assert.equal(spooled(home).length, 1, 'the event is still recorded');
  rmSync(home, { recursive: true, force: true });
});

test('a dead service means no wait, whatever the settings say', async () => {
  const home = makeHome({
    approvals: { tools: ['Bash'], sessions: ['sess-1'], timeoutMs: 8000 },
    heartbeat: false,
  });
  const { code, stdout, elapsed } = await runHook(home, preToolUse);

  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.ok(elapsed < 2000, `a stale heartbeat must cost nothing, took ${elapsed}ms`);
  rmSync(home, { recursive: true, force: true });
});

test('the spooled request carries the command, capped', async () => {
  const home = makeHome({ approvals: { tools: ['Bash'], sessions: [] } });
  await runHook(home, { ...preToolUse, tool_input: { command: 'x'.repeat(900) } });

  const record = spooled(home)[0];
  assert.equal(record.toolName, 'Bash');
  assert.equal(record.toolDetail.length, 500);
  rmSync(home, { recursive: true, force: true });
});

// --- the service relay -------------------------------------------------------

const { relayDecisions } = await import('../src/service/index.mjs');
const { seal, generateKey } = await import('../src/core/crypto.mjs');

const key = generateKey();
const now = Date.now();

function relayHarness(pending) {
  const written = [];
  const deleted = [];
  return {
    written,
    deleted,
    deps: {
      listApprovals: async () => pending,
      deleteApproval: async (_c, id) => deleted.push(id),
      writeDecision: (id, decision) => written.push([id, decision]),
      now,
    },
  };
}

test('an answered approval reaches the waiting hook and is then removed', async () => {
  const h = relayHarness({
    req1: { v: 1, createdAt: now, blob: 'x', decisionBlob: seal(key, { decision: 'deny', reason: 'not now' }) },
  });

  assert.equal(await relayDecisions({}, key, h.deps), 1);
  assert.deepEqual(h.written, [['req1', { decision: 'deny', reason: 'not now' }]]);
  assert.deepEqual(h.deleted, ['req1']);
});

test('a decision sealed with another key is dropped, not written', async () => {
  const h = relayHarness({
    req1: { v: 1, createdAt: now, blob: 'x', decisionBlob: seal(generateKey(), { decision: 'allow' }) },
  });

  assert.equal(await relayDecisions({}, key, h.deps), 0);
  assert.deepEqual(h.written, [], 'a forged allow must never reach a session');
  assert.deepEqual(h.deleted, ['req1']);
});

test('an unanswered request is kept while the hook could still be waiting', async () => {
  const h = relayHarness({ req1: { v: 1, createdAt: now - 1000, blob: 'x' } });

  assert.equal(await relayDecisions({}, key, h.deps), 0);
  assert.deepEqual(h.deleted, []);
});

test('an unanswered request is pruned once its hook has given up', async () => {
  const h = relayHarness({ req1: { v: 1, createdAt: now - 10 * 60 * 1000, blob: 'x' } });

  assert.equal(await relayDecisions({}, key, h.deps), 0);
  assert.deepEqual(h.deleted, ['req1']);
});
