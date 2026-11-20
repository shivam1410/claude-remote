import test from 'node:test';
import assert from 'node:assert/strict';
import { tick, prunePushes } from '../src/service/index.mjs';

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
      prunePushes: async () => 0,
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
      prunePushes: async () => 0,
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
    prunePushes: async () => 0,
  });
  assert.equal(touched, 4);
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
