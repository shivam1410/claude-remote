// The rules that decide whether a tool permission prompt may be answered from
// the phone, and what the hook prints when it is.
//
// Pure: no filesystem, no clock, no network. The hook does the I/O around it.
// Keeping the policy here means every branch that could stall or wrongly
// approve a session is testable in milliseconds.
//
// Default posture is `ask`. Every unknown, malformed, or absent input lands
// there, which is exactly the behaviour of a machine with no bridge installed.

/** Tools whose prompts may be answered remotely when nothing else is configured. */
export const DEFAULT_TOOLS = ['Bash', 'Write', 'Edit'];

/** How long the hook will wait for the phone before falling back to `ask`. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** The service must have been alive this recently for the hook to wait at all. */
export const HEARTBEAT_STALE_MS = 10_000;

const DECISIONS = new Set(['allow', 'deny']);

/** Normalise the approvals settings file. Anything malformed disables the feature. */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { tools: [], sessions: [], timeoutMs: DEFAULT_TIMEOUT_MS };
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v !== '') : []);
  const timeout = Number(raw.timeoutMs);
  return {
    tools: raw.tools === undefined ? DEFAULT_TOOLS : list(raw.tools),
    sessions: list(raw.sessions),
    // A zero or negative timeout would mean "never wait"; clamp to something a
    // phone can actually answer within, and cap it so a typo cannot hang a
    // session for a minute.
    timeoutMs: Number.isFinite(timeout) ? Math.min(Math.max(timeout, 1000), 60_000) : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Is this session enrolled in remote approval?
 *
 * A line in `sessions` matches either an exact session id or the session's
 * working directory, so enrolment can be done by hand from a project folder
 * without knowing the generated session id.
 */
export function isEnrolled(settings, { sessionId, cwd }) {
  if (!settings?.sessions?.length) return false;
  return settings.sessions.some((entry) => {
    if (entry === sessionId) return true;
    if (typeof cwd !== 'string' || cwd === '') return false;
    const normalised = entry.replace(/\/+$/, '');
    return normalised !== '' && cwd.replace(/\/+$/, '') === normalised;
  });
}

/** Is this tool one whose prompt may be answered from the phone? */
export function isFlagged(settings, toolName) {
  if (typeof toolName !== 'string' || toolName === '') return false;
  return (settings?.tools ?? []).includes(toolName);
}

/**
 * Should the hook wait for a remote decision at all?
 * Every `false` here means the session behaves exactly as if the bridge did not
 * exist — no output, no added latency.
 */
export function shouldWait(settings, input, heartbeatAgeMs) {
  if (!isEnrolled(settings, input)) return false;
  if (!isFlagged(settings, input.toolName)) return false;
  // The service relays the request to the phone. With it down, waiting could
  // only ever end in a timeout, so do not pay for one.
  if (!Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs > HEARTBEAT_STALE_MS) return false;
  return true;
}

/**
 * The hook's stdout for a decision file's contents.
 * Anything that is not an explicit allow or deny becomes `ask`, which shows the
 * normal local prompt. Nothing is ever silently approved or silently blocked.
 */
export function decisionOutput(raw) {
  const decision = DECISIONS.has(raw?.decision) ? raw.decision : 'ask';
  const reason = decision === 'ask'
    ? 'claude-bridge: no answer from the paired phone'
    : `claude-bridge: ${decision} from the paired phone`;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: typeof raw?.reason === 'string' && raw.reason !== '' ? raw.reason : reason,
    },
  };
}
