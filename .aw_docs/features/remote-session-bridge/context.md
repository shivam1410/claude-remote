# Context — remote-session-bridge

Planning vocabulary and resolved decisions for monitoring and replying to local
Claude Code sessions from an Android phone.

## Terms

- **Session** — one local Claude Code conversation on this MacBook, identified by
  its `sessionId`. Cloud sessions are out of scope: they write no transcript to
  this machine.
- **Status** — the coarse lifecycle state of a session as seen from the phone,
  driven by hook events rather than by parsing a transcript.
- **Input required** — the session has stopped and is waiting on the user.
  Sourced from the `Notification` hook.
- **Summary** — a short, redacted, human-readable description of what the session
  last said. Explicitly *not* the raw assistant message.
- **Bridge service** — the resident process on the MacBook that publishes status
  and consumes replies.
- **Reply** — text sent from the phone and injected into one specific session.
- **Enrolled session** — a session that has opted in to remote tool approval.
  Distinct from publishing status, which every active session does.
- **Flagged tool** — a tool whose permission prompt may be answered from the
  phone, such as `Bash`, `Write`, or `Edit`.

## Resolved decisions

### D1 — Egress boundary

The database carries a **redacted summary** of the last assistant message, never
the raw text. This is a work laptop: a raw message can contain proprietary
source, customer data, internal URLs, or credentials echoed in error output.

Prohibited from the payload in all cases: tool outputs, file contents, diffs,
command output, and full assistant message bodies.

### D2 — Summary generation

Heuristic, no model call. Strip code blocks and tool output, take the first
sentence or two, cap at roughly 200 characters, then scrub secrets. Zero cost,
no hook latency, and the raw message never leaves the machine to be summarised.

### D3 — Confidentiality model

End-to-end encrypted with AES-256-GCM. A key generated on the Mac moves to the
phone by QR scan and lives in the macOS Keychain and the Android Keystore. It is
never uploaded. The backend stores ciphertext, a random session id, and a
timestamp.

Consequence: the work-versus-personal account question stopped being a
confidentiality decision, because the host never sees plaintext.

### D3b — Backend

Personal Firebase project. Realtime Database for state, FCM for push. FCM is
required for Android push regardless, so one project covers both.

### D4 — Access control

Google sign-in pinned to one account uid on both ends; rules gate on that uid.
Encryption is the confidentiality control and the rules are defence in depth.
Because AES-GCM is authenticated, a reply forged by anyone else fails to decrypt
and is discarded before it can reach a session.

### D5 — Lifecycle

A session is removed from the database the moment it ends, is archived, or is
deleted. Nothing lingers.

The apparent tension with "I want to see the result" is resolved by push: the
completion notification carries the summary and stays in the Android
notification shade after the entry is gone.

### D6 — Reply injection safety

A reply sent while the session is busy is queued and delivered on the next idle
event. Resuming an already-running session starts a *copy* rather than
continuing it, which would silently fork the conversation.

### D7 — Remote approval

`PreToolUse` hooks can return `allow`, `deny`, or `ask`, so the phone can answer
permission prompts. Scoped to flagged tools in enrolled sessions. On timeout the
hook returns `ask` and the normal local prompt appears, so nothing is ever
silently blocked or silently approved.

### D8 — Publishing scope

All active sessions publish. No allowlist. Archived and deleted sessions are
removed.

### D9 — Failure isolation (invariant, not a preference)

Hooks always fail open: bounded timeout, always exit zero, never block or crash
a session when the bridge or the network is unavailable. A monitoring tool that
can break the work it monitors is not worth shipping.

### D10 — Notification volume

Push on input-needed, finished, and error. The in-app list updates silently.

### D11 — Distribution

Debug APK sideloaded over adb. Single user, no signing keys, no store.

## Flagged for review

- **R1** — FCM fan-out needs Cloud Functions, which require the Blaze plan.
  Sending FCM from the Mac instead would put a service-account key on the
  laptop, contradicting D4. The fallback is an Android foreground service.
