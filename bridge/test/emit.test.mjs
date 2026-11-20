import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMIT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hooks', 'emit.mjs');

/** Run the hook with the given stdin and an isolated spool. Resolves { code, spool }. */
function runHook(stdin, { spool = mkdtempSync(join(tmpdir(), 'bridge-spool-')) } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [EMIT],
      { env: { ...process.env, CLAUDE_BRIDGE_SPOOL: spool }, timeout: 5000 },
      (error) => resolve({ code: error?.code ?? 0, spool }),
    );
    child.stdin.end(stdin);
  });
}

function records(spool) {
  return readdirSync(spool)
    .flatMap((f) => readFileSync(join(spool, f), 'utf8').trim().split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('writes one spool record for a Notification event', async () => {
  const { code, spool } = await runHook(JSON.stringify({
    hook_event_name: 'Notification',
    session_id: 'sess-1',
    cwd: '/Users/someone/work/api',
    message: 'Claude needs your permission to use Bash',
  }));

  assert.equal(code, 0);
  const all = records(spool);
  assert.equal(all.length, 1);
  assert.equal(all[0].event, 'Notification');
  assert.equal(all[0].sessionId, 'sess-1');
  assert.ok(all[0].message.includes('permission'));
  assert.ok(typeof all[0].ts === 'number');
  rmSync(spool, { recursive: true, force: true });
});

test('appends further events for the same session', async () => {
  const spool = mkdtempSync(join(tmpdir(), 'bridge-spool-'));
  await runHook(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's' }), { spool });
  await runHook(JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), { spool });

  assert.deepEqual(records(spool).map((r) => r.event), ['SessionStart', 'Stop']);
  rmSync(spool, { recursive: true, force: true });
});

test('exits zero on malformed JSON and writes nothing', async () => {
  const { code, spool } = await runHook('{not json');
  assert.equal(code, 0);
  assert.equal(records(spool).length, 0);
  rmSync(spool, { recursive: true, force: true });
});

test('exits zero on empty stdin', async () => {
  const { code } = await runHook('');
  assert.equal(code, 0);
});

test('exits zero when the event carries no session id', async () => {
  const { code, spool } = await runHook(JSON.stringify({ hook_event_name: 'Stop' }));
  assert.equal(code, 0);
  assert.equal(records(spool).length, 0);
  rmSync(spool, { recursive: true, force: true });
});

test('exits zero when the spool directory cannot be written', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'bridge-ro-'));
  chmodSync(parent, 0o500);
  const { code } = await runHook(
    JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }),
    { spool: join(parent, 'spool') },
  );
  assert.equal(code, 0, 'an unwritable spool must not fail the session');
  chmodSync(parent, 0o700);
  rmSync(parent, { recursive: true, force: true });
});
