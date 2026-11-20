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
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, utimesSync, closeSync, openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { load, SPOOL_DIR, CONFIG_DIR } from './config.mjs';
import { drain, readCursor, writeCursor } from './spool.mjs';
import { fold, projectLabel, shouldPush, workspaceRoot } from './sessionState.mjs';
import { lastAssistantMessage } from './transcript.mjs';
import { summarise } from '../core/summarise.mjs';
import { seal, open as unseal, generateKey } from '../core/crypto.mjs';
import { scrub } from '../core/scrub.mjs';
import * as db from './db.mjs';
import * as fcm from './fcm.mjs';
import * as keychain from './keychain.mjs';
import { decode, classify, deliver, liveStatus, halt } from './inject.mjs';
import { DEFAULT_TIMEOUT_MS } from '../core/approval.mjs';

const CURSOR_PATH = join(CONFIG_DIR, 'cursor.json');
const DECISIONS_DIR = join(CONFIG_DIR, 'decisions');
const HEARTBEAT_PATH = join(CONFIG_DIR, 'heartbeat');
// How long a request may sit unanswered before the service prunes it. The hook
// has already fallen back to `ask` by then, so a later answer has nowhere to go.
const APPROVAL_TTL_MS = DEFAULT_TIMEOUT_MS + 30_000;
// A push announces that something needs you now. Ten minutes later it is
// noise, and with no consumer deployed it is unbounded growth: the node sat
// at 46 and climbing with nothing reading it.
const PUSH_TTL_MS = 10 * 60 * 1000;
const POLL_MS = 2000;
const PAYLOAD_VERSION = 1;

/** Read the checked-out branch without shelling out to git. */
function branchOf(rawCwd) {
  if (!rawCwd) return null;
  // The workspace, not the momentary cwd: a session working in a
  // subdirectory has no .git there, and reported no branch at all.
  const cwd = workspaceRoot(rawCwd) ?? rawCwd;
  try {
    // In a worktree .git is a file pointing at the real git directory, so
    // joining ".git/HEAD" as a path fails and every worktree session reported
    // no branch at all. Follow the pointer first.
    const dotGit = join(cwd, '.git');
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const match = readFileSync(dotGit, 'utf8').match(/gitdir:\s*(.+)/);
      if (!match) return null;
      gitDir = match[1].trim();
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8');
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

/** The plaintext the phone will see once it decrypts. Scrubbed, never raw. */
function payloadFor(session) {
  const raw = session.message || lastAssistantMessage(session.transcriptPath);
  return {
    sessionId: session.sessionId,
    project: scrub(session.project),
    branch: scrub(branchOf(session.cwd) ?? ''),
    state: session.state,
    summary: summarise(raw),
    tool: scrub(session.tool ?? ''),
    ts: session.ts,
  };
}

/**
 * Push one sealed payload to every registered handset.
 *
 * Never throws: a session's state is already in the database and the phone
 * will show it on next open. A push is a nudge, not the record, so failing to
 * send one must not stop publishing.
 */
async function pushNow(config, blob, deps = {}) {
  const {
    listDevices = db.listDevices,
    deleteDevice = db.deleteDevice,
    send = fcm.broadcast,
  } = deps;

  try {
    const devices = await listDevices(config);
    const { sent, dead, reason } = await send(config, devices, blob);
    if (reason) console.log(`push skipped: ${reason}`);
    else if (sent > 0) console.log(`pushed to ${sent} device(s)`);

    for (const installId of dead ?? []) {
      // FCM says this token is finished — an uninstall, usually. Leaving it
      // means every future push wastes a call on it.
      console.log(`dropping dead device ${installId}`);
      await deleteDevice(config, installId);
    }
  } catch (error) {
    console.log(`push failed: ${error.message}`);
  }
}

/** Build the encrypted node for one folded session. */
function nodeFor(key, session) {
  return { v: PAYLOAD_VERSION, updatedAt: session.ts, blob: seal(key, payloadFor(session)) };
}

// Last published state per live session. The reply path needs it to tell an
// idle session from a running one; a session is dropped the moment it ends.
export const sessionStates = new Map();

// Where each live session is working. A resume must run in the session's own
// directory: the trust prompt is per-directory, so spawning in the service's
// cwd asks the user to trust a folder that has nothing to do with the session.
export const sessionCwds = new Map();

/** Drain the spool and publish. Returns the number of sessions touched. */
export async function publish(config, key) {
  const cursor = readCursor(CURSOR_PATH);
  const { records, cursor: nextCursor } = drain(SPOOL_DIR, cursor);
  if (records.length === 0) return 0;

  // Approval requests are per-call, not per-session, so they are handled before
  // the fold collapses a batch down to one entry per session.
  for (const record of records.filter((r) => r.requestId)) {
    await db.putApproval(config, record.requestId, approvalNode(key, record));
  }

  const sessions = fold(records);
  for (const session of sessions) {
    const previous = sessionStates.get(session.sessionId);

    // Queue the push before the node is touched: a finished session is deleted
    // from /sessions straight away, but the phone still needs to be told.
    if (shouldPush(previous, session.state)) {
      // Sent straight from here. The /pushes node existed only so a Cloud
      // Function could pick it up, and that needs Blaze; the Mac can send
      // with the user's own messaging-scoped token instead.
      await pushNow(config, seal(key, payloadFor(session)));
    }

    if (session.ended) {
      await db.deleteSession(config, session.sessionId);
      sessionStates.delete(session.sessionId);
      sessionCwds.delete(session.sessionId);
    } else {
      await db.putSession(config, session.sessionId, nodeFor(key, session));
      sessionStates.set(session.sessionId, session.state);
      // The repository root, not the momentary cwd. Workspace trust is
      // granted per workspace, and a session's cwd wanders into
      // subdirectories that were never trusted on their own — which is
      // exactly how delivery kept failing with "Workspace not trusted".
      if (session.cwd) {
        sessionCwds.set(session.sessionId, workspaceRoot(session.cwd) ?? session.cwd);
      }
    }
  }

  // Only advance the cursor once every publish in this batch succeeded.
  writeCursor(CURSOR_PATH, nextCursor);
  return sessions.length;
}

/**
 * Deliver whatever the phone has written to /replies.
 *
 * A reply whose target is busy is left in place: the node itself is the queue,
 * so it survives a restart and is retried on the next pass once the session
 * goes idle (decision D6). Anything undecodable or aimed at a session we do not
 * know is deleted, otherwise it would be retried forever.
 */
export async function deliverReplies(config, key, deps = {}) {
  const {
    listReplies = db.listReplies,
    deleteReply = db.deleteReply,
    putReplyError = db.putReplyError,
    run = deliver,
    status = liveStatus,
    stop = halt,
  } = deps;
  const pending = await listReplies(config);
  if (!pending) return 0;

  let delivered = 0;
  for (const [pushId, node] of Object.entries(pending)) {
    const payload = decode(key, node);
    const { action, reason } = classify(payload, sessionStates);
    // Every decision leaves a trace. A reply that was written and then
    // silently dropped is indistinguishable from one that was never sent,
    // and that ambiguity cost an evening.
    console.log(`reply ${pushId}: ${action} (${reason})${payload ? ` -> ${payload.sessionId}` : ''}`);

    if (action === 'queue') continue;
    if (action === 'deliver') {
      // Ask the CLI, not our own memory. Anything but a confirmed idle is a
      // reason to wait: resuming a busy session forks it.
      const live = await status(payload.sessionId);
      if (live !== 'idle') {
        console.log(`reply ${pushId}: holding, CLI reports ${live ?? 'unknown'}`);
        if (live === 'gone') {
          // The session is not running at all, so resuming cannot continue
          // it. Hold rather than start something nobody asked for.
          sessionStates.delete(payload.sessionId);
        }
        continue;
      }
      // Stop before resuming. A live process is copied, not continued, so
      // this is what makes the reply land in the same conversation — and if
      // it cannot be stopped, resuming would fork. Hold instead.
      if (!(await stop(payload.sessionId))) {
        console.log(`reply ${pushId}: cannot stop ${payload.sessionId}, holding rather than forking`);
        continue;
      }
      const after = await status(payload.sessionId);
      if (after !== 'gone') {
        console.log(`reply ${pushId}: still ${after ?? 'unknown'} after stop, holding`);
        continue;
      }

      try {
        await run(payload, { cwd: sessionCwds.get(payload.sessionId) });
      } catch (error) {
        // Put the reason where the phone can see it. Without this a reply sat
        // in the queue looking healthy while every attempt failed, and the
        // only trace was a log line on the Mac.
        await putReplyError(config, pushId, seal(key, {
          v: PAYLOAD_VERSION,
          message: scrub(summarise(String(error.message ?? error))),
          ts: Date.now(),
        })).catch(() => {});
        throw error;
      }
      delivered += 1;
      console.log(`reply ${pushId}: resumed ${payload.sessionId}`);
      // The session is no longer idle; hold the rest of this batch for it.
      sessionStates.set(payload.sessionId, 'running');
    }
    // Delete on both deliver and discard. Exactly-once rests on this: if the
    // delete fails the node stays and the reply is sent twice, which is the
    // safer of the two failures.
    await deleteReply(config, pushId);
  }
  return delivered;
}

/** Build the encrypted node for one pending tool approval. */
function approvalNode(key, record) {
  const payload = {
    v: PAYLOAD_VERSION,
    requestId: record.requestId,
    sessionId: record.sessionId,
    project: scrub(projectLabel(record.cwd)),
    tool: scrub(record.toolName ?? 'unknown'),
    // The same redaction pipeline as a session summary: the phone sees enough
    // to judge the call, never raw work content.
    detail: summarise(record.toolDetail ?? ''),
    ts: record.ts,
  };
  return { v: PAYLOAD_VERSION, createdAt: record.ts, blob: seal(key, payload) };
}

/**
 * Relay answered approvals back to the blocked hooks, and prune expired ones.
 *
 * The decision travels to the hook through a file rather than a socket: the
 * hook must stay dependency-free and must work when this service dies between
 * writing the file and the hook reading it.
 */
export async function relayDecisions(config, key, deps = {}) {
  const {
    listApprovals = db.listApprovals,
    deleteApproval = db.deleteApproval,
    writeDecision = defaultWriteDecision,
    now = Date.now(),
  } = deps;

  const pending = await listApprovals(config);
  if (!pending) return 0;

  let answered = 0;
  for (const [requestId, node] of Object.entries(pending)) {
    if (typeof node?.decisionBlob === 'string') {
      try {
        const decision = unseal(key, node.decisionBlob);
        writeDecision(requestId, decision);
        answered += 1;
      } catch {
        // Not sealed with the paired key: a forgery or a key mismatch. Dropping
        // it means the hook times out and the local prompt appears.
      }
      await deleteApproval(config, requestId);
      continue;
    }
    if (Number(node?.createdAt) > 0 && now - Number(node.createdAt) > APPROVAL_TTL_MS) {
      await deleteApproval(config, requestId);
    }
  }
  return answered;
}

/** Write one decision where the waiting hook polls for it. */
function defaultWriteDecision(requestId, decision) {
  mkdirSync(DECISIONS_DIR, { recursive: true });
  writeFileSync(join(DECISIONS_DIR, `${requestId}.json`), JSON.stringify(decision), { mode: 0o600 });
}

/**
 * Drop pushes nobody collected. Returns how many went.
 *
 * Without a consumer this path grows forever. Even with one, a push that
 * failed to send is stale within minutes — re-sending it later would announce
 * a state the session has long since left.
 */
export async function prunePushes(config, deps = {}) {
  const {
    listPushes = db.listPushes,
    deletePush = db.deletePush,
    now = Date.now(),
  } = deps;

  const pending = await listPushes(config);
  if (!pending) return 0;

  let pruned = 0;
  for (const [pushId, node] of Object.entries(pending)) {
    const createdAt = Number(node?.createdAt);
    // A node with no usable timestamp cannot be aged, and leaving it would
    // mean it is never collected either.
    if (!Number.isFinite(createdAt) || now - createdAt > PUSH_TTL_MS) {
      await deletePush(config, pushId);
      pruned += 1;
    }
  }
  if (pruned > 0) console.log(`pruned ${pruned} stale push(es)`);
  return pruned;
}

/**
 * Touch the heartbeat. A hook refuses to wait for a decision unless this file
 * is fresh, so a dead service costs a session no latency at all.
 */
export function beat(path = HEARTBEAT_PATH) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  try {
    utimesSync(path, new Date(), new Date());
  } catch {
    closeSync(openSync(path, 'w'));
  }
}

/** One full pass: publish state, relay approvals, deliver replies. */
export async function tick(config, key, deps = {}) {
  const {
    publish: runPublish = publish,
    relayDecisions: runRelay = relayDecisions,
    deliverReplies: runDeliver = deliverReplies,
    prunePushes: runPrune = prunePushes,
  } = deps;
  beat();

  // Each stage runs even when an earlier one fails. They are independent, and
  // letting publish take the others down with it meant one undeployed rule on
  // the pushes path silently stopped replies being delivered and approvals
  // being answered — a blocked hook would sit there until it timed out.
  const errors = [];
  let touched = 0;
  for (const [name, run] of [
    ['publish', async () => { touched = await runPublish(config, key); }],
    ['relayDecisions', () => runRelay(config, key)],
    ['deliverReplies', () => runDeliver(config, key)],
    ['prunePushes', () => runPrune(config)],
  ]) {
    try {
      await run();
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('; '));
  return touched;
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
