#!/usr/bin/env node
// The resident bridge service.
//
// Drains the hook spool, turns each session's latest events into one short
// scrubbed line, encrypts it with the key shared with the phone, and publishes
// it. A session that ended is deleted from the database immediately, per
// decision D5: the completion push carries the result, the database does not
// keep it.
//
// This process is the only thing that touches the network. If it is not
// running, sessions are unaffected and the spool simply grows until it starts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, SPOOL_DIR, CONFIG_DIR } from './config.mjs';
import { drain, readCursor, writeCursor } from './spool.mjs';
import { fold } from './sessionState.mjs';
import { lastAssistantMessage } from './transcript.mjs';
import { summarise } from '../core/summarise.mjs';
import { seal, generateKey } from '../core/crypto.mjs';
import * as db from './db.mjs';
import * as keychain from './keychain.mjs';

const CURSOR_PATH = join(CONFIG_DIR, 'cursor.json');
const POLL_MS = 2000;
const PAYLOAD_VERSION = 1;

/** Read the checked-out branch without shelling out to git. */
function branchOf(cwd) {
  if (!cwd) return null;
  try {
    const head = readFileSync(join(cwd, '.git', 'HEAD'), 'utf8');
    const match = head.match(/^ref: refs\/heads\/(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Fetch or create the 32-byte key shared with the paired phone. */
async function sharedKey() {
  const existing = await keychain.get(keychain.accounts.SHARED_KEY);
  if (existing) return Buffer.from(existing, 'base64');

  const key = generateKey();
  await keychain.set(keychain.accounts.SHARED_KEY, key.toString('base64'));
  console.log('Generated a new shared key. Pair your phone again to receive it.');
  return key;
}

/** Build the encrypted node for one folded session. */
function nodeFor(key, session) {
  const raw = session.message || lastAssistantMessage(session.transcriptPath);
  const payload = {
    sessionId: session.sessionId,
    project: session.project,
    branch: branchOf(session.cwd),
    state: session.state,
    summary: summarise(raw),
    tool: session.tool,
    ts: session.ts,
  };
  return { v: PAYLOAD_VERSION, updatedAt: session.ts, blob: seal(key, payload) };
}

/** One drain-and-publish pass. Returns the number of sessions touched. */
export async function tick(config, key) {
  const cursor = readCursor(CURSOR_PATH);
  const { records, cursor: nextCursor } = drain(SPOOL_DIR, cursor);
  if (records.length === 0) return 0;

  const sessions = fold(records);
  for (const session of sessions) {
    if (session.ended) {
      await db.deleteSession(config, session.sessionId);
    } else {
      await db.putSession(config, session.sessionId, nodeFor(key, session));
    }
  }

  // Only advance the cursor once every publish in this batch succeeded.
  writeCursor(CURSOR_PATH, nextCursor);
  return sessions.length;
}

async function main() {
  const config = load();
  const key = await sharedKey();
  const uid = await db.currentUid(config);
  console.log(`claude-bridge running. uid ${uid}, spool ${SPOOL_DIR}`);

  if (process.argv.includes('--once')) {
    console.log(`published ${await tick(config, key)} session(s)`);
    return;
  }

  // ponytail: a 2s poll of one small directory. Move to fs.watch only if the
  // idle cost ever shows up in a battery profile.
  for (;;) {
    try {
      await tick(config, key);
    } catch (error) {
      // Keep running: a transient network or token failure must not end the
      // service, and nothing is lost because the cursor did not advance.
      console.error(`tick failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
