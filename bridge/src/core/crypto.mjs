// AES-256-GCM sealing for session payloads.
//
// Wire format: base64( nonce[12] || ciphertext || tag[16] ).
// The key is the 32-byte secret shared with the paired Android device; it never
// leaves the Mac Keychain or the Android Keystore, so the Firebase host only
// ever stores opaque bytes.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new TypeError(`key must be a ${KEY_BYTES}-byte Buffer`);
  }
}

/** Seal a JSON-serialisable payload. Returns base64 of nonce || ciphertext || tag. */
export function seal(key, payload) {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/** Open a sealed blob. Throws on any tampering — never returns partial plaintext. */
export function open(key, blob) {
  assertKey(key);
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new Error('sealed blob is too short to be valid');
  }
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  // decipher.final() throws if the tag does not verify.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/** Generate a fresh 32-byte shared key. */
export function generateKey() {
  return randomBytes(KEY_BYTES);
}

export const constants = { ALGORITHM, KEY_BYTES, NONCE_BYTES, TAG_BYTES };
