#!/usr/bin/env node
// Show the pairing QR.
//
// The code on screen contains the shared key in the clear. That is unavoidable
// — it is how the key reaches the phone without a server ever holding it — so
// the exposure is bounded instead: the code is shown only on request, only for
// a short window, and the screen is cleared afterwards. It is never written to
// a file, a log, or the clipboard.
//
// Rotating replaces the key, which unpairs every phone that holds the old one.
// That is the response to a lost handset.
import { createInterface } from 'node:readline/promises';
import { load } from './config.mjs';
import { getIdToken } from './auth.mjs';
import { generateKey } from '../core/crypto.mjs';
import { encode } from './pairing.mjs';
import { render } from './qr.mjs';
import * as keychain from './keychain.mjs';

const DISPLAY_SECONDS = 120;

/** Fetch the shared key, creating one only when none exists. */
async function currentKey() {
  const existing = await keychain.get(keychain.accounts.SHARED_KEY);
  if (existing) return { key: Buffer.from(existing, 'base64'), created: false };

  const key = generateKey();
  await keychain.set(keychain.accounts.SHARED_KEY, key.toString('base64'));
  return { key, created: true };
}

/** Replace the shared key. Every already-paired phone stops being able to decrypt. */
async function rotateKey() {
  const key = generateKey();
  await keychain.set(keychain.accounts.SHARED_KEY, key.toString('base64'));
  return key;
}

async function confirmRotate() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      'Rotating the shared key unpairs every phone that is already paired,\n'
      + 'and sessions published under the old key become unreadable to them.\n'
      + 'Type "rotate" to continue: ',
    );
    return answer.trim() === 'rotate';
  } finally {
    rl.close();
  }
}

async function main() {
  const config = load();
  const rotate = process.argv.includes('--rotate');

  if (rotate && !(await confirmRotate())) {
    console.log('Cancelled. The existing key is unchanged.');
    return;
  }

  const { uid } = await getIdToken(config);
  const { key, created } = rotate
    ? { key: await rotateKey(), created: true }
    : await currentKey();

  const uri = encode({ key, uid, databaseUrl: config.databaseUrl });

  console.log();
  console.log(render(uri));
  console.log();
  console.log(`Scan with the claude-bridge app. uid ${uid}`);
  if (created) console.log(rotate ? 'Key rotated. Previously paired phones are now unpaired.' : 'A new shared key was created.');
  console.log(`\nThis code contains the encryption key. Clearing the screen in ${DISPLAY_SECONDS}s — press Enter to clear now.`);

  await Promise.race([
    new Promise((resolve) => setTimeout(resolve, DISPLAY_SECONDS * 1000)),
    new Promise((resolve) => process.stdin.once('data', resolve)),
  ]);

  // Clear the scrollback as well as the screen: a QR sitting in terminal
  // history is the same exposure as one on screen.
  process.stdout.write('\u001b[3J\u001b[2J\u001b[H');
  console.log('Pairing code cleared.');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
