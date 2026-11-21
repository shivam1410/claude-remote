// Mapping a local session to its claude.ai Remote Control id, so the phone can
// deep-link into the official Claude app.
//
// Claude Code records, per running session, a file ~/.claude/sessions/<pid>.json
// whose `bridgeSessionId` is the id in the web URL
// https://claude.ai/code/<bridgeSessionId>. It is present only when the session
// is connected to Remote Control; absent otherwise, and the caller shows no
// button then.
//
// This reads undocumented internal state (observed on CLI 2.1.321). It fails
// safe: any missing file, unreadable JSON, or renamed field yields null, and
// the feature simply does not appear. No auth is involved — it is a local read.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = process.env.CLAUDE_BRIDGE_SESSIONS_DIR
  ?? join(homedir(), '.claude', 'sessions');

// The map is rebuilt at most this often: the files change only when a session
// connects or is renamed, which is rare next to the tick rate.
const CACHE_MS = 5_000;
let cache = { at: 0, map: new Map() };

/**
 * Build { sessionId -> { bridgeSessionId, name } } from every session file.
 * A record with no bridgeSessionId still contributes its name; both fields are
 * optional. Pure but for the directory read; the directory is injectable.
 */
export function readRecords(dir = SESSIONS_DIR) {
  const map = new Map();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return map; // no sessions dir: nothing to link, not an error.
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (typeof record?.sessionId !== 'string') continue;
      const bridgeSessionId = typeof record.bridgeSessionId === 'string'
        && record.bridgeSessionId !== '' ? record.bridgeSessionId : null;
      const title = typeof record.name === 'string' && record.name !== ''
        ? record.name : null;
      if (bridgeSessionId || title) {
        map.set(record.sessionId, { bridgeSessionId, title });
      }
    } catch {
      // One bad file must not lose the rest.
    }
  }
  return map;
}

/**
 * Back-compat view: { sessionId -> bridgeSessionId } for records that have one.
 */
export function readLinks(dir = SESSIONS_DIR) {
  const map = new Map();
  for (const [sessionId, record] of readRecords(dir)) {
    if (record.bridgeSessionId) map.set(sessionId, record.bridgeSessionId);
  }
  return map;
}

function recordFor(sessionId, now) {
  if (!sessionId) return null;
  if (now - cache.at > CACHE_MS) {
    cache = { at: now, map: readRecords() };
  }
  return cache.map.get(sessionId) ?? null;
}

/**
 * The claude.ai session id for a local sessionId, or null when the session is
 * not connected to Remote Control.
 */
export function bridgeSessionIdFor(sessionId, now = Date.now()) {
  return recordFor(sessionId, now)?.bridgeSessionId ?? null;
}

/** The deep link the phone opens, or null when there is no Remote Control id. */
export function deepLinkFor(sessionId, now = Date.now()) {
  const id = bridgeSessionIdFor(sessionId, now);
  return id ? `https://claude.ai/code/${id}` : null;
}

/** The session's display title (Claude Code's auto-name), or null. */
export function titleFor(sessionId, now = Date.now()) {
  return recordFor(sessionId, now)?.title ?? null;
}

/** True when a process with this pid exists (EPERM still means it is alive). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * The sessionIds whose owning process is still running. Read straight from the
 * session files (not the cache) so the stale sweep sees the current truth; a
 * crashed session's process is gone even if its file lingers.
 */
export function liveSessionIds(dir = SESSIONS_DIR, isAlive = pidAlive) {
  const ids = new Set();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return ids; // no sessions dir: treat nothing as live, let the TTL decide.
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (typeof record?.sessionId === 'string'
        && Number.isInteger(record?.pid)
        && isAlive(record.pid)) {
        ids.add(record.sessionId);
      }
    } catch {
      // One bad file must not shrink the live set and cause a wrong delete.
    }
  }
  return ids;
}
