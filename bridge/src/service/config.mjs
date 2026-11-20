// Local, non-secret-ish configuration: project identifiers and the OAuth client.
//
// The file lives outside the repo at ~/.claude-bridge/config.json so that no
// project identifier is ever committed. The real credential — the refresh token
// — is in the Keychain, never here.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = process.env.CLAUDE_BRIDGE_HOME
  ?? join(homedir(), '.claude-bridge');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const SPOOL_DIR = join(CONFIG_DIR, 'spool');

const REQUIRED = ['projectId', 'apiKey', 'databaseUrl', 'oauthClientId', 'oauthClientSecret'];

/**
 * Validate a parsed config object. Returns the normalised config.
 * Throws with an actionable message rather than failing later at the network.
 */
export function validate(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('config must be a JSON object');
  }
  const missing = REQUIRED.filter((k) => typeof raw[k] !== 'string' || raw[k].trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `config is missing: ${missing.join(', ')}. See docs/firebase-setup.md.`,
    );
  }
  if (!/^https:\/\/[\w.-]+\.firebasedatabase\.app\/?$/.test(raw.databaseUrl)) {
    throw new Error(
      `databaseUrl must be the Realtime Database https URL, got: ${raw.databaseUrl}`,
    );
  }
  return {
    ...raw,
    databaseUrl: raw.databaseUrl.replace(/\/$/, ''),
  };
}

/** Load and validate the config, warning when its permissions are too open. */
export function load() {
  let text;
  try {
    text = readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    throw new Error(`no config at ${CONFIG_PATH}. See docs/firebase-setup.md.`);
  }

  const mode = statSync(CONFIG_PATH).mode & 0o777;
  if (mode & 0o077) {
    process.emitWarning(
      `${CONFIG_PATH} is mode ${mode.toString(8)}; run: chmod 600 ${CONFIG_PATH}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`config at ${CONFIG_PATH} is not valid JSON: ${error.message}`);
  }
  return validate(parsed);
}
