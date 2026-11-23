# Menubar status

A tiny macOS menubar app for the laptop bridge. Native Swift, one file, no
dependencies — compiled with `swiftc`, no Xcode project, no Electron.

## What it shows

Reads `~/.claude-bridge/status.json`, which the bridge rewrites every tick:

- **green bolt + count** — bridge running, N live sessions
- **orange bell-slash** — running but notifications paused
- **red bolt-slash** — bridge not running (status is stale or missing)

The dropdown lists: bridge running/stopped, paired yes/no, live session count,
and seconds since the last tick.

## Pause notifications

The one control. "Pause notifications" creates `~/.claude-bridge/paused`; the
bridge keeps the phone's session list current but holds the FCM push, so the
phone stays quiet while you are at the laptop. Un-pausing removes the file and
sends one catch-up push per still-waiting session — not a backlog burst.

This is the laptop-side counterpart to the master toggle on the phone's Home
screen; either silences notifications, neither unpairs.

## Install

```bash
macos/install.sh
```

Builds, copies the binary to `~/.local/bin/claude-bridge-menubar`, and loads a
login agent (`dev.claudebridge.menubar`) so it starts with you. Re-run to
update. Remove with the command the installer prints.

## Privacy

The status file holds only your uid and a live session count — the same facts
the phone already has. No session text, no credentials, no network. The pause
flag is an empty file. Everything stays on the laptop.
