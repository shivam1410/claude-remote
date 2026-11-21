import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLinks, readRecords, liveSessionIds } from '../src/service/bridgeLink.mjs';

function fixtureDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cb-links-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

test('maps sessionId to bridgeSessionId only when connected', () => {
  const dir = fixtureDir({
    '1.json': { sessionId: 'aaa', bridgeSessionId: 'session_01' },
    '2.json': { sessionId: 'bbb' }, // not remote-controlled
    '3.json': { sessionId: 'ccc', bridgeSessionId: '' }, // empty counts as none
  });
  try {
    const map = readLinks(dir);
    assert.equal(map.get('aaa'), 'session_01');
    assert.equal(map.has('bbb'), false);
    assert.equal(map.has('ccc'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one unreadable file does not lose the others', () => {
  const dir = fixtureDir({
    'good.json': { sessionId: 'aaa', bridgeSessionId: 'session_01' },
    'broken.json': '{ not json',
    'notjson.txt': 'ignored',
  });
  try {
    const map = readLinks(dir);
    assert.equal(map.get('aaa'), 'session_01');
    assert.equal(map.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing directory is empty, not an error', () => {
  assert.equal(readLinks('/no/such/dir/anywhere').size, 0);
});

test('liveSessionIds keeps only sessions whose pid is alive', () => {
  const dir = fixtureDir({
    '1.json': { sessionId: 'aaa', pid: 111 },
    '2.json': { sessionId: 'bbb', pid: 222 }, // pid dead
    '3.json': { sessionId: 'ccc' }, // no pid: cannot be confirmed alive
    'bad.json': '{ not json',
  });
  try {
    const alive = liveSessionIds(dir, (pid) => pid === 111);
    assert.equal(alive.has('aaa'), true);
    assert.equal(alive.has('bbb'), false);
    assert.equal(alive.has('ccc'), false);
    assert.equal(alive.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readRecords carries the title even without a bridge id', () => {
  const dir = fixtureDir({
    '1.json': { sessionId: 'aaa', name: 'Fix auth bug', bridgeSessionId: 'session_01' },
    '2.json': { sessionId: 'bbb', name: 'Local only session' }, // named, not remote
    '3.json': { sessionId: 'ccc' }, // neither name nor bridge id: skipped
  });
  try {
    const map = readRecords(dir);
    assert.equal(map.get('aaa').title, 'Fix auth bug');
    assert.equal(map.get('aaa').bridgeSessionId, 'session_01');
    assert.equal(map.get('bbb').title, 'Local only session');
    assert.equal(map.get('bbb').bridgeSessionId, null);
    assert.equal(map.has('ccc'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
