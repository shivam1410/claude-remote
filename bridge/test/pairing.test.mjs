import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encode, decode, SCHEME, VERSION } from '../src/service/pairing.mjs';
import { seal, open } from '../src/core/crypto.mjs';

const GOOD = {
  key: randomBytes(32),
  uid: 'EXAMPLEUID000000000000000000',
  databaseUrl: 'https://example-default-rtdb.firebaseio.com',
};

test('round trips every field', () => {
  const out = decode(encode(GOOD));
  assert.deepEqual(out.key, GOOD.key);
  assert.equal(out.uid, GOOD.uid);
  assert.equal(out.databaseUrl, GOOD.databaseUrl);
});

test('the decoded key actually decrypts what the Mac sealed', () => {
  const payload = { sessionId: 'a', state: 'waiting_input' };
  const blob = seal(GOOD.key, payload);

  // The phone's side: decode the QR, then open the published blob.
  const { key } = decode(encode(GOOD));
  assert.deepEqual(open(key, blob), payload);
});

test('uses a versioned custom scheme', () => {
  const uri = encode(GOOD);
  assert.ok(uri.startsWith(`${SCHEME}://pair?`));
  assert.ok(uri.includes(`v=${VERSION}`));
});

test('key travels base64url, with no padding to confuse a scanner', () => {
  const uri = encode(GOOD);
  const k = new URLSearchParams(uri.split('?')[1]).get('k');
  assert.equal(k.length, 43);
  assert.ok(!/[+/=]/.test(k), 'key is not base64url-safe');
});

test('strips a trailing slash from the database URL', () => {
  assert.equal(
    decode(encode({ ...GOOD, databaseUrl: `${GOOD.databaseUrl}/` })).databaseUrl,
    GOOD.databaseUrl,
  );
});

test('rejects a key that is not 32 bytes', () => {
  assert.throws(() => encode({ ...GOOD, key: randomBytes(16) }), TypeError);
  assert.throws(() => encode({ ...GOOD, key: 'not a buffer' }), TypeError);
});

test('rejects a missing uid or database URL', () => {
  assert.throws(() => encode({ ...GOOD, uid: '' }), TypeError);
  assert.throws(() => encode({ ...GOOD, databaseUrl: '' }), TypeError);
});

test('refuses a URI from a future version rather than guessing', () => {
  const uri = encode(GOOD).replace('v=1', 'v=2');
  assert.throws(() => decode(uri), /unsupported pairing version 2/);
});

test('refuses a truncated key', () => {
  const uri = encode(GOOD).replace(/k=[^&]+/, 'k=shortkey');
  assert.throws(() => decode(uri), /not 32 bytes/);
});

test('refuses anything that is not a pairing URI', () => {
  assert.throws(() => decode('https://example.com'), /not a pairing URI/);
  assert.throws(() => decode(''), /not a pairing URI/);
  assert.throws(() => decode(undefined), /not a pairing URI/);
});

test('refuses a URI missing the uid', () => {
  const uri = encode(GOOD).replace(/&u=[^&]+/, '');
  assert.throws(() => decode(uri), /missing uid/);
});
