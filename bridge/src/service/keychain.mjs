// macOS Keychain access for the two long-lived secrets this bridge holds:
// the Firebase refresh token and the 32-byte key shared with the phone.
//
// Neither is ever written to a file. `security` is invoked with execFile and an
// argument array, so no secret is ever interpolated into a shell string where it
// could land in a process listing or a shell history file.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SERVICE = 'claude-bridge';

/** Read a secret. Returns null when the item does not exist. */
export async function get(account) {
  try {
    const { stdout } = await run('security', [
      'find-generic-password', '-s', SERVICE, '-a', account, '-w',
    ]);
    return stdout.trimEnd();
  } catch (error) {
    // Exit status 44 is "item not found", which is a normal first-run state.
    if (error?.code === 44 || /could not be found/i.test(error?.stderr ?? '')) {
      return null;
    }
    throw new Error(`keychain read failed for ${account}: ${error.message}`);
  }
}

/** Write a secret, replacing any existing item for the same account. */
export async function set(account, value) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`refusing to store an empty secret for ${account}`);
  }
  // -U updates in place; -w takes the value as an argv element, not via stdin,
  // which `security` does not support for this subcommand.
  await run('security', [
    'add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value,
    '-D', 'claude-bridge secret',
    '-j', 'Used by the remote-session-bridge service. Safe to delete; deleting the shared key unpairs every phone.',
  ]);
}

/** Remove a secret. Succeeds whether or not the item existed. */
export async function remove(account) {
  try {
    await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]);
  } catch (error) {
    if (error?.code === 44 || /could not be found/i.test(error?.stderr ?? '')) return;
    throw error;
  }
}

export const accounts = {
  REFRESH_TOKEN: 'refreshToken',
  // Google's own refresh token, kept beside Firebase's. Firebase ID tokens
  // authenticate database writes; only a Google token carries the messaging
  // scope that FCM requires.
  GOOGLE_REFRESH_TOKEN: 'googleRefreshToken',
  SHARED_KEY: 'sharedKey',
  UID: 'uid',
};
