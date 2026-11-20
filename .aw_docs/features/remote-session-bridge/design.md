# Design — remote-session-bridge

The phone is a glance-and-unblock surface, not a workspace. Every screen is
built so the common case — "something needs me" — is answerable in one tap.

## Screens

### 1. Pairing (first run only)

Google sign-in with the pinned account, then a camera view to scan the QR shown
by `bridge --pair` on the Mac. On success the key is written to the Android
Keystore and the screen is never shown again unless the operator re-pairs.

### 2. Session list

The home screen. One row per live session, sorted with sessions that need
attention pinned to the top.

Each row shows the project name, a state chip, and the summary line. State chips
are the primary visual signal:

| State | Treatment |
|-------|-----------|
| `waiting_input` | Accent colour, pinned to the top of the list |
| `waiting_approval` | Accent colour, pinned, with the tool name shown |
| `running` | Muted, with a subtle progress indicator |
| `error` | Error colour, pinned |

An empty list is a good state, and says so plainly rather than showing a
spinner.

### 3. Session detail

Project, branch, state, turn count, and the summary in full. Below it, the
action area, which changes with state:

- `waiting_approval` — Approve and Deny as the two dominant buttons, with the
  tool named above them.
- `waiting_input` — a reply box with send.
- `running` — the reply box remains available, and sending shows a "queued"
  state, which becomes "delivered" once the bridge injects it.

### 4. Notifications

Built locally on the handset after decrypting the data message, because the
server cannot read the content. Three categories, matching D10: input needed,
finished, and error. Tapping one opens that session's detail screen directly.

The finished notification carries the result summary, and deliberately persists
in the notification shade after the database entry is pruned. That is the only
place a completed session's result survives, which is a direct consequence of
D5.

## Interaction rules

- Reply and approval controls are disabled while a send is in flight, so a
  double tap cannot send twice.
- A queued reply is shown as queued, never as sent, so the operator is never
  misled about whether the session has seen it.
- A decryption failure renders as an explicit "cannot decrypt" row rather than
  as empty content, because silent blanks would hide a key mismatch.

## What is deliberately absent

No transcript view, no file browser, no diff viewer, no settings beyond
re-pairing. Each of these would pull content out of the machine that D1
prohibits, and none of them serve the job of unblocking a stalled session.
