// Sign the bridge in as you, not as the project.
//
// Deliberately NOT a service-account key: a key file on a work laptop is a
// long-lived static credential with project-wide power, and it would bypass the
// database rules entirely. Instead this does a loopback OAuth flow with PKCE,
// exchanges the Google ID token for a Firebase one, and keeps only a refresh
// token in the Keychain. Every database write then arrives with auth.uid set to
// your uid, so the rules are a real boundary rather than decoration.
//
// Scopes requested: openid and email. Nothing else. The bridge cannot read your
// mail, your drive, or any other project.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { load } from './config.mjs';
import * as keychain from './keychain.mjs';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const IDP_ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const REFRESH_ENDPOINT = 'https://securetoken.googleapis.com/v1/token';
const SCOPES = 'openid email';
const LOGIN_TIMEOUT_MS = 180_000;

// Google returns the whole request URL in some error paths, and ours carries the
// API key as a query parameter. Strip every query string before anything is
// thrown, printed, or logged.
function redactUrl(url) {
  const index = url.indexOf('?');
  return index === -1 ? url : `${url.slice(0, index)}?<redacted>`;
}

// Turn the opaque Identity Toolkit codes into something actionable.
const REMEDIES = {
  CONFIGURATION_NOT_FOUND:
    'Firebase Authentication is not set up on this project. '
    + 'Open the Firebase console -> Authentication -> Get started, '
    + 'then enable the Google sign-in provider, and run this again.',
  OPERATION_NOT_ALLOWED:
    'The Google sign-in provider is disabled. '
    + 'Enable it under Firebase console -> Authentication -> Sign-in method.',
  INVALID_IDP_RESPONSE:
    'Google rejected the credential. Run the login again; if it repeats, '
    + 'recreate the Desktop OAuth client.',
  invalid_client:
    'The OAuth client is not recognised yet. A newly created client can take '
    + 'a few minutes to propagate — wait and retry.',
};

function describe(url, status, code) {
  const remedy = REMEDIES[code];
  const base = `${redactUrl(url)} failed: ${status} ${code ?? ''}`.trim();
  return remedy ? `${base}\n\n${remedy}` : base;
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(describe(url, response.status, body.error?.message ?? body.error));
  }
  return body;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(describe(url, response.status, body.error?.message));
  }
  return body;
}

/** Full interactive sign-in. Writes the refresh token and uid to the Keychain. */
export async function login(config = load()) {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  // Start the listener first so the redirect cannot arrive before we are ready.
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('sign-in timed out after 3 minutes'));
    }, LOGIN_TIMEOUT_MS);

    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const page = (message) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>claude-bridge</title>
<body style="font:16px system-ui;padding:3rem"><p>${message}</p>
<p style="color:#666">You can close this tab.</p>`);
      };

      clearTimeout(timer);
      if (error || !code || returnedState !== state) {
        page('Sign-in did not complete. Nothing was changed.');
        server.close();
        reject(new Error(error ? `authorization failed: ${error}` : 'authorization response did not match the request'));
        return;
      }
      page('Signed in. The bridge now has a token.');
      server.close();
      resolve(code);
    });
  });

  const authUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
    client_id: config.oauthClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })}`;

  // CLAUDE_BRIDGE_BROWSER picks the app: an application name as `open -a`
  // understands it, e.g. Firefox or "Google Chrome". Unset uses the default.
  const browser = process.env.CLAUDE_BRIDGE_BROWSER;
  const openArgs = browser ? ['-a', browser, authUrl] : [authUrl];

  console.log(`Opening ${browser ?? 'your default browser'} to sign in…`);
  console.log(authUrl);
  execFile('open', openArgs, (error) => {
    if (error) {
      console.error(`could not open ${browser ?? 'a browser'}: ${error.message}`);
      console.error('Paste the URL above into a browser instead.');
    }
  });

  const code = await codePromise;

  const google = await postForm(TOKEN_ENDPOINT, {
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const firebase = await postJson(`${IDP_ENDPOINT}?key=${config.apiKey}`, {
    postBody: `id_token=${google.id_token}&providerId=google.com`,
    requestUri: redirectUri,
    returnSecureToken: true,
  });

  await keychain.set(keychain.accounts.REFRESH_TOKEN, firebase.refreshToken);
  await keychain.set(keychain.accounts.UID, firebase.localId);

  return { uid: firebase.localId, email: firebase.email };
}

// One in-memory token, refreshed slightly early so a long write never races
// expiry. Not cached on disk: a stolen disk should yield nothing usable.
let cached = { idToken: null, expiresAt: 0, uid: null };

/** Return a valid Firebase ID token, refreshing when needed. */
export async function getIdToken(config = load()) {
  if (cached.idToken && Date.now() < cached.expiresAt) return cached;

  const refreshToken = await keychain.get(keychain.accounts.REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error('not signed in. Run: node bridge/src/service/auth.mjs --login');
  }

  const body = await postForm(`${REFRESH_ENDPOINT}?key=${config.apiKey}`, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  cached = {
    idToken: body.id_token,
    uid: body.user_id,
    expiresAt: Date.now() + (Number(body.expires_in) - 60) * 1000,
  };
  return cached;
}

/** Forget the in-memory token. Used by tests and after an auth failure. */
export function resetTokenCache() {
  cached = { idToken: null, expiresAt: 0, uid: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = load();
  if (process.argv.includes('--login')) {
    const { uid, email } = await login(config);
    console.log(`Signed in as ${email}`);
    console.log(`uid: ${uid}`);
    console.log('Refresh token stored in the login Keychain under service "claude-bridge".');
  } else if (process.argv.includes('--status')) {
    const { uid } = await getIdToken(config);
    console.log(`Signed in. uid: ${uid}`);
  } else {
    console.log('usage: node auth.mjs --login | --status');
  }
}
