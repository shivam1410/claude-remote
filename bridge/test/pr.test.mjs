import test from 'node:test';
import assert from 'node:assert/strict';
import { prFor, _resetPrCache } from '../src/service/pr.mjs';

// A fake gh runner whose callback fires synchronously, so the cache is filled
// by the time prFor returns on the first (miss) call.
function fakeGh(result) {
  return (_cmd, _args, _opts, cb) => cb(result.error ?? null, result.stdout ?? '');
}

test('prFor returns null on the miss, then the cached PR', () => {
  _resetPrCache();
  const run = fakeGh({
    stdout: JSON.stringify({ number: 7, state: 'OPEN', url: 'https://github.com/o/r/pull/7' }),
  });
  assert.equal(prFor('/repo', 'feat', { run, now: 1000 }), null); // miss
  assert.deepEqual(prFor('/repo', 'feat', { run, now: 1500 }), {
    number: 7,
    state: 'OPEN',
    url: 'https://github.com/o/r/pull/7',
  });
});

test('prFor yields null when gh fails (no PR for the branch)', () => {
  _resetPrCache();
  const run = fakeGh({ error: new Error('no pull requests found') });
  assert.equal(prFor('/repo', 'nopr', { run, now: 1000 }), null);
  assert.equal(prFor('/repo', 'nopr', { run, now: 1500 }), null);
});

test('prFor needs both a repo root and a branch', () => {
  assert.equal(prFor('', 'x'), null);
  assert.equal(prFor('/repo', ''), null);
});
