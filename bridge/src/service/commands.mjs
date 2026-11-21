// Commands the phone sends the Mac to act on — currently just "start a new
// background session".
//
// Same split as inject.mjs: `decode` is pure and validates what we are willing
// to run; `runStart` is the only part that spawns `claude`. AES-GCM is
// authenticated, so a command not sealed with the paired key fails to decode
// and never runs — the only writer that matters is the paired phone.
//
// The cwd is never taken from the phone. The phone names a project label; the
// caller resolves it against roots the bridge has already seen, so a command
// can only start a session in a known workspace, never an arbitrary path.
import { execFile } from 'node:child_process';
import { open } from '../core/crypto.mjs';

export const PAYLOAD_VERSION = 1;

const MAX_PROMPT_CHARS = 2000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SPAWN_TIMEOUT_MS = 30_000;

/**
 * Decrypt and validate one command node. Returns { action, prompt, project } or
 * null when it is not something we are willing to run.
 */
export function decode(key, node, now = Date.now()) {
  if (!node || typeof node.blob !== 'string') return null;

  let payload;
  try {
    payload = open(key, node.blob);
  } catch {
    return null; // forged, corrupt, or a different key.
  }

  if (payload?.v !== PAYLOAD_VERSION) return null;
  if (payload.action !== 'start') return null; // the only action for now.

  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (prompt === '' || prompt.length > MAX_PROMPT_CHARS) return null;

  const createdAt = Number(node.createdAt);
  if (Number.isFinite(createdAt) && now - createdAt > MAX_AGE_MS) return null;

  const project = typeof payload.project === 'string' ? payload.project : '';
  return { action: 'start', prompt, project };
}

/**
 * Start a background session in `root` with `prompt`. `claude --bg <prompt>`
 * detaches and returns; the timeout only guards the spawn call itself.
 * Resolves to true on success, false on failure — never throws.
 */
export function runStart(root, prompt, { run = execFile } = {}) {
  return new Promise((resolve) => {
    run(
      'claude',
      ['--bg', prompt],
      { cwd: root, timeout: SPAWN_TIMEOUT_MS },
      (error) => resolve(!error),
    );
  });
}
