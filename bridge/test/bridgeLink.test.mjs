import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
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

// Mirror the desktop app's layout: <account>/<org>/local_<hostSessionId>.json.
function appDir(metaByHost, account = 'acct', org = 'org') {
  const dir = mkdtempSync(join(tmpdir(), 'cb-app-'));
  const inner = join(dir, account, org);
  mkdirSync(inner, { recursive: true });
  for (const [host, meta] of Object.entries(metaByHost)) {
    writeFileSync(join(inner, `${host}.json`), JSON.stringify(meta));
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

test('readRecords groups by the app origin folder, matching the desktop app', () => {
  const sessions = fixtureDir({
    // A worktree session: its cwd is the worktree, but the app filed it under
    // the origin project. The group must follow the origin, not the worktree.
    '1.json': { sessionId: 'aaa', hostSessionId: 'local_h1', cwd: '/x/ai-backend/wt-123' },
    // originCwd absent: fall back to folderPlace.cwd.
    '2.json': { sessionId: 'bbb', hostSessionId: 'local_h2' },
    // A CLI session with no hostSessionId gets no app group.
    '3.json': { sessionId: 'ccc', entrypoint: 'cli', name: 'solo' },
  });
  const app = appDir({
    local_h1: { originCwd: '/Users/me/Desktop/ai-backend', folderPlace: { cwd: '/x/ai-backend/wt-123' } },
    local_h2: { folderPlace: { cwd: '/Users/me/code/dash-boards' } },
  });
  try {
    const map = readRecords(sessions, app);
    assert.equal(map.get('aaa').group, 'ai-backend');
    assert.equal(map.get('bbb').group, 'dash-boards');
    assert.equal(map.get('ccc').group ?? null, null);
  } finally {
    rmSync(sessions, { recursive: true, force: true });
    rmSync(app, { recursive: true, force: true });
  }
});

test('readRecords resolves the user category from the app config', () => {
  const sessions = fixtureDir({
    '1.json': { sessionId: 'aaa', hostSessionId: 'local_h1', name: 'x' },
    '2.json': { sessionId: 'bbb', hostSessionId: 'local_h2', name: 'y' }, // unfiled
    '3.json': { sessionId: 'ccc', entrypoint: 'cli', name: 'z' }, // no hostSessionId
  });
  const cfgDir = mkdtempSync(join(tmpdir(), 'cb-cfg-'));
  const cfg = join(cfgDir, 'claude_desktop_config.json');
  writeFileSync(cfg, JSON.stringify({
    preferences: { epitaxyPrefs: {
      'dframe-group-scopes': {
        'acct/org': {
          groups: [
            { id: 'cg-1', name: 'DEA', mode: 'code' },
            { id: 'cg-2', name: 'Enhancement', mode: 'code' },
          ],
          assignments: { 'code:local_h1': 'cg-1' },
        },
      },
      'dframe-code-sections': {
        'acct/org': { sections: [{ id: 'cg-1', kind: 'manual', name: 'DEA', order: 10 }] },
      },
    } },
  }));
  try {
    const map = readRecords(sessions, '/no/app/dir', cfg);
    assert.equal(map.get('aaa').category, 'DEA');
    assert.equal(map.get('aaa').categoryRank, 10); // from dframe-code-sections order
    assert.equal(map.get('bbb').category ?? null, null); // assigned to nothing
    assert.equal(map.get('ccc').category ?? null, null); // no hostSessionId
  } finally {
    rmSync(sessions, { recursive: true, force: true });
    rmSync(cfgDir, { recursive: true, force: true });
  }
});

test('readRecords leaves category null when the config is missing', () => {
  const sessions = fixtureDir({
    '1.json': { sessionId: 'aaa', hostSessionId: 'local_h1', name: 'x' },
  });
  try {
    const map = readRecords(sessions, '/no/app/dir', '/no/such/config.json');
    assert.equal(map.get('aaa').category ?? null, null);
  } finally {
    rmSync(sessions, { recursive: true, force: true });
  }
});

test('readRecords leaves group null when the app has no metadata dir', () => {
  const sessions = fixtureDir({
    '1.json': { sessionId: 'aaa', hostSessionId: 'local_h1', name: 'x' },
  });
  try {
    const map = readRecords(sessions, '/no/such/app/dir');
    assert.equal(map.get('aaa').group ?? null, null);
  } finally {
    rmSync(sessions, { recursive: true, force: true });
  }
});

test('readRecords labels the launch origin from kind/entrypoint', () => {
  const dir = fixtureDir({
    '1.json': { sessionId: 'aaa', entrypoint: 'claude-desktop', kind: 'interactive' },
    '2.json': { sessionId: 'bbb', entrypoint: 'cli', kind: 'interactive' },
    '3.json': { sessionId: 'ccc', entrypoint: 'cli', kind: 'background' },
    '4.json': { sessionId: 'ddd' }, // no origin signal and nothing else: skipped
  });
  try {
    const map = readRecords(dir);
    assert.equal(map.get('aaa').origin, 'desktop');
    assert.equal(map.get('bbb').origin, 'cli');
    assert.equal(map.get('ccc').origin, 'bg'); // background wins over entrypoint
    assert.equal(map.has('ddd'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
