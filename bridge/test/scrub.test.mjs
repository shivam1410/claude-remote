import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../src/core/scrub.mjs';

// Fabricated values. None of these are real credentials.
const FAKE_KEY = 'sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH';
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const EMAIL = 'someone@example.com';

test('removes an API key, a JWT, and an email from one message', () => {
  const message = `Deploy failed. Used ${FAKE_KEY} with ${FAKE_JWT}, notified ${EMAIL}.`;
  const out = scrub(message);

  assert.ok(!out.includes(FAKE_KEY), 'api key survived');
  assert.ok(!out.includes(FAKE_JWT), 'jwt survived');
  assert.ok(!out.includes(EMAIL), 'email survived');
  assert.ok(!out.includes('sk-ant'), 'key prefix survived');
  assert.ok(out.startsWith('Deploy failed.'), 'surrounding prose was lost');
});

test('removes an AWS key id and a bearer token', () => {
  const out = scrub('Authorization: Bearer abcdefgh12345678 for AKIAIOSFODNN7EXAMPLE');
  assert.ok(!out.includes('abcdefgh12345678'));
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'));
});

test('removes a long hex digest', () => {
  const digest = 'a'.repeat(40);
  assert.ok(!scrub(`sha ${digest}`).includes(digest));
});

test('removes a private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
  assert.ok(!scrub(pem).includes('MIIEow'));
});

test('leaves ordinary prose untouched', () => {
  const prose = 'Refactored the authentication middleware and added two tests.';
  assert.equal(scrub(prose), prose);
});

test('returns an empty string for non-string input', () => {
  assert.equal(scrub(undefined), '');
  assert.equal(scrub(null), '');
});
