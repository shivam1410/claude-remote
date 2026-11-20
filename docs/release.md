# Signing and releases

The app is distributed through GitHub Releases. Nothing goes to a store, and
the in-app updater reads the Releases API, so a published tag is the version
contract.

## Register both fingerprints in Firebase first

Google sign-in fails with a bare `[16] Caller not authorized` unless the
signing certificate behind the running build is registered on the Android app
in Firebase. Debug and release builds are signed with different keys, so both
need to be there or the app works in development and breaks the moment you
install a release.

Firebase console → Project settings → Your apps → `dev.claudebridge` → Add
fingerprint:

| Build | SHA-1 |
|---|---|
| debug | `B6:05:3F:F4:89:38:1A:BB:0F:E1:C7:6D:6E:0C:41:1E:43:41:CD:D4` |
| release | `E6:FF:DA:47:F8:2F:DF:F4:4D:4B:63:B6:1C:5D:38:3E:65:46:46:83` |

Re-download `google-services.json` afterwards and put it in `android/app/`.
It is gitignored.

## The signing key

`~/.android/claude-remote-release.jks`, alias `claude-remote`, RSA 4096, valid
until 2053. Mode 600, outside the repo, and `*.jks` is gitignored so a stray
copy inside the tree is never staged.

Credentials live in `~/.gradle/gradle.properties` as `CR_STORE_FILE`,
`CR_STORE_PASSWORD`, `CR_KEY_ALIAS` and `CR_KEY_PASSWORD`. Not in this repo,
and deliberately not in GitHub Actions secrets — a signing key in CI is a
long-lived static credential (`nhi7`), so releases are built and uploaded by
hand from this Mac.

`app/build.gradle.kts` only creates the `release` signing config when
`CR_STORE_FILE` is set, so the project still builds and unit-tests on a
machine that has never seen the keystore.

APKs are signed with v2 and v3. v3 carries proof-of-rotation, which is the
only thing that makes this key replaceable later.

**Back the keystore up somewhere durable.** Android enforces same-signer for
update-over-install. If this file is lost, no future release can update an
installed copy — the recovery path is uninstall and reinstall, which deletes
the shared key from the Android Keystore and means pairing again by QR.

Certificate SHA-256, which is what the updater's signature check pins against:

```
BB:A6:AF:54:89:9D:5E:6F:78:9E:16:49:BA:77:2E:A1:7F:1B:C7:30:84:43:E1:2B:D0:F0:25:47:37:AC:E5:C7
```

## Cutting a release

```bash
scripts/release.sh 0.1.1 "What changed"
```

It refuses to run without `google-services.json` or `CR_STORE_FILE`, rather
than publishing an APK that installs and then stops at the setup screen or one
that can never be updated. Then it bumps `VERSION_NAME` in
`android/gradle.properties`, runs the unit tests and `assembleRelease`, commits
just that version bump, tags, pushes, and uploads the APK with
`gh release create`.

`versionCode` is derived from the version name as `major * 10000 + minor * 100
+ patch`, so it always increases as long as the version does.

The script pins the GitHub account with `gh auth token -u shivam1410`. The
other account on this machine cannot push here and fails with a 403.
