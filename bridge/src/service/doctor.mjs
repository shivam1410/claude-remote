#!/usr/bin/env node
// Preflight check for the bridge.
//
// Answers one question at a time, in the order setup happens, and stops at the
// first thing that is not done yet. Secrets are masked: this is meant to be
// safe to run with someone looking over your shoulder, and safe to paste.
import { statSync } from 'node:fs';
import { CONFIG_PATH, SPOOL_DIR, load } from './config.mjs';
import * as keychain from './keychain.mjs';
import { getIdToken } from './auth.mjs';

const PASS = '  ok  ';
const FAIL = ' todo ';

function mask(value) {
  if (typeof value !== 'string' || value.length < 8) return '********';
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function line(ok, label, detail = '') {
  console.log(`[${ok ? PASS : FAIL}] ${label}${detail ? `  ${detail}` : ''}`);
}

async function main() {
  console.log(`config: ${CONFIG_PATH}\n`);

  // 1. Config file.
  let config;
  try {
    config = load();
  } catch (error) {
    line(false, 'config', error.message);
    console.log('\nNext: fill in the file above, then run this again.');
    process.exitCode = 1;
    return;
  }

  const mode = statSync(CONFIG_PATH).mode & 0o777;
  line(mode === 0o600, 'permissions', `mode ${mode.toString(8)}${mode === 0o600 ? '' : ` — run: chmod 600 ${CONFIG_PATH}`}`);
  line(true, 'projectId', config.projectId);
  line(true, 'databaseUrl', config.databaseUrl);
  line(true, 'apiKey', mask(config.apiKey));
  line(true, 'oauthClientId', config.oauthClientId.replace(/^(.{8}).*(\..*)$/, '$1…$2'));
  line(true, 'oauthClientSecret', mask(config.oauthClientSecret));

  // 2. Rules published? An unauthenticated read must be refused.
  try {
    const response = await fetch(`${config.databaseUrl}/u/anyone/sessions.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    const denied = response.status === 401 || response.status === 403;
    line(denied, 'rules deny anonymous reads', `HTTP ${response.status}`);
    if (!denied) {
      console.log('      Publish firebase/database.rules.json before going further.');
    }
  } catch (error) {
    line(false, 'rules reachable', error.message);
  }

  // 3. Signed in?
  const refreshToken = await keychain.get(keychain.accounts.REFRESH_TOKEN);
  if (!refreshToken) {
    line(false, 'signed in', 'run: node bridge/src/service/auth.mjs --login');
    process.exitCode = 1;
    return;
  }
  line(true, 'refresh token in Keychain', mask(refreshToken));

  // 4. Token still works.
  let uid;
  try {
    ({ uid } = await getIdToken(config));
    line(true, 'token exchange', `uid ${uid}`);
  } catch (error) {
    line(false, 'token exchange', error.message);
    process.exitCode = 1;
    return;
  }

  // 5. Real round trip through the rules: write, read back, delete.
  const probePath = `${config.databaseUrl}/u/${uid}/sessions/__doctor.json`;
  const { idToken } = await getIdToken(config);
  const auth = `?auth=${encodeURIComponent(idToken)}`;
  const node = { v: 1, updatedAt: Date.now(), blob: 'ZG9jdG9yLXByb2Jl' };
  try {
    const put = await fetch(probePath + auth, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(node),
    });
    if (!put.ok) throw new Error(`write refused: HTTP ${put.status} ${(await put.text()).slice(0, 120)}`);

    const read = await (await fetch(probePath + auth)).json();
    if (read?.blob !== node.blob) throw new Error('read back did not match');

    await fetch(probePath + auth, { method: 'DELETE' });
    line(true, 'write, read, delete', 'round trip succeeded, probe removed');
  } catch (error) {
    line(false, 'write, read, delete', error.message);
    process.exitCode = 1;
    return;
  }

  // 6. Shared key, for the phone.
  const key = await keychain.get(keychain.accounts.SHARED_KEY);
  line(Boolean(key), 'shared key', key ? '32 bytes in Keychain' : 'created on first service run');

  console.log(`\nspool: ${SPOOL_DIR}`);
  console.log('Ready. Start the service with: node bridge/src/service/index.mjs --once');
}

await main();
