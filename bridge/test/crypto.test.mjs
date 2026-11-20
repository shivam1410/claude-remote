import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, generateKey, constants } from '../src/core/crypto.mjs';

test('round trips a payload', () => {
  const key = generateKey();
  const payload = { sessionId: 'abc-123', state: 'waiting_input', turn: 7 };
  assert.deepEqual(open(key, seal(key, payload)), payload);
});

test('every seal uses a fresh nonce', () => {
  const key = generateKey();
  assert.notEqual(seal(key, { a: 1 }), seal(key, { a: 1 }));
});

test('a tampered byte throws instead of returning plaintext', () => {
  const key = generateKey();
  const raw = Buffer.from(seal(key, { secret: 'visible' }), 'base64');
  // Flip a bit inside the ciphertext, past the nonce and before the tag.
  raw[constants.NONCE_BYTES] ^= 0x01;
  assert.throws(() => open(key, raw.toString('base64')));
});

test('a tampered tag throws', () => {
  const key = generateKey();
  const raw = Buffer.from(seal(key, { a: 1 }), 'base64');
  raw[raw.length - 1] ^= 0x01;
  assert.throws(() => open(key, raw.toString('base64')));
});

test('the wrong key throws', () => {
  const blob = seal(generateKey(), { a: 1 });
  assert.throws(() => open(generateKey(), blob));
});

test('a truncated blob throws', () => {
  assert.throws(() => open(generateKey(), Buffer.alloc(8).toString('base64')));
});

test('a key of the wrong length is rejected', () => {
  assert.throws(() => seal(Buffer.alloc(16), { a: 1 }), TypeError);
});
