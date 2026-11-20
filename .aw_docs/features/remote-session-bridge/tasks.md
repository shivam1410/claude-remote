# Tasks — remote-session-bridge

## Spec Brief

Build an end-to-end encrypted bridge so a native Android app can watch local
Claude Code sessions on this MacBook, receive pushes when one needs input or
finishes, reply into a named session, and approve flagged tool permissions.

Canonical spec: `spec.md`. Resolved decisions D1-D11 live there and are not
reopened during build.

Non-negotiable invariant: hooks fail open. With the bridge stopped or the
network down, sessions must run normally with no added latency.

Target repo: `/Users/shivamhl/Shivam/Remote-claude` (currently empty, not yet a
git repository).

## Phase 0 — Scaffold

- [x] 0.1 `git init`; add `.gitignore` covering `node_modules`, `*.apk`, local
      config, and anything under `secrets/`.
- [x] 0.2 Create `bridge/`, `functions/`, `android/`, `firebase/`, `docs/`.
- [x] 0.3 `bridge/package.json` with `node --test` wired as the test script.
- [ ] Commit: `chore: scaffold remote-session-bridge`

## Phase 1 — Pure core, no network

Highest-value phase: everything here is testable with no Firebase account.

- [x] 1.1 `bridge/src/core/crypto.mjs` — AES-256-GCM seal and open, 12-byte
      random nonce, output `nonce || ciphertext || tag` base64.
- [x] 1.2 Test: round trip; a tampered byte must throw, not return plaintext.
- [x] 1.3 `bridge/src/core/scrub.mjs` — redact key prefixes, bearer tokens,
      JWTs, AWS key ids, emails, long hex and base64 runs.
- [x] 1.4 Test: corpus message containing a fake key, a JWT, and an email emits
      none of them.
- [x] 1.5 `bridge/src/core/summarise.mjs` — strip fenced code and tool output,
      first one or two sentences, cap 200 chars, then scrub.
- [x] 1.6 Test: a message that is mostly a code block yields prose, not code.
- [ ] Validation: `cd bridge && node --test` — all green.
- [ ] Commit: `feat: encrypted payload core with redaction`

## Phase 2 — Hook emitter

- [x] 2.1 `bridge/src/hooks/emit.mjs` — read the hook JSON on stdin, append one
      record to `~/.claude-bridge/spool/`, always `process.exit(0)`.
- [x] 2.2 Wrap every path in try/catch; a spool failure must still exit zero.
- [x] 2.3 Additive wiring into `~/.claude/settings.json` for `SessionStart`,
      `Notification`, `Stop`, `SessionEnd`. Back the file up first and preserve
      the existing AW telemetry and graphify entries.
- [x] 2.4 Verify: run a throwaway session; confirm spool records appear and the
      existing hooks still fire.
- [ ] Validation: stop nothing, disable the network, run a session start to
      finish with no error and no perceptible delay.
- [ ] Commit: `feat: hook emitter with fail-open spool`

## Phase 3 — Firebase project and service skeleton

- [x] 3.1 Create the personal Firebase project; enable Realtime Database,
      Authentication with Google, and Cloud Messaging. (Manual, user-performed.)
- [x] 3.2 `firebase/database.rules.json` per the spec; deploy it.
- [x] 3.3 `bridge/src/service/auth.mjs` — loopback-redirect OAuth sign-in, token
      exchange to Firebase, refresh token stored via `security add-generic-password`
      in the macOS Keychain. Never written to a file.
- [x] 3.4 `bridge/src/service/db.mjs` — authenticated Realtime Database writes.
- [x] 3.5 `bridge/src/service/index.mjs` — drain spool, summarise, scrub,
      encrypt, publish; delete the node on session end.
- [ ] Validation: start a session, see the encrypted node appear in the console,
      confirm it is unreadable there.
- [ ] Commit: `feat: bridge service publishes encrypted session state`

## Phase 4 — Pairing

- [x] 4.1 `bridge/src/service/pair.mjs` — generate a 32-byte key, store in the
      Keychain, render a QR encoding key, uid, and database URL.
- [x] 4.2 `bridge --pair` CLI entrypoint.
- [ ] Commit: `feat: QR device pairing`

## Phase 5 — Reply path

Prove R4 before building on it.

- [x] 5.1 Spike: manually run `claude --bg --resume <id> -p "hi"` against a
      scratch session and confirm it continues rather than forking. If it
      forks, stop and re-plan this phase.
- [x] 5.2 `bridge/src/service/inject.mjs` — decrypt, validate the target, run the
      resume command.
- [x] 5.3 Idle-state tracking plus the busy-session queue, flushed on the next
      idle event.
- [x] 5.4 Test: a reply arriving while busy is held, then delivered exactly once.
- [x] 5.5 Delete the reply node after delivery.
- [ ] Commit: `feat: queued reply injection`

## Phase 6 — Remote approval

- [x] 6.1 Extend the hook emitter to handle `PreToolUse` for flagged tools in
      enrolled sessions; poll a local decision file with a bounded timeout.
- [x] 6.2 Emit `hookSpecificOutput.permissionDecision`; emit `ask` on timeout.
- [x] 6.3 Service relays the request and writes the decision back.
- [x] 6.4 Test: timeout path returns `ask` and never blocks indefinitely.
- [ ] Commit: `feat: remote tool approval with ask fallback`

## Phase 7 — Push

- [x] 7.1 Decide R1: enable Blaze for Cloud Functions, or fall back to an
      Android foreground service. Blocks 7.2.
- [x] 7.2 `functions/index.js` — database trigger, FCM data-only fan-out.
- [x] 7.3 Device token registration path.
- [ ] Commit: `feat: push fan-out on actionable state changes`

## Phase 8 — Android app

- [x] 8.1 Compose project, Google sign-in with the pinned account.
- [x] 8.2 QR scan, key import into the Android Keystore.
- [x] 8.3 Session list bound to the database, decrypting locally.
- [x] 8.4 Detail view: summary, state, reply box.
- [x] 8.5 Approve and deny actions.
- [x] 8.6 FCM receiver: decrypt, then build the notification locally.
- [ ] 8.7 `adb install` and verify on the handset. Blocked until the Android
      app is registered in Firebase and `google-services.json` lands in
      `android/app/` — the build works without it, but `FirebaseApp` does not
      initialise at runtime and the app stops at the setup screen.
- [ ] 8.8 Update check: poll the GitHub Releases API for the latest tag and
      compare against `BuildConfig.VERSION_NAME`.
- [ ] 8.9 Download the release APK, verify its signing certificate matches the
      installed app's before handing it to the package installer. Fail with a
      clear message on mismatch rather than letting the install error.
- [ ] 8.10 `REQUEST_INSTALL_PACKAGES` permission plus the install-unknown-apps
      consent flow.
- [ ] Commit: `feat: android client`

### Distribution — decided

GitHub Releases. The APK carries no secret: `google-services.json` values
(`apiKey`, `projectId`, `databaseUrl`, `appId`) and the Android OAuth client id
are public by Firebase design, and the 32-byte shared key never enters the
build — it arrives by QR at pairing and lives in the Android Keystore.

The release signing keystore stays on the Mac. Build and upload release assets
by hand; do not put the keystore in GitHub Actions secrets (`nhi7`:
long-lived static credential). Android enforces same-signer for
update-over-install, so the same key must sign every release.

## Phase 9 — Operationalise

- [ ] 9.1 launchd plist with KeepAlive; install script.
- [ ] 9.2 End-to-end pass: trigger a permission prompt, approve from the phone,
      confirm the session proceeds.
- [ ] 9.3 Failure pass: kill the service mid-session, confirm sessions are
      unaffected and the spool drains on restart.
- [ ] 9.4 `docs/README.md` — setup, pairing, revoking a lost phone.
- [ ] Commit: `docs: setup and recovery`

## Ordering

Phases 0 through 2 have no external dependencies and can start immediately.
Phase 3 gates on the Firebase project existing, which is a manual step.
Phase 5.1 is a hard checkpoint: the reply design depends on its outcome.
Phase 7.1 is a cost decision the user must make.

## Parallelism

`max_parallel_subagents: 3`.

- `parallel_group: core` — 1.1/1.2, 1.3/1.4, 1.5/1.6 touch disjoint files.
- Everything else sequences on shared files or on a prior phase's output.
