#!/usr/bin/env bash
# Build the menubar app, install the binary, and load it as a login agent.
# Re-run any time to update: it rebuilds, replaces the binary, and reloads.
set -euo pipefail
cd "$(dirname "$0")"

BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/claude-bridge-menubar"
LABEL="dev.claudebridge.menubar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

./build.sh
mkdir -p "$BIN_DIR"
cp claude-bridge-menubar "$BIN"

# Point the agent at the installed binary, not the repo copy.
mkdir -p "$HOME/Library/LaunchAgents"
sed "s#__BINARY__#$BIN#" "$LABEL.plist" > "$PLIST"

# Reload: unload first so a running copy picks up the new binary.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed and loaded $LABEL (binary: $BIN)"
echo "to remove: launchctl unload \"$PLIST\" && rm \"$PLIST\" \"$BIN\""
