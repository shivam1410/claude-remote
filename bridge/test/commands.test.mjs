import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../src/service/commands.mjs';
import { seal } from '../src/core/crypto.mjs';

const key = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 9);
const now = 1_800_000_000_000;

function node(payload, createdAt = now, sealKey = key) {
  return { v: 1, createdAt, blob: seal(sealKey, payload) };
}

test('decode accepts a well-formed start command', () => {
  const cmd = decode(key, node({ v: 1, action: 'start', prompt: '  build x  ', project: 'repo' }), now);
  assert.deepEqual(cmd, { action: 'start', prompt: 'build x', project: 'repo' });
});

test('decode rejects an unknown action', () => {
  assert.equal(decode(key, node({ v: 1, action: 'nuke', prompt: 'x' }), now), null);
});

test('decode rejects an empty or oversize prompt', () => {
  assert.equal(decode(key, node({ v: 1, action: 'start', prompt: '   ' }), now), null);
  const long = 'a'.repeat(2001);
  assert.equal(decode(key, node({ v: 1, action: 'start', prompt: long }), now), null);
});

test('decode rejects a command sealed with another key', () => {
  assert.equal(decode(key, node({ v: 1, action: 'start', prompt: 'x' }, now, other), now), null);
});

test('decode rejects a stale command', () => {
  const old = now - 25 * 60 * 60 * 1000;
  assert.equal(decode(key, node({ v: 1, action: 'start', prompt: 'x' }, old), now), null);
});

test('decode defaults project to empty when absent', () => {
  const cmd = decode(key, node({ v: 1, action: 'start', prompt: 'x' }), now);
  assert.equal(cmd.project, '');
});
