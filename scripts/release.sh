#!/usr/bin/env bash
# Builds a signed release APK and publishes it as a GitHub release.
# The in-app updater reads that release, so the tag is the version contract.
# Usage: scripts/release.sh 0.1.1 "What changed"
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=${1:?usage: scripts/release.sh <version> [notes]}
NOTES=${2:-"Release v$VERSION"}
REPO=shivam1410/claude-remote
# The work GitHub account cannot push to this repo; be explicit about which one.
export GH_TOKEN=$(gh auth token -u shivam1410)

# A build without Firebase config installs fine and then stops at the setup
# screen. Fail here rather than publishing a dead APK.
[ -f android/app/google-services.json ] || {
  echo "android/app/google-services.json is missing — register dev.claudebridge in Firebase first" >&2
  exit 1
}

# The keystore lives outside the repo; without it the release build is unsigned
# and could never update an installed copy.
grep -q '^CR_STORE_FILE' ~/.gradle/gradle.properties || {
  echo "CR_STORE_FILE is not set in ~/.gradle/gradle.properties" >&2
  exit 1
}

sed -i '' "s/^VERSION_NAME=.*/VERSION_NAME=$VERSION/" android/gradle.properties
(cd android && ./gradlew -q testDebugUnitTest assembleRelease)

mkdir -p build
APK="build/claude-remote-v$VERSION.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"

# Only the version bump is staged — never `git add -A`, which would sweep in
# whatever happens to be untracked at the time.
git add android/gradle.properties
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"
git push origin HEAD "v$VERSION"
gh release create "v$VERSION" "$APK" -R "$REPO" --title "v$VERSION" --notes "$NOTES"
