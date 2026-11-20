import { existsSync } from 'node:fs';
import { join } from 'node:path';
// Pure mapping from spooled hook events to the one-line session view the phone
// sees. No I/O, so it is fully testable offline.
//
// The state vocabulary is fixed by the spec:
//   running | waiting_input | waiting_approval | error | done

/** Derive the session state implied by a single hook event. */
export function stateForEvent(record) {
  switch (record.event) {
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'running';
    case 'Notification':
      // Claude Code raises Notification both for permission prompts and for
      // plain idle-waiting. The wording is the only signal available.
      return /permission|approve|allow/i.test(record.message ?? '')
        ? 'waiting_approval'
        : 'waiting_input';
    case 'Stop':
    case 'SubagentStop':
      return 'waiting_input';
    case 'SessionEnd':
      return 'done';
    default:
      return 'running';
  }
}

/** The short project label shown on the phone: the working directory's name. */
export function projectLabel(cwd, isRepoRoot = defaultIsRepoRoot) {
  if (typeof cwd !== 'string' || cwd === '') return 'unknown';
  const parts = cwd.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return 'unknown';

  // Walk up to the repository root. A session whose cwd is a subdirectory
  // would otherwise be labelled by that subdirectory — "android" rather than
  // the project it belongs to, which is useless on a phone showing several
  // sessions at once.
  for (let i = parts.length; i > 0; i -= 1) {
    if (isRepoRoot(`/${parts.slice(0, i).join('/')}`)) return parts[i - 1];
  }
  return parts[parts.length - 1];
}

function defaultIsRepoRoot(dir) {
  try {
    return existsSync(join(dir, '.git'));
  } catch {
    // Unreadable path: fall back to the leaf name rather than failing.
    return false;
  }
}

/**
 * Fold an ordered batch of spool records into one payload per session.
 * Later events win; a session that ended is marked so the caller can delete it.
 */
export function fold(records) {
  const bySession = new Map();

  for (const record of records) {
    if (!record?.sessionId) continue;
    const previous = bySession.get(record.sessionId) ?? {};
    bySession.set(record.sessionId, {
      sessionId: record.sessionId,
      project: projectLabel(record.cwd ?? previous.cwd),
      cwd: record.cwd ?? previous.cwd ?? null,
      state: stateForEvent(record),
      tool: record.toolName ?? null,
      // Notification text is the only message the hook itself carries; anything
      // else is read from the local transcript by the caller.
      message: record.message ?? previous.message ?? null,
      transcriptPath: record.transcriptPath ?? previous.transcriptPath ?? null,
      ts: record.ts,
      ended: record.event === 'SessionEnd',
    });
  }

  return [...bySession.values()];
}

/**
 * States worth waking a phone for (decision D10): the session needs the user,
 * or it is over. `running` never pushes — that is just work happening.
 */
export const PUSH_STATES = new Set(['waiting_input', 'waiting_approval', 'done', 'error']);

/**
 * Should a transition into `next` send a push?
 *
 * Only on change. A session that emits three Notification events while waiting
 * is still one interruption, and three identical buzzes would train the user to
 * ignore all of them.
 */
export function shouldPush(previous, next) {
  if (previous === next) return false;
  return PUSH_STATES.has(next);
}
