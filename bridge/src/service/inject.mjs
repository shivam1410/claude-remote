// Reply injection: turn an encrypted node written by the phone into a message
// delivered to exactly one local session.
//
// Split in two on purpose. `decode` and `classify` are pure, so every rule that
// decides whether a reply reaches a session is testable with no Firebase, no
// Keychain, and no `claude` binary. `deliver` is the only part that spawns
// anything.
//
// The safety rule this module exists to enforce: `claude --resume` against a
// session that is already running starts a *copy* rather than continuing it,
// which silently forks the conversation. So a reply is delivered only while its
// target is idle, and held otherwise (decision D6).
import { execFile } from 'node:child_process';
import { open } from '../core/crypto.mjs';

export const PAYLOAD_VERSION = 1;

/** The one state in which resuming continues the session instead of forking it. */
export const IDLE_STATES = new Set(['waiting_input']);

const MAX_TEXT_CHARS = 2000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SPAWN_TIMEOUT_MS = 15_000;
const AGENTS_TIMEOUT_MS = 10_000;

/**
 * Decrypt and validate one reply node.
 * Returns the payload, or null if it is not something we are willing to run.
 *
 * AES-GCM is authenticated, so anything not sealed with the paired key fails
 * here and never reaches a session.
 */
export function decode(key, node, now = Date.now()) {
  if (!node || typeof node.blob !== 'string') return null;

  let payload;
  try {
    payload = open(key, node.blob);
  } catch {
    // Forged, corrupted, or sealed with a different key. Nothing to report to
    // the phone: a reply it did not send is not its business.
    return null;
  }

  if (payload?.v !== PAYLOAD_VERSION) return null;
  if (typeof payload.sessionId !== 'string' || payload.sessionId === '') return null;
  if (typeof payload.text !== 'string') return null;

  const text = payload.text.trim();
  if (text === '' || text.length > MAX_TEXT_CHARS) return null;

  const ts = Number(payload.ts);
  if (!Number.isFinite(ts)) return null;
  // A reply far in the past is a replay or a phone that was offline for a day;
  // one in the future is a clock problem. Neither should reach a session.
  if (ts < now - MAX_AGE_MS || ts > now + 60_000) return null;

  return { sessionId: payload.sessionId, text, ts };
}

/**
 * Decide what to do with a decoded reply, given the last known state of every
 * live session.
 *
 * `sessions` maps sessionId to a state string from the published vocabulary.
 */
export function classify(payload, sessions) {
  if (!payload) return { action: 'discard', reason: 'undecodable' };

  const state = sessions?.get?.(payload.sessionId);
  // Not "unknown" so much as "not seen yet": the service tracks state in
  // memory, so every restart starts blank. Discarding here threw away a reply
  // the user had already sent. Hold it instead — decode already refuses
  // anything older than a day, so nothing accumulates forever.
  if (state === undefined) return { action: 'queue', reason: 'unknown-session' };
  if (!IDLE_STATES.has(state)) return { action: 'queue', reason: `busy:${state}` };

  return { action: 'deliver', reason: 'idle' };
}

/**
 * Resume one session with the reply text.
 *
 * execFile with an argv array, never a shell string: the text comes off the
 * network and must never be parsed by anything but `claude` itself.
 */
/**
 * Stop a session so it can be continued rather than copied.
 *
 * `--resume` forks whenever the target process is alive — idle or not, the
 * CLI says "already running, so this started a copy". Only an exited session
 * can be continued under its own id. Stopping first is therefore not an
 * optimisation, it is the only way to reply into the same conversation.
 *
 * Safe precisely because delivery is gated on waiting_input: a session asking
 * the user a question has nothing in flight to interrupt.
 */
export function halt(sessionId, { bin = resolveBin() } = {}) {
  return new Promise((resolve) => {
    // Resolves false when the stop did not work. Ignoring this is what forked
    // a session: `claude stop` cannot address an interactive session, the
    // failure was swallowed, and the resume ran against a live process.
    execFile(bin, ['stop', sessionId], { timeout: AGENTS_TIMEOUT_MS }, (error) => {
      resolve(!error);
    });
  });
}

export function deliver(payload, { bin = resolveBin(), cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['--bg', '--resume', payload.sessionId, payload.text],
      { cwd, timeout: SPAWN_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          // stderr may quote the prompt back; the text is the user's own, but
          // it is not worth putting in a log line either.
          reject(new Error(`resume ${payload.sessionId} failed: ${error.message}`));
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

/**
 * Where the `claude` binary lives.
 * launchd gives a user agent a minimal PATH, so a bare name is not enough.
 */
/**
 * What the CLI itself says about a session right now.
 *
 * The bridge's own view comes from the last hook event it saw, and that goes
 * stale the moment the user types again. Delivering on a stale "idle" is what
 * forked three sessions: `--resume` against a running session starts a copy.
 *
 * Returns the status string, or null when it cannot be determined — and the
 * caller treats null as "do not deliver". Failing closed costs a delay;
 * failing open costs a forked conversation and an agent nobody is watching.
 */
export function liveStatus(sessionId, { bin = resolveBin() } = {}) {
  return new Promise((resolve) => {
    execFile(bin, ['agents', '--json'], { timeout: AGENTS_TIMEOUT_MS }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const agents = JSON.parse(stdout);
        const match = agents.find((a) => a?.sessionId === sessionId);
        resolve(match ? match.status ?? null : 'gone');
      } catch {
        resolve(null);
      }
    });
  });
}

export function resolveBin(env = process.env) {
  return env.CLAUDE_BRIDGE_CLAUDE_BIN || `${env.HOME ?? ''}/.local/bin/claude`;
}
