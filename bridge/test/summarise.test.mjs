import test from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../src/core/summarise.mjs';

test('a message that is mostly a code block yields prose, not code', () => {
  const message = [
    'Fixed the token expiry check.',
    '```js',
    'if (now <= token.expiresAt) { return token; }',
    'const refreshed = await refresh(token);',
    '```',
    'Tests pass now.',
  ].join('\n');

  const out = summarise(message);
  assert.ok(!out.includes('token.expiresAt'), 'code leaked into the summary');
  assert.ok(!out.includes('```'), 'fence leaked into the summary');
  assert.ok(out.includes('Fixed the token expiry check.'));
});

test('never exceeds the 200 character cap', () => {
  const out = summarise(`${'word '.repeat(200)}.`);
  assert.ok(out.length <= 200, `got ${out.length} chars`);
});

test('scrubs secrets that survive the prose extraction', () => {
  const out = summarise('Rotated the key to sk-ant-api03-ZZZZYYYYXXXXWWWWVVVVUUUUTTTTSSSS today.');
  assert.ok(!out.includes('sk-ant'));
  assert.ok(out.includes('Rotated the key'));
});

test('drops file paths and URLs', () => {
  const out = summarise('Edited /Users/someone/work/secret-project/src/main.ts and opened https://internal.example.com/x');
  assert.ok(!out.includes('secret-project'));
  assert.ok(!out.includes('internal.example.com'));
});

test('returns an empty string for a code-only message', () => {
  assert.equal(summarise('```\nconst x = 1;\n```'), '');
});

test('returns an empty string for empty input', () => {
  assert.equal(summarise(''), '');
  assert.equal(summarise(undefined), '');
});
