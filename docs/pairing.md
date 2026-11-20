# Pairing a phone

```bash
cd bridge && npm run pair
```

A QR code appears. Scan it with the claude-bridge Android app.

## What the code contains

A `cbridge://pair?...` URI holding three things: the 32-byte shared key, your
Firebase uid, and the Realtime Database URL. About 148 characters.

The project id and API key are deliberately absent — the Android app already
carries those in `google-services.json`, so putting them here would widen what
is on screen for nothing.

## Why this is the one moment the key is visible

The key never travels through Firebase. Google stores ciphertext and holds no
means of reading it, which is the whole point of the design. The key therefore
has to cross from Mac to phone some other way, and a QR on your own screen is
that way.

The exposure is bounded rather than eliminated:

- shown only when you ask for it
- cleared after 120 seconds, or immediately on Enter
- scrollback is wiped too, not just the visible screen
- never written to a file, a log, or the clipboard

Do not run `pair` while screen sharing, and do not screenshot the code.

## Losing a phone

Rotate the key:

```bash
cd bridge && npm run pair -- --rotate
```

It asks you to type `rotate` first, because this is not reversible. Every
paired phone immediately stops being able to decrypt anything, including
sessions already published. Pair your remaining phones again from the new code.

Rotating does not touch your Firebase account or sign-in. To revoke those too:

```bash
security delete-generic-password -s claude-bridge -a refreshToken
```

then remove the app at <https://myaccount.google.com/permissions>.
