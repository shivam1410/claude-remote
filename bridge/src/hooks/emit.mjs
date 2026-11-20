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
import { appendFileSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalise, shouldWait, decisionOutput } from '../core/approval.mjs';

const HOME = process.env.CLAUDE_BRIDGE_HOME ?? join(homedir(), '.claude-bridge');
const SPOOL_DIR = process.env.CLAUDE_BRIDGE_SPOOL ?? join(HOME, 'spool');
const APPROVALS_PATH = join(HOME, 'approvals.json');
const DECISIONS_DIR = join(HOME, 'decisions');
const HEARTBEAT_PATH = join(HOME, 'heartbeat');
const MAX_STDIN_BYTES = 256 * 1024;
const STDIN_TIMEOUT_MS = 500;
const POLL_INTERVAL_MS = 150;

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

/** Read and parse a small JSON file. Returns null on any problem. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Milliseconds since the service last touched its heartbeat, or Infinity. */
function heartbeatAge() {
  try {
    return Date.now() - statSync(HEARTBEAT_PATH).mtimeMs;
  } catch {
    return Infinity;
  }
}

/**
 * Block this thread for `ms` without spinning the CPU.
 * A hook is synchronous from Claude Code's point of view, so there is no event
 * loop to await on while the decision file appears.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Wait for the service to drop a decision for this request.
 *
 * Returns the decision object, or null once the deadline passes. The deadline
 * is the whole point: an unanswered prompt must fall back to the normal local
 * prompt rather than stall the session (decision D9).
 */
function awaitDecision(requestId, timeoutMs) {
  const path = join(DECISIONS_DIR, `${requestId}.json`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const decision = readJson(path);
    if (decision) {
      // Consume it: the request is answered once and the directory stays small.
      try {
        unlinkSync(path);
      } catch {
        // A decision we cannot delete is still a decision worth honouring.
      }
      return decision;
    }
    sleepSync(POLL_INTERVAL_MS);
  }
  return null;
}

/** A short, local-only description of what a tool call is about to do. */
function toolDetail(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const value = toolInput.command ?? toolInput.file_path ?? toolInput.path ?? toolInput.url;
  const text = typeof value === 'string' ? value : JSON.stringify(toolInput);
  return typeof text === 'string' ? text.slice(0, 500) : null;
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
    // What the tool is about to do, capped here and scrubbed by the service.
    // Approving a bare tool name is rubber-stamping; the phone needs to see
    // which command or which file.
    toolDetail: toolDetail(input.tool_input),
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

  // A flagged tool in an enrolled session is the one case where this hook does
  // more than append and exit: it asks the phone, within a hard deadline.
  const settings = normalise(readJson(APPROVALS_PATH));
  const waiting = record.event === 'PreToolUse'
    && shouldWait(settings, record, heartbeatAge());
  if (waiting) record.requestId = randomUUID();

  // One JSONL file per day keeps the drain simple and bounds file count.
  const day = new Date(record.ts).toISOString().slice(0, 10);
  mkdirSync(SPOOL_DIR, { recursive: true });
  appendFileSync(join(SPOOL_DIR, `${day}.jsonl`), `${JSON.stringify(record)}\n`);

  if (!waiting) return;

  const decision = awaitDecision(record.requestId, settings.timeoutMs);
  // null means the deadline passed: emit `ask` so the local prompt appears.
  process.stdout.write(`${JSON.stringify(decisionOutput(decision))}\n`);
}

// Fail open. Any throw, any rejection, any unexpected state: exit zero, quietly.
try {
  await main();
} catch {
  // Intentionally swallowed: a monitoring hook must never fail the session it
  // monitors. Diagnostics belong in the service, which can report safely.
}
process.exit(0);
