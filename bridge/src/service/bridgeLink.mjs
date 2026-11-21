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
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = process.env.CLAUDE_BRIDGE_SESSIONS_DIR
  ?? join(homedir(), '.claude', 'sessions');

// Where the desktop app keeps per-session metadata, as
// <account>/<org>/local_<hostSessionId>.json. The account and org ids are not
// known ahead of time, so the lookup scans those two levels. Undocumented
// internal state (observed on the 5.x desktop app); every read fails safe.
const APP_SESSIONS_DIR = process.env.CLAUDE_BRIDGE_APP_SESSIONS_DIR
  ?? join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');

// The map is rebuilt at most this often: the files change only when a session
// connects or is renamed, which is rare next to the tick rate.
const CACHE_MS = 5_000;
let cache = { at: 0, map: new Map() };

/**
 * Build { sessionId -> { bridgeSessionId, name } } from every session file.
 * A record with no bridgeSessionId still contributes its name; both fields are
 * optional. Pure but for the directory read; the directory is injectable.
 */
/**
 * A short, non-sensitive label for where the session was launched, from the
 * record's `kind`/`entrypoint`. "bg" for a headless (background) session,
 * "desktop" for the Claude desktop app, "cli" for a terminal — the last two
 * both run hooks and notify the phone, but only "desktop" appears in the app.
 * Null when the record says nothing useful.
 */
function originLabel(record) {
  if (record?.kind && record.kind !== 'interactive') return 'bg';
  if (record?.entrypoint === 'claude-desktop') return 'desktop';
  if (record?.entrypoint === 'cli') return 'cli';
  return null;
}

/**
 * The group the desktop app files this session under, so the phone can match it.
 *
 * The app groups by the session's origin — the project it was spawned from —
 * which for a worktree or a subdirectory session differs from the current cwd
 * the bridge would otherwise label by. That origin lives in the app's own
 * per-session metadata, keyed by `hostSessionId`. Returns the basename of that
 * origin directory, or null when there is no hostSessionId, no file, or no
 * usable path — in which case the caller keeps its cwd-derived label.
 */
function appGroupLabel(hostSessionId, dir = APP_SESSIONS_DIR) {
  if (typeof hostSessionId !== 'string' || hostSessionId === '') return null;
  const fileName = `${hostSessionId}.json`;
  let accounts;
  try {
    accounts = readdirSync(dir);
  } catch {
    return null; // app data dir absent: nothing to match, not an error.
  }
  for (const account of accounts) {
    let orgs;
    try {
      orgs = readdirSync(join(dir, account));
    } catch {
      continue;
    }
    for (const org of orgs) {
      const path = join(dir, account, org, fileName);
      if (!existsSync(path)) continue;
      try {
        const meta = JSON.parse(readFileSync(path, 'utf8'));
        const cwd = meta?.originCwd
          ?? meta?.folderPlace?.origin?.cwd
          ?? meta?.folderPlace?.cwd;
        if (typeof cwd === 'string' && cwd !== '') {
          return basename(cwd.replace(/\/+$/, '')) || null;
        }
      } catch {
        // One unreadable metadata file is not fatal; fall back to the cwd label.
      }
      return null; // found the session's file but it named no usable origin.
    }
  }
  return null;
}

export function readRecords(dir = SESSIONS_DIR, appDir = APP_SESSIONS_DIR) {
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
      const startedAt = Number.isFinite(record.startedAt) ? record.startedAt : null;
      const origin = originLabel(record);
      const group = appGroupLabel(record.hostSessionId, appDir);
      if (bridgeSessionId || title || startedAt || origin || group) {
        map.set(record.sessionId, { bridgeSessionId, title, startedAt, origin, group });
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

/** When the session process started, in epoch ms, or null. */
export function startedAtFor(sessionId, now = Date.now()) {
  return recordFor(sessionId, now)?.startedAt ?? null;
}

/** Where the session was launched ("bg" | "desktop" | "cli"), or null. */
export function originFor(sessionId, now = Date.now()) {
  return recordFor(sessionId, now)?.origin ?? null;
}

/** The desktop app's group (origin folder name) for this session, or null. */
export function appGroupFor(sessionId, now = Date.now()) {
  return recordFor(sessionId, now)?.group ?? null;
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
