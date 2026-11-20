import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, generateKey } from '../src/core/crypto.mjs';
import { decode, classify, resolveBin, IDLE_STATES, PAYLOAD_VERSION } from '../src/service/inject.mjs';

const key = generateKey();
const now = 1_763_600_000_000;

function node(payload, sealKey = key) {
  return { v: PAYLOAD_VERSION, createdAt: now, blob: seal(sealKey, payload) };
}

function reply(overrides = {}) {
  return { v: PAYLOAD_VERSION, sessionId: 'abc-123', text: 'carry on', ts: now, ...overrides };
}

test('decodes a well-formed reply', () => {
  const result = decode(key, node(reply()), now);
  assert.deepEqual(result, { sessionId: 'abc-123', text: 'carry on', ts: now });
});

test('trims surrounding whitespace from the text', () => {
  assert.equal(decode(key, node(reply({ text: '  go on \n' })), now).text, 'go on');
});

test('rejects a reply sealed with a different key', () => {
  assert.equal(decode(key, node(reply(), generateKey()), now), null);
});

test('rejects a tampered blob rather than returning plaintext', () => {
  const tampered = node(reply());
  const bytes = Buffer.from(tampered.blob, 'base64');
  bytes[bytes.length - 1] ^= 0xff;
  tampered.blob = bytes.toString('base64');
  assert.equal(decode(key, tampered, now), null);
});

test('rejects an unknown payload version', () => {
  assert.equal(decode(key, node(reply({ v: 99 })), now), null);
});

test('rejects empty, whitespace-only, and oversized text', () => {
  assert.equal(decode(key, node(reply({ text: '' })), now), null);
  assert.equal(decode(key, node(reply({ text: '   ' })), now), null);
  assert.equal(decode(key, node(reply({ text: 'x'.repeat(2001) })), now), null);
});

test('rejects a missing or non-string sessionId', () => {
  assert.equal(decode(key, node(reply({ sessionId: '' })), now), null);
  assert.equal(decode(key, node(reply({ sessionId: 42 })), now), null);
});

test('rejects a replayed reply and one from a skewed clock', () => {
  assert.equal(decode(key, node(reply({ ts: now - 25 * 60 * 60 * 1000 })), now), null);
  assert.equal(decode(key, node(reply({ ts: now + 120_000 })), now), null);
});

test('rejects a node with no blob', () => {
  assert.equal(decode(key, {}, now), null);
  assert.equal(decode(key, null, now), null);
});

test('delivers only to an idle session', () => {
  const sessions = new Map([['abc-123', 'waiting_input']]);
  assert.deepEqual(classify(reply(), sessions), { action: 'deliver', reason: 'idle' });
});

test('queues a reply aimed at a running session rather than forking it', () => {
  for (const state of ['running', 'waiting_approval', 'error']) {
    const result = classify(reply(), new Map([['abc-123', state]]));
    assert.equal(result.action, 'queue', `${state} must not be resumed`);
  }
});

test('discards a reply for a session the bridge has never seen', () => {
  assert.equal(classify(reply(), new Map()).action, 'discard');
});

test('discards an undecodable reply', () => {
  assert.equal(classify(null, new Map()).action, 'discard');
});

test('idle set holds only waiting_input', () => {
  assert.deepEqual([...IDLE_STATES], ['waiting_input']);
});

test('resolves the claude binary from the environment, then from HOME', () => {
  assert.equal(resolveBin({ CLAUDE_BRIDGE_CLAUDE_BIN: '/opt/claude' }), '/opt/claude');
  assert.equal(resolveBin({ HOME: '/Users/x' }), '/Users/x/.local/bin/claude');
});

// --- delivery pass -----------------------------------------------------------
// deliverReplies takes its database calls and its spawn as parameters, so the
// exactly-once claim is provable without Firebase or a real session.
const { deliverReplies, sessionStates } = await import('../src/service/index.mjs');

// deliverReplies decodes against the real clock, so these fixtures must be
// stamped now rather than with the fixed timestamp the pure tests use.
const fresh = (overrides = {}) => reply({ ts: Date.now(), ...overrides });

function harness(pending) {
  const deleted = [];
  const ran = [];
  return {
    deleted,
    ran,
    deps: {
      listReplies: async () => pending,
      deleteReply: async (_config, pushId) => {
        deleted.push(pushId);
        delete pending[pushId];
      },
      run: async (payload) => ran.push(payload.text),
    },
  };
}

test('a reply arriving while busy is held, then delivered exactly once', async () => {
  sessionStates.clear();
  sessionStates.set('abc-123', 'running');

  const pending = { push1: node(fresh({ text: 'unblock it' })) };
  const h = harness(pending);

  // Busy: nothing runs, nothing is deleted, the node stays as the queue.
  assert.equal(await deliverReplies({}, key, h.deps), 0);
  assert.deepEqual(h.ran, []);
  assert.deepEqual(h.deleted, []);
  assert.ok(pending.push1, 'the reply must survive for the next pass');

  // Idle: delivered and removed.
  sessionStates.set('abc-123', 'waiting_input');
  assert.equal(await deliverReplies({}, key, h.deps), 1);
  assert.deepEqual(h.ran, ['unblock it']);
  assert.deepEqual(h.deleted, ['push1']);

  // A further pass must not run it again.
  assert.equal(await deliverReplies({}, key, h.deps), 0);
  assert.deepEqual(h.ran, ['unblock it']);
});

test('a second reply in one batch is held until the session is idle again', async () => {
  sessionStates.clear();
  sessionStates.set('abc-123', 'waiting_input');

  const pending = { a: node(fresh({ text: 'first' })), b: node(fresh({ text: 'second' })) };
  const h = harness(pending);

  assert.equal(await deliverReplies({}, key, h.deps), 1);
  assert.deepEqual(h.ran, ['first'], 'resuming makes the session busy again');
  assert.ok(pending.b, 'the second reply waits for the next idle event');
});

test('an undecodable reply is deleted rather than retried forever', async () => {
  sessionStates.clear();
  const pending = { junk: { v: 1, blob: 'not-a-blob' } };
  const h = harness(pending);

  assert.equal(await deliverReplies({}, key, h.deps), 0);
  assert.deepEqual(h.deleted, ['junk']);
});

test('a reply for an unknown session is deleted', async () => {
  sessionStates.clear();
  const pending = { orphan: node(fresh({ sessionId: 'gone' })) };
  const h = harness(pending);

  assert.equal(await deliverReplies({}, key, h.deps), 0);
  assert.deepEqual(h.deleted, ['orphan']);
});
