#!/usr/bin/env bash
# Compile the menubar status app. One Swift file, no Xcode project.
# Output: macos/claude-bridge-menubar (a plain binary, run directly or by launchd).
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O MenuBar.swift -o claude-bridge-menubar
echo "built macos/claude-bridge-menubar"
