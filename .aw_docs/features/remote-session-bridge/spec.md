# Spec — remote-session-bridge

Monitor and reply to local Claude Code sessions on this MacBook from a native
Android app, over an end-to-end encrypted channel.

## Problem

The dispatch feature is unavailable on this laptop. When a long session stalls
waiting for input, or finishes while the user is away from the desk, there is no
way to see it or unblock it from a phone.

## Goals

- See every live local session, its stage, and a short description of what it
  last said.
- Get pushed a notification when a session needs input, finishes, or errors.
- Send a reply into one specific session from the phone.
- Approve or deny flagged tool permissions from the phone.

## Non-goals

- Cloud sessions on claude.ai. They write no transcript to this machine.
- Full transcript mirroring, file contents, diffs, or tool output.
- Multi-user support. This is a single-operator tool.
- Replacing the terminal. The phone is for unblocking, not for working.

## Resolved decisions

| id | Decision |
|----|----------|
| D1 | Payload carries a redacted summary of the last assistant message, never raw text. |
| D2 | Summary is produced heuristically, with no model call. |
| D3 | End-to-end encrypted with AES-256-GCM. The key never leaves the paired devices. |
| D3b | Personal Firebase project: Realtime Database for state, FCM for push. |
| D4 | Google sign-in pinned to one account uid on both ends. |
| D5 | A session is removed from the database the moment it ends, is archived, or is deleted. |
| D6 | A reply sent while the session is busy is queued and delivered when it next goes idle. |
| D7 | Remote permission approval applies to flagged tools in enrolled sessions only. |
| D8 | All active sessions publish. No allowlist. |
| D9 | Hooks always fail open. Bounded timeout, always exit zero. |
| D10 | Push fires on input-needed, finished, and error only. |
| D11 | Android app is sideloaded as a debug APK over adb. |

## Architecture

Three processes and one cloud trigger.

### 1. Hook emitter

A single script wired additively into `~/.claude/settings.json` for
`SessionStart`, `Notification`, `Stop`, `SessionEnd`, and `PreToolUse`.

It does no network work. It appends one small JSON record to a local spool
directory and exits zero. This is what makes D9 enforceable: the bridge can be
down, the network can be gone, and the user's sessions are unaffected.

Existing hooks in `~/.claude/settings.json` (AW telemetry, graphify) must be
preserved. New entries are appended to the arrays, never substituted.

### 2. Bridge service

A Node process run by launchd as a user agent. It owns everything privileged:

- watches the spool directory and drains records
- builds the summary and runs the scrubber
- encrypts the payload
- authenticates to Firebase and writes to the Realtime Database
- listens for replies and approval decisions
- injects replies into sessions
- serves approval decisions back to blocked hooks through the local filesystem

### 3. Android app

Kotlin with Compose. Google sign-in, QR pairing, a live session list, a detail
view with the reply box, approve and deny actions, and notifications built
locally from decrypted data messages.

### 4. Cloud Function

A Realtime Database trigger that fans out an FCM data-only message when a
session document changes in a way that warrants a push. The function sends
ciphertext; the handset decrypts and composes the notification text.

## Data model

Realtime Database, everything under the signed-in uid.

```
/u/{uid}/sessions/{sessionId}   { v, updatedAt, blob }
/u/{uid}/replies/{pushId}       { v, createdAt, blob }
/u/{uid}/approvals/{requestId}  { v, createdAt, blob, decisionBlob? }
/u/{uid}/devices/{installId}    { fcmToken, updatedAt }
```

`blob` is base64 of `nonce || ciphertext || tag`. Decrypted, a session blob is:

```json
{
  "sessionId": "uuid",
  "project": "ai-backend",
  "branch": "main",
  "state": "running | waiting_input | waiting_approval | error | done",
  "summary": "<= 200 chars, scrubbed",
  "tool": "Bash",
  "turn": 14,
  "ts": 1763600000000
}
```

Plaintext on the wire is limited to `v`, `updatedAt`, the random session id, and
the FCM token. No project names, no message text, no file paths.

### Security rules

```json
{ "rules": { "u": { "$uid": {
  ".read":  "auth.uid === $uid",
  ".write": "auth.uid === $uid"
} } } }
```

Encryption is the confidentiality control; the rules are defence in depth.
AES-GCM is authenticated, so a forged reply written by anyone else fails to
decrypt and is discarded before it can reach a session.

## Key flows

### Status publish

Hook appends to spool, exits zero. Service drains, summarises, scrubs,
encrypts, writes to `/u/{uid}/sessions/{sessionId}`.

### Session end

`SessionEnd` spools a terminal record. The service deletes the database node
outright (D5). The completion push has already been sent, and Android keeps it
in the notification shade, so the result survives the entry being pruned.

### Reply

Phone encrypts and writes to `/u/{uid}/replies`. The service decrypts, checks
the target session is known and idle, then runs:

```
claude --bg --resume <sessionId> -p "<text>"
```

If the session is busy the reply is held and delivered on the next idle event.
This matters: resuming a session that is already running starts a copy instead
of continuing it, which would silently fork the conversation.

### Remote approval

`PreToolUse` fires for a flagged tool in an enrolled session. The hook spools an
approval request and then polls a local decision file for up to the configured
timeout. The service relays the request to the phone and writes the answer back
to that file. The hook emits:

```json
{ "hookSpecificOutput": { "permissionDecision": "allow" } }
```

On timeout it emits `"ask"`, so the normal local prompt appears and nothing is
ever silently blocked or silently approved.

## Redaction

The summariser drops fenced code blocks and tool output, takes the first one or
two sentences of the last assistant text, and caps at 200 characters. The
scrubber then replaces matches for API key prefixes, bearer tokens, JWTs, AWS
access key ids, email addresses, and long hex or base64 runs with `[redacted]`.

Scrubbing runs on every outbound field without exception, including the
summary, the tool name, and the project label.

## Risks

- **R1 — Cloud Functions require the Blaze plan.** Sending FCM from the Mac
  instead would mean a service account key on disk, which contradicts D4 and the
  `nhi7` rule. If enabling billing is unacceptable, the fallback is an Android
  foreground service holding the database connection open, trading battery and a
  persistent notification for the removal of the key.
- **R2 — Scope.** This is four deliverables: hooks, a daemon, a cloud function,
  and an Android app. Phases 1 through 5 produce a working phone view and reply
  path; approvals and the app polish can follow.
- **R3 — Heuristic summaries read mechanically** on messages that open with a
  question or a list. Acceptable, and revisitable without touching the protocol.
- **R4 — `claude --bg --resume` behaviour is the pivot of the reply path.** It is
  verified from the CLI help for 2.1.316 but not yet exercised end to end. Phase 5
  proves it against a scratch session before anything is built on top.

## Verification

- `node --test` covers the crypto round trip, the scrubber, the summariser, and
  reply routing including the busy-session queue.
- A scrubber corpus test asserts that a message containing a fake key, a JWT, and
  an email emits none of them.
- An end-to-end check: start a scratch session, trigger a permission prompt,
  approve from the phone, confirm the session proceeds.
- Hook isolation: with the bridge stopped and the network disabled, a normal
  session must run start to finish with no added latency and no errors.
