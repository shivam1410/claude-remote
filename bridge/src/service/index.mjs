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
import { fold, projectLabel, workspaceRoot, stateForEvent, PUSH_STATES } from './sessionState.mjs';
import { lastAssistantMessage, modelOf } from './transcript.mjs';
import { summarise } from '../core/summarise.mjs';
import { seal, open as unseal, generateKey } from '../core/crypto.mjs';
import { scrub } from '../core/scrub.mjs';
import * as db from './db.mjs';
import * as fcm from './fcm.mjs';
import * as keychain from './keychain.mjs';
import { decode, classify, deliver, liveStatus, halt } from './inject.mjs';
import { deepLinkFor, titleFor, startedAtFor, originFor, appGroupFor, liveSessionIds } from './bridgeLink.mjs';
import { prFor } from './pr.mjs';
import { decode as decodeCommand, runStart } from './commands.mjs';
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
// A session node is deleted at SessionEnd. The sweep is the backstop for a
// session that died without it (crash, kill, or an archive/delete that stopped
// the process): once its pid is gone and the node has not been touched for this
// long, drop it. Generous, so a live idle session is never swept by mistake.
const SESSION_TTL_MS = 10 * 60 * 1000;
// The sweep reads the whole sessions directory and checks pids, so it runs far
// less often than the 2s poll.
const SWEEP_INTERVAL_MS = 60 * 1000;
// The refresh re-seals session nodes whose record-derived fields changed, so it
// is throttled the same way.
const REFRESH_INTERVAL_MS = 60 * 1000;
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
  const branch = branchOf(session.cwd) ?? '';
  // The PR is looked up against the real branch, not the scrubbed label; the
  // chip's url/number/state are public GitHub facts, not work content.
  const pr = branch ? prFor(workspaceRoot(session.cwd) ?? session.cwd, branch) : null;
  return {
    sessionId: session.sessionId,
    // Prefer the desktop app's own grouping (the session's origin folder) so the
    // phone's groups match the app; fall back to the cwd-derived label when the
    // app has no record of it (e.g. a CLI session).
    project: scrub(appGroupFor(session.sessionId) ?? session.project),
    branch: scrub(branch),
    // Claude Code's own name for the session. Scrubbed: the auto-name can echo
    // work content (e.g. "fix auth bug in billing"). Empty when unnamed.
    title: scrub(titleFor(session.sessionId) ?? ''),
    state: session.state,
    summary: summarise(raw),
    tool: scrub(session.tool ?? ''),
    ts: session.ts,
    // The model id (e.g. "claude-opus-4-8"); not work content, shown as a chip.
    model: modelOf(session.transcriptPath),
    // When the session process started, epoch ms, so the phone shows elapsed.
    startedAt: startedAtFor(session.sessionId) ?? 0,
    // Where it was launched ("bg" | "desktop" | "cli"); a fixed enum, not work
    // content, so it needs no scrub. Empty when unknown.
    origin: originFor(session.sessionId) ?? '',
    // The full last message, markdown kept (tables, links, lists), secrets
    // still scrubbed — the org rule redacts before any sink, encrypted or not.
    // Capped so the sealed blob stays under the 4096 database-rule limit; a
    // longer message is cut with an ellipsis rather than making publish fail.
    body: bodyOf(raw),
    // Present only for a Remote-Control-connected session: lets the phone
    // open it in the official Claude app. Not scrubbed — it is a claude.ai
    // session id, not work content — but still sealed with everything else.
    ...(deepLinkFor(session.sessionId) && { openUrl: deepLinkFor(session.sessionId) }),
    // The open PR for this branch, when there is one. Public GitHub facts.
    ...(pr && { prUrl: pr.url, prNumber: pr.number, prState: pr.state }),
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

const MAX_BODY_CHARS = 2000;

/** The full message for the detail view: scrubbed, markdown intact, bounded. */
function bodyOf(raw) {
  const text = scrub(typeof raw === 'string' ? raw : '');
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n\n…` : text;
}

/** Build the encrypted node for one folded session. */
function nodeFor(key, session) {
  return { v: PAYLOAD_VERSION, updatedAt: session.ts, blob: seal(key, payloadFor(session)) };
}

// Last published state per live session. The reply path needs it to tell an
// idle session from a running one; a session is dropped the moment it ends.
export const sessionStates = new Map();

// The ts of the last actionable event pushed per session. Gating on this, not
// on a folded state string, is what stops a turn-end Stop being swallowed when
// the next turn's first tool call lands in the same poll batch.
const lastPushedTs = new Map();

// When the stale-session sweep last ran, so it is throttled to SWEEP_INTERVAL_MS
// rather than every poll.
let lastSweepAt = 0;

// When the node refresh last ran, throttled to REFRESH_INTERVAL_MS.
let lastRefreshAt = 0;

/**
 * The newest actionable event per session in a raw batch.
 *
 * From the records, not the folded state: fold keeps only the last state, so a
 * Stop (needs you) followed by a running tool call in the same poll batch
 * would hide the Stop and the phone would never be told.
 */
export function pickActionable(records) {
  const actionable = new Map();
  for (const record of records) {
    const state = stateForEvent(record);
    if (!PUSH_STATES.has(state)) continue;
    const current = actionable.get(record.sessionId);
    if (!current || record.ts > current.ts) {
      actionable.set(record.sessionId, { state, ts: record.ts });
    }
  }
  return actionable;
}

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

  const actionable = pickActionable(records);

  for (const session of sessions) {
    const act = actionable.get(session.sessionId);
    // Push once per actionable occurrence: a new Stop/Notification has a newer
    // ts; a lingering state produces no new record, so no repeat.
    if (act && act.ts > (lastPushedTs.get(session.sessionId) ?? 0)) {
      lastPushedTs.set(session.sessionId, act.ts);
      await pushNow(config, seal(key, payloadFor({ ...session, state: act.state })));
    }

    if (session.ended) {
      await db.deleteSession(config, session.sessionId);
      sessionStates.delete(session.sessionId);
      sessionCwds.delete(session.sessionId);
      lastPushedTs.delete(session.sessionId);
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

    if (action === 'queue') {
      // "unknown-session" means only "not seen since restart", so a reply is
      // normally held — the session may publish any moment. But if the CLI
      // confirms no such session exists, the reply can never be delivered, and
      // holding it loops this log line and a delete-less pass every tick
      // forever. Ask the CLI once; discard only on a definite "gone" (null is
      // a failed probe, so hold and try again next pass).
      if (reason === 'unknown-session' && (await status(payload.sessionId)) === 'gone') {
        console.log(`reply ${pushId}: discarding, no such session ${payload.sessionId}`);
        await deleteReply(config, pushId);
      }
      continue;
    }
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
        // Say so on the phone. This is not a wait — an interactive session
        // cannot be stopped, so the reply will never be delivered and
        // "queued" on its own reads as a promise that will not be kept.
        await noteHold(config, key, node, pushId, putReplyError,
          'This session is open on the desktop. Claude Code cannot deliver into a live session; reply there, or send to a background session.');
        continue;
      }
      const after = await status(payload.sessionId);
      if (after !== 'gone') {
        console.log(`reply ${pushId}: still ${after ?? 'unknown'} after stop, holding`);
        await noteHold(config, key, node, pushId, putReplyError,
          'The session did not stop, so delivering would fork it. Still waiting.');
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

/**
 * Record why a reply is stuck, once.
 *
 * Written only when the node has no reason yet: the tick runs every two
 * seconds, and re-writing the same sentence thirty times a minute would be a
 * write amplification bug of its own.
 */
async function noteHold(config, key, node, pushId, putReplyError, message) {
  if (typeof node?.errorBlob === 'string') return;
  try {
    await putReplyError(config, pushId, seal(key, {
      v: PAYLOAD_VERSION,
      message,
      ts: Date.now(),
    }));
  } catch {
    // The reply stays queued either way; this is only the explanation.
  }
}

/**
 * The workspace root a project label names, from the roots the bridge has seen,
 * or null. The cwd a command runs in comes from here, never from the phone, so
 * a command can only start a session in a known workspace. The label is matched
 * after scrub, since that is the form the phone received.
 */
function resolveProjectRoot(project) {
  const roots = new Set(sessionCwds.values());
  if (!project) {
    // No project named: only safe when there is exactly one known root.
    return roots.size === 1 ? [...roots][0] : null;
  }
  for (const root of roots) {
    if (scrub(projectLabel(root)) === project) return root;
  }
  return null;
}

/**
 * Act on commands the phone queued. Today the only action is "start": run
 * `claude --bg <prompt>` in a known workspace. Every command is deleted after
 * one attempt — a command we cannot act on must not be retried forever.
 */
export async function deliverCommands(config, key, deps = {}) {
  const {
    listCommands = db.listCommands,
    deleteCommand = db.deleteCommand,
    start = runStart,
    resolveRoot = resolveProjectRoot,
  } = deps;

  const pending = await listCommands(config);
  if (!pending) return 0;

  let started = 0;
  for (const [commandId, node] of Object.entries(pending)) {
    const cmd = decodeCommand(key, node);
    if (cmd) {
      const root = resolveRoot(cmd.project);
      if (!root) {
        console.log(`command ${commandId}: unknown project ${JSON.stringify(cmd.project)}`);
      } else if (await start(root, cmd.prompt)) {
        started += 1;
      } else {
        console.log(`command ${commandId}: claude --bg failed in ${root}`);
      }
    }
    await deleteCommand(config, commandId);
  }
  return started;
}

/** Build the encrypted node for one pending tool approval. */
function approvalNode(key, record) {
  const payload = {
    v: PAYLOAD_VERSION,
    requestId: record.requestId,
    sessionId: record.sessionId,
    // Match the desktop app's grouping where known, as the session payload does.
    project: scrub(appGroupFor(record.sessionId) ?? projectLabel(record.cwd)),
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
 * Drop session nodes whose owning process is gone and that have not been
 * touched for SESSION_TTL_MS. The backstop for a session that ended without a
 * SessionEnd hook (crash, kill, or an app archive/delete that stopped it), so
 * it stops lingering on the phone. A live session is never swept: it is either
 * in the live-pid set or its node is fresh.
 */
export async function pruneStaleSessions(config, deps = {}) {
  const {
    listSessions = db.listSessions,
    deleteSession = db.deleteSession,
    live = liveSessionIds,
    now = Date.now(),
  } = deps;

  const nodes = await listSessions(config);
  if (!nodes) return 0;
  const alive = live();

  let pruned = 0;
  for (const [sessionId, node] of Object.entries(nodes)) {
    if (alive.has(sessionId)) continue;
    const updatedAt = Number(node?.updatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt > SESSION_TTL_MS) {
      await deleteSession(config, sessionId);
      sessionStates.delete(sessionId);
      sessionCwds.delete(sessionId);
      lastPushedTs.delete(sessionId);
      pruned += 1;
    }
  }
  if (pruned > 0) console.log(`pruned ${pruned} stale session(s)`);
  return pruned;
}

/**
 * Catch a live session's node up with its record.
 *
 * `openUrl`, `title` and `origin` come from the session record (bridgeLink),
 * not the transcript, and a node is written only when the session emits an
 * event. So a session that connects to Remote Control — or is renamed — while
 * idle keeps a stale node: the "Open in Claude" button never appears because
 * `openUrl` is absent, even though the record now has the id.
 *
 * Rather than rebuild the whole payload (which would need the transcript), this
 * decrypts the stored node, overlays only the record-derived fields, and
 * re-seals when one actually changed. Live sessions only — a dead one is the
 * sweep's job, not something to grow a button on.
 */
export async function refreshSessions(config, key, deps = {}) {
  const {
    listSessions = db.listSessions,
    putSession = db.putSession,
    live = liveSessionIds,
    openUrlFor = deepLinkFor,
    nameFor = titleFor,
    launchedFrom = originFor,
    groupFor = appGroupFor,
  } = deps;

  const nodes = await listSessions(config);
  if (!nodes) return 0;
  const alive = live();

  let refreshed = 0;
  for (const [sessionId, node] of Object.entries(nodes)) {
    if (!alive.has(sessionId) || typeof node?.blob !== 'string') continue;

    let payload;
    try {
      payload = unseal(key, node.blob);
    } catch {
      // Sealed with an older key, or corrupt. The sweep handles the dead; a
      // node we cannot read is not ours to rewrite.
      continue;
    }

    const url = openUrlFor(sessionId) ?? undefined;
    const title = scrub(nameFor(sessionId) ?? '');
    const origin = launchedFrom(sessionId) ?? '';
    const group = scrub(groupFor(sessionId) ?? '');
    // Only the arrival of a value is interesting here. Removal (a session that
    // left Remote Control) is rare and not worth a write every pass.
    const gainedUrl = url && url !== payload.openUrl;
    const gainedTitle = title !== '' && title !== payload.title;
    const gainedOrigin = origin !== '' && origin !== payload.origin;
    const gainedGroup = group !== '' && group !== payload.project;
    if (!gainedUrl && !gainedTitle && !gainedOrigin && !gainedGroup) continue;

    const next = {
      ...payload,
      ...(gainedUrl && { openUrl: url }),
      ...(gainedTitle && { title }),
      ...(gainedOrigin && { origin }),
      ...(gainedGroup && { project: group }),
    };
    await putSession(config, sessionId, {
      v: PAYLOAD_VERSION,
      updatedAt: node.updatedAt ?? Date.now(),
      blob: seal(key, next),
    });
    refreshed += 1;
  }
  if (refreshed > 0) console.log(`refreshed ${refreshed} session node(s)`);
  return refreshed;
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
    deliverCommands: runCommands = deliverCommands,
    prunePushes: runPrune = prunePushes,
    pruneStaleSessions: runSweep = pruneStaleSessions,
    refreshSessions: runRefresh = refreshSessions,
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
    ['deliverCommands', () => runCommands(config, key)],
    ['prunePushes', () => runPrune(config)],
    ['pruneStaleSessions', async () => {
      // Throttled: the sweep reads the sessions directory and checks pids, far
      // heavier than the 2s poll it rides on.
      const at = Date.now();
      if (at - lastSweepAt < SWEEP_INTERVAL_MS) return;
      lastSweepAt = at;
      await runSweep(config);
    }],
    ['refreshSessions', async () => {
      // Throttled like the sweep: it lists and decrypts every node, far heavier
      // than the 2s poll, and the fields it catches up on change rarely.
      const at = Date.now();
      if (at - lastRefreshAt < REFRESH_INTERVAL_MS) return;
      lastRefreshAt = at;
      await runRefresh(config, key);
    }],
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
