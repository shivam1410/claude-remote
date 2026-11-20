# PRD — remote-session-bridge

## Problem

The dispatch feature is not available on this laptop. Long Claude Code sessions
stall waiting for input, or finish, while the operator is away from the desk.
There is currently no way to notice either event, and no way to unblock a
session without returning to the Mac.

## User

One operator: the owner of this MacBook and one Android handset. Single-user by
design; there is no sharing, no team surface, and no multi-tenant concern.

## Jobs to be done

1. Tell me when a session needs me, so a job does not sit idle for an hour.
2. Show me what a session is doing right now, without my having to trust memory.
3. Let me unblock a session from my phone, by answering a question or approving
   a tool.
4. Tell me the outcome when a session finishes.

## Scope

In scope: local Claude Code sessions on this MacBook; status, redacted summary,
replies, and approval of flagged tools.

Out of scope: cloud sessions on claude.ai, full transcripts, file contents, team
sharing, and any attempt to make the phone a place to actually work.

## Acceptance criteria

- A session that stops to ask something produces a push within a few seconds.
- The session list shows only live sessions, and entries disappear when a
  session ends, is archived, or is deleted.
- A reply sent from the phone reaches the intended session and no other, and is
  delivered exactly once even if the session was busy when it was sent.
- A flagged tool permission can be approved or denied from the phone; on
  timeout the normal local prompt appears instead.
- With the bridge stopped and the network disabled, a session runs start to
  finish with no error and no perceptible added latency.
- Nothing readable by the backend operator ever leaves the machine: inspecting
  the database directly shows ciphertext, a random id, and a timestamp.

## Assumptions

- Exactly one phone is paired at a time. Re-pairing replaces the key.
- The operator is willing to scan a QR code once during setup.
- Losing the phone is handled by rotating the key and re-pairing, not by a
  remote wipe.

## Success measure

A session never waits on the operator for longer than it takes them to look at
their phone. Secondary: the operator stops returning to the desk purely to check
whether something finished.
