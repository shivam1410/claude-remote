#!/usr/bin/env node
// Claude Code hook entrypoint.
//
// Invariant for this file, above everything else: it must never break a
// session. It reads the hook JSON on stdin, drops one small record into the
// spool directory, and exits zero. Every failure path — no stdin, bad JSON,
// unwritable disk, full disk — still exits zero and still exits fast. The
// bridge service drains the spool asynchronously; nothing here touches the
// network, the Keychain, or the transcript.
//
// Nothing secret is written: the spool holds event names, ids, and local paths,
// and lives on this machine only. Redaction and encryption happen in the
// service, before anything leaves the Mac.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SPOOL_DIR = process.env.CLAUDE_BRIDGE_SPOOL
  ?? join(homedir(), '.claude-bridge', 'spool');
const MAX_STDIN_BYTES = 256 * 1024;
const STDIN_TIMEOUT_MS = 500;

/** Read stdin with a hard byte cap and a hard timeout. Resolves '' on any problem. */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(data), STDIN_TIMEOUT_MS);

    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
        if (data.length > MAX_STDIN_BYTES) done(data.slice(0, MAX_STDIN_BYTES));
      });
      process.stdin.on('end', () => done(data));
      process.stdin.on('error', () => done(''));
    } catch {
      done('');
    }
  });
}

/** Pull only the fields the bridge needs. Unknown events still produce a record. */
function toRecord(input) {
  return {
    ts: Date.now(),
    event: input.hook_event_name ?? 'unknown',
    sessionId: input.session_id ?? null,
    cwd: input.cwd ?? null,
    transcriptPath: input.transcript_path ?? null,
    // Present on Notification; this is the text that tells the phone why the
    // session is waiting. It is summarised and scrubbed by the service.
    message: typeof input.message === 'string' ? input.message : null,
    toolName: input.tool_name ?? null,
    reason: input.reason ?? input.stop_hook_active ?? null,
  };
}

async function main() {
  const raw = await readStdin();
  if (!raw) return;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (!input || typeof input !== 'object') return;

  const record = toRecord(input);
  if (!record.sessionId) return;

  // One JSONL file per day keeps the drain simple and bounds file count.
  const day = new Date(record.ts).toISOString().slice(0, 10);
  mkdirSync(SPOOL_DIR, { recursive: true });
  appendFileSync(join(SPOOL_DIR, `${day}.jsonl`), `${JSON.stringify(record)}\n`);
}

// Fail open. Any throw, any rejection, any unexpected state: exit zero, quietly.
try {
  await main();
} catch {
  // Intentionally swallowed: a monitoring hook must never fail the session it
  // monitors. Diagnostics belong in the service, which can report safely.
}
process.exit(0);
