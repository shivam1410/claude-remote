# Firebase setup

One-time console work, then four values go into a local config file. Nothing
here is committed: the config file lives outside the repo and the only true
secret (the refresh token) lives in the macOS Keychain.

## 1. Enable the three services

In the Firebase console for your personal project:

- **Realtime Database** — create a database. Note its URL, which looks like
  `https://<name>-default-rtdb.<region>.firebasedatabase.app`.
- **Authentication** — enable the Google sign-in provider.
- **Cloud Messaging** — no setup yet; Phase 7 uses it.

## 2. Publish the security rules

Paste the contents of `firebase/database.rules.json` into
Realtime Database -> Rules -> Publish.

These rules deny everything by default and allow read and write only under
`/u/<your uid>`, only for a signed-in token whose `auth.uid` matches that path.
They also cap each encrypted blob at 4 KB, so a bug cannot turn this database
into a transcript store.

## 3. Create a Desktop OAuth client

The Mac service signs in as you, using a loopback redirect. It never holds a
service-account key, so it can never act as the project itself.

Google Cloud console -> APIs & Services -> Credentials -> Create credentials ->
OAuth client ID -> **Desktop app**. Copy the client ID and client secret.

A Desktop-app client secret is not a true secret — Google documents it as
non-confidential for installed apps, which is why PKCE is used as well — but it
still does not belong in source control.

## 4. Find your Web API key

Project settings -> General -> Web API Key. This identifies the project to the
Identity Toolkit; it is not a credential on its own.

## 5. Write the config

Create `~/.claude-bridge/config.json` with mode 600:

```json
{
  "projectId": "your-project-id",
  "apiKey": "your-web-api-key",
  "databaseUrl": "https://your-db-default-rtdb.region.firebasedatabase.app",
  "oauthClientId": "....apps.googleusercontent.com",
  "oauthClientSecret": "..."
}
```

```bash
mkdir -p ~/.claude-bridge && chmod 700 ~/.claude-bridge
# write the file, then:
chmod 600 ~/.claude-bridge/config.json
```

## 6. Sign in once

```bash
node bridge/src/service/auth.mjs --login
```

A browser window opens, you pick your Google account, and the service exchanges
the result for a Firebase refresh token. That token is stored in the login
Keychain under service `claude-bridge` and is never written to disk in plain
text. The printed uid is the only account allowed by the rules above.

To revoke everything: remove the Keychain items, then revoke the app under
<https://myaccount.google.com/permissions>.

```bash
security delete-generic-password -s claude-bridge -a refreshToken
security delete-generic-password -s claude-bridge -a sharedKey
```

Deleting `sharedKey` also orphans every paired phone, which is the intended
response to a lost handset.

## 7. Check your work

```bash
cd bridge && npm run doctor
```

It stops at the first unfinished step and masks every secret, so the output is
safe to paste. When it reaches the end it has written, read back, and deleted a
probe node through the live rules — that is the proof the whole chain works.
