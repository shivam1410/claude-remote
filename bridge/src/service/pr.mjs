// Resolve the open pull request for a branch, via the gh CLI.
//
// payloadFor runs synchronously on every publish, and a session has no PR most
// of the time, so this never blocks on gh: a cache miss returns null now and
// kicks off a background `gh` that fills the cache for the next publish. Fully
// fail-safe — no gh, no PR, no repo, or a parse error all yield null, and the
// PR chip simply does not appear.
import { execFile } from 'node:child_process';

const TTL_MS = 60_000;
const GH_TIMEOUT_MS = 5_000;

const cache = new Map(); // key -> { at, pr | null }
const inflight = new Set();

function keyOf(repoRoot, branch) {
  return `${repoRoot}\u0000${branch}`;
}

function refresh(repoRoot, branch, key, run) {
  if (inflight.has(key)) return;
  inflight.add(key);
  run(
    'gh',
    ['pr', 'view', branch, '--json', 'number,state,url'],
    { cwd: repoRoot, timeout: GH_TIMEOUT_MS },
    (error, stdout) => {
      inflight.delete(key);
      let pr = null;
      if (!error) {
        try {
          const j = JSON.parse(stdout);
          if (j && j.url) pr = { number: j.number, state: j.state, url: j.url };
        } catch {
          // Not JSON (gh printed a message): treat as no PR.
        }
      }
      cache.set(key, { at: Date.now(), pr });
    },
  );
}

/**
 * The open PR for a branch as { number, state, url }, or null. Returns the
 * cached value immediately and refreshes it in the background when stale.
 * `run` and `now` are injectable for tests.
 */
export function prFor(repoRoot, branch, { run = execFile, now = Date.now() } = {}) {
  if (!repoRoot || !branch) return null;
  const key = keyOf(repoRoot, branch);
  const hit = cache.get(key);
  if (!hit || now - hit.at >= TTL_MS) {
    refresh(repoRoot, branch, key, run);
  }
  return hit?.pr ?? null;
}

/** Test-only: drop the cache so a case starts clean. */
export function _resetPrCache() {
  cache.clear();
  inflight.clear();
}
