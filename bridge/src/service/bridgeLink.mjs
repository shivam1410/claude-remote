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
// connects, which is rare next to the tick rate.
const CACHE_MS = 5_000;
let cache = { at: 0, map: new Map() };

/**
 * Build { sessionId -> bridgeSessionId } from every session file that has one.
 * Pure but for the directory read; the directory is injectable for tests.
 */
export function readLinks(dir = SESSIONS_DIR) {
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
      if (typeof record?.sessionId === 'string'
        && typeof record?.bridgeSessionId === 'string'
        && record.bridgeSessionId !== '') {
        map.set(record.sessionId, record.bridgeSessionId);
      }
    } catch {
      // One bad file must not lose the rest.
    }
  }
  return map;
}

/**
 * The claude.ai session id for a local sessionId, or null when the session is
 * not connected to Remote Control.
 */
export function bridgeSessionIdFor(sessionId, now = Date.now()) {
  if (!sessionId) return null;
  if (now - cache.at > CACHE_MS) {
    cache = { at: now, map: readLinks() };
  }
  return cache.map.get(sessionId) ?? null;
}

/** The deep link the phone opens, or null when there is no Remote Control id. */
export function deepLinkFor(sessionId, now = Date.now()) {
  const id = bridgeSessionIdFor(sessionId, now);
  return id ? `https://claude.ai/code/${id}` : null;
}
