import test from 'node:test';
import assert from 'node:assert/strict';
import { tick, prunePushes, pruneStaleSessions, refreshSessions } from '../src/service/index.mjs';
import { seal, open } from '../src/core/crypto.mjs';

const config = { databaseUrl: 'https://example.invalid' };
const key = Buffer.alloc(32, 7);

test('a failing publish still lets replies and decisions through', async () => {
  // The real failure this guards: the pushes path was missing from the
  // deployed rules, so publish threw 401 on every pass. Replies sat in the
  // database undelivered and blocked hooks timed out, with nothing to
  // suggest the two were connected.
  const ran = [];
  await assert.rejects(
    () => tick(config, key, {
      publish: () => { throw new Error('401 Permission denied'); },
      relayDecisions: () => { ran.push('relay'); },
      deliverReplies: () => { ran.push('deliver'); },
      deliverCommands: async () => 0,
      prunePushes: async () => 0,
      pruneStaleSessions: async () => 0,
      refreshSessions: async () => 0,
    }),
    /publish: 401 Permission denied/,
  );
  assert.deepEqual(ran, ['relay', 'deliver']);
});

test('every stage failing is reported in one error, not just the first', async () => {
  await assert.rejects(
    () => tick(config, key, {
      publish: () => { throw new Error('a'); },
      relayDecisions: () => { throw new Error('b'); },
      deliverReplies: () => { throw new Error('c'); },
      deliverCommands: async () => 0,
      prunePushes: async () => 0,
      pruneStaleSessions: async () => 0,
      refreshSessions: async () => 0,
    }),
    (error) => error.message.includes('publish: a')
      && error.message.includes('relayDecisions: b')
      && error.message.includes('deliverReplies: c'),
  );
});

test('a clean pass returns what publish touched', async () => {
  const touched = await tick(config, key, {
    publish: async () => 4,
    relayDecisions: async () => {},
    deliverReplies: async () => {},
    deliverCommands: async () => 0,
    prunePushes: async () => 0,
    pruneStaleSessions: async () => 0,
    refreshSessions: async () => 0,
  });
  assert.equal(touched, 4);
});

test('pruneStaleSessions drops a dead, stale session but keeps live and fresh ones', async () => {
  const now = 1_800_000_000_000;
  const old = now - 11 * 60 * 1000; // past SESSION_TTL_MS (10 min)
  const fresh = now - 60 * 1000; // within it
  const deleted = [];

  const pruned = await pruneStaleSessions(config, {
    listSessions: async () => ({
      dead: { updatedAt: old }, // process gone, stale -> delete
      aliveIdle: { updatedAt: old }, // process alive, stale -> keep
      deadFresh: { updatedAt: fresh }, // process gone, fresh -> keep
      noTs: {}, // process gone, no timestamp -> delete
    }),
    live: () => new Set(['aliveIdle']),
    deleteSession: async (_config, sessionId) => { deleted.push(sessionId); },
    now,
  });

  assert.equal(pruned, 2);
  assert.deepEqual(deleted.sort(), ['dead', 'noTs']);
});

test('refreshSessions catches a live node up with a late Remote Control id', async () => {
  const stale = { v: 1, updatedAt: 123, blob: seal(key, { v: 1, sessionId: 's1', state: 'waiting_input', title: '', origin: '' }) };
  const put = [];

  const n = await refreshSessions(config, key, {
    listSessions: async () => ({ s1: stale }),
    putSession: async (_c, id, node) => put.push([id, node]),
    live: () => new Set(['s1']),
    openUrlFor: (id) => (id === 's1' ? 'https://claude.ai/code/abc' : null),
    nameFor: () => 'Fix thing',
    launchedFrom: () => 'cli',
    groupFor: () => 'ai-backend',
    categoryOf: () => 'DEA',
  });

  assert.equal(n, 1);
  assert.equal(put.length, 1);
  const payload = open(key, put[0][1].blob);
  assert.equal(payload.openUrl, 'https://claude.ai/code/abc');
  assert.equal(payload.title, 'Fix thing');
  assert.equal(payload.origin, 'cli');
  assert.equal(payload.project, 'ai-backend');
  assert.equal(payload.category, 'DEA');
  // The timestamp is preserved so the node does not look freshly touched.
  assert.equal(put[0][1].updatedAt, 123);
});

test('refreshSessions rewrites nothing when the record-derived fields are unchanged', async () => {
  const current = { v: 1, updatedAt: 1, blob: seal(key, { v: 1, sessionId: 's1', state: 'waiting_input', title: 'Fix thing', origin: 'cli', openUrl: 'https://claude.ai/code/abc', project: 'ai-backend', category: 'DEA' }) };
  const put = [];
  const n = await refreshSessions(config, key, {
    listSessions: async () => ({ s1: current }),
    putSession: async (_c, id, node) => put.push([id, node]),
    live: () => new Set(['s1']),
    openUrlFor: () => 'https://claude.ai/code/abc',
    nameFor: () => 'Fix thing',
    launchedFrom: () => 'cli',
    groupFor: () => 'ai-backend',
    categoryOf: () => 'DEA',
  });
  assert.equal(n, 0);
  assert.deepEqual(put, []);
});

test('refreshSessions leaves a dead session alone', async () => {
  const stale = { v: 1, updatedAt: 1, blob: seal(key, { v: 1, sessionId: 'dead', state: 'waiting_input', title: '', origin: '' }) };
  const put = [];
  const n = await refreshSessions(config, key, {
    listSessions: async () => ({ dead: stale }),
    putSession: async (_c, id, node) => put.push([id, node]),
    live: () => new Set(), // nothing alive
    openUrlFor: () => 'https://claude.ai/code/abc',
    nameFor: () => 'name',
    launchedFrom: () => 'cli',
  });
  assert.equal(n, 0);
  assert.deepEqual(put, []);
});

test('prunePushes drops only what has gone stale', async () => {
  // With no consumer deployed this path grew without bound — 46 nodes and
  // climbing, each announcing a moment that had already passed.
  const now = 1_800_000_000_000;
  const pending = {
    fresh: { v: 1, createdAt: now - 60_000, blob: 'x' },
    stale: { v: 1, createdAt: now - 11 * 60_000, blob: 'x' },
    undateable: { v: 1, blob: 'x' },
  };
  const deleted = [];

  const pruned = await prunePushes({}, {
    listPushes: async () => pending,
    deletePush: async (_c, id) => deleted.push(id),
    now,
  });

  assert.equal(pruned, 2);
  assert.deepEqual(deleted.sort(), ['stale', 'undateable']);
});

test('prunePushes copes with an empty queue', async () => {
  assert.equal(await prunePushes({}, { listPushes: async () => null }), 0);
});

test('pickActionable surfaces a Stop even when a later tool call hides it in fold', async () => {
  const { pickActionable } = await import('../src/service/index.mjs');
  // One poll batch: a turn ended (Stop) and the next turn's first tool call
  // arrived. fold would report "running" and the needs-you push would be lost.
  const records = [
    { sessionId: 's1', event: 'PreToolUse', ts: 100 },
    { sessionId: 's1', event: 'Stop', ts: 200 },
    { sessionId: 's1', event: 'PreToolUse', ts: 300 },
  ];
  const act = pickActionable(records);
  assert.equal(act.get('s1').state, 'waiting_input');
  assert.equal(act.get('s1').ts, 200);
});

test('pickActionable keeps the newest actionable when several arrive', async () => {
  const { pickActionable } = await import('../src/service/index.mjs');
  const records = [
    { sessionId: 's1', event: 'Stop', ts: 100 },
    { sessionId: 's1', event: 'Notification', message: 'needs permission', ts: 150 },
  ];
  const act = pickActionable(records);
  assert.equal(act.get('s1').state, 'waiting_approval');
  assert.equal(act.get('s1').ts, 150);
});

test('pickActionable ignores a batch of only running events', async () => {
  const { pickActionable } = await import('../src/service/index.mjs');
  const records = [{ sessionId: 's1', event: 'PreToolUse', ts: 100 }];
  assert.equal(pickActionable(records).size, 0);
});
