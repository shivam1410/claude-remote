import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/service/config.mjs';

const GOOD = {
  projectId: 'p',
  apiKey: 'k',
  databaseUrl: 'https://x-default-rtdb.asia-southeast1.firebasedatabase.app',
  oauthClientId: 'c',
  oauthClientSecret: 's',
};

test('accepts a complete config and strips a trailing slash', () => {
  const out = validate({ ...GOOD, databaseUrl: `${GOOD.databaseUrl}/` });
  assert.equal(out.databaseUrl, GOOD.databaseUrl);
});

test('names every missing field at once', () => {
  assert.throws(
    () => validate({ projectId: 'p' }),
    /apiKey, databaseUrl, oauthClientId, oauthClientSecret/,
  );
});

test('rejects a blank field rather than failing later at the network', () => {
  assert.throws(() => validate({ ...GOOD, apiKey: '   ' }), /apiKey/);
});

test('accepts a us-central1 firebaseio.com database URL', () => {
  const url = 'https://my-project-default-rtdb.firebaseio.com';
  assert.equal(validate({ ...GOOD, databaseUrl: url }).databaseUrl, url);
  assert.equal(validate({ ...GOOD, databaseUrl: `${url}/` }).databaseUrl, url);
});

test('rejects a database URL that is not a Realtime Database URL', () => {
  assert.throws(() => validate({ ...GOOD, databaseUrl: 'https://console.firebase.google.com/x' }), /databaseUrl/);
  assert.throws(() => validate({ ...GOOD, databaseUrl: 'http://x.firebasedatabase.app' }), /databaseUrl/);
});

test('rejects a non-object', () => {
  assert.throws(() => validate(null), /JSON object/);
});
