import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drain, readCursor, writeCursor } from '../src/service/spool.mjs';

function spoolWith(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-drain-'));
  writeFileSync(join(dir, '2026-11-20.jsonl'), lines);
  return dir;
}

test('reads every complete record', () => {
  const dir = spoolWith(
    `${JSON.stringify({ ts: 1, event: 'SessionStart', sessionId: 'a' })}\n` +
    `${JSON.stringify({ ts: 2, event: 'Stop', sessionId: 'a' })}\n`,
  );
  const { records } = drain(dir, {});
  assert.deepEqual(records.map((r) => r.event), ['SessionStart', 'Stop']);
  rmSync(dir, { recursive: true, force: true });
});

test('does not replay records already consumed', () => {
  const dir = spoolWith(`${JSON.stringify({ ts: 1, event: 'Stop', sessionId: 'a' })}\n`);
  const first = drain(dir, {});
  assert.equal(first.records.length, 1);

  const second = drain(dir, first.cursor);
  assert.equal(second.records.length, 0, 'records were replayed');
  rmSync(dir, { recursive: true, force: true });
});

test('picks up records appended after the last drain', () => {
  const dir = spoolWith(`${JSON.stringify({ ts: 1, event: 'Stop', sessionId: 'a' })}\n`);
  const first = drain(dir, {});
  appendFileSync(
    join(dir, '2026-11-20.jsonl'),
    `${JSON.stringify({ ts: 2, event: 'SessionEnd', sessionId: 'a' })}\n`,
  );

  const second = drain(dir, first.cursor);
  assert.deepEqual(second.records.map((r) => r.event), ['SessionEnd']);
  rmSync(dir, { recursive: true, force: true });
});

test('leaves a half-written trailing line for the next pass', () => {
  const dir = spoolWith(
    `${JSON.stringify({ ts: 1, event: 'Stop', sessionId: 'a' })}\n{"ts":2,"event":"Session`,
  );
  const first = drain(dir, {});
  assert.equal(first.records.length, 1);

  // The writer finishes the line.
  writeFileSync(
    join(dir, '2026-11-20.jsonl'),
    `${JSON.stringify({ ts: 1, event: 'Stop', sessionId: 'a' })}\n` +
    `${JSON.stringify({ ts: 2, event: 'SessionEnd', sessionId: 'a' })}\n`,
  );
  const second = drain(dir, first.cursor);
  assert.deepEqual(second.records.map((r) => r.event), ['SessionEnd']);
  rmSync(dir, { recursive: true, force: true });
});

test('restarts from zero when a file shrinks', () => {
  const dir = spoolWith(`${JSON.stringify({ ts: 9, event: 'Stop', sessionId: 'a' })}\n`);
  const { records } = drain(dir, { '2026-11-20.jsonl': 99999 });
  assert.equal(records.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('skips a malformed line without losing the rest', () => {
  const dir = spoolWith(
    `not json\n${JSON.stringify({ ts: 1, event: 'Stop', sessionId: 'a' })}\n`,
  );
  assert.equal(drain(dir, {}).records.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('returns records in timestamp order across files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-drain-'));
  writeFileSync(join(dir, '2026-11-19.jsonl'), `${JSON.stringify({ ts: 5, event: 'Stop', sessionId: 'a' })}\n`);
  writeFileSync(join(dir, '2026-11-20.jsonl'), `${JSON.stringify({ ts: 1, event: 'SessionStart', sessionId: 'a' })}\n`);

  assert.deepEqual(drain(dir, {}).records.map((r) => r.ts), [1, 5]);
  rmSync(dir, { recursive: true, force: true });
});

test('a missing or corrupt cursor file reads as empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-cursor-'));
  const path = join(dir, 'cursor.json');
  assert.deepEqual(readCursor(path), {});

  writeFileSync(path, 'garbage');
  assert.deepEqual(readCursor(path), {});

  writeCursor(path, { 'a.jsonl': 10 });
  assert.deepEqual(readCursor(path), { 'a.jsonl': 10 });
  rmSync(dir, { recursive: true, force: true });
});
