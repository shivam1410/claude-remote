// The pairing payload: what the QR code carries from this Mac to the phone.
//
// Pure encode and decode, so the format is testable without a camera, a
// terminal, or a Firebase project. The payload holds the shared key in the
// clear — the QR *is* the secure channel, which is why it is shown on screen
// for a bounded time and never written to a file.
//
// Deliberately minimal. The Android app already ships google-services.json
// with the project id and API key, so putting them here would widen what is on
// screen for no gain.

export const SCHEME = 'cbridge';
export const VERSION = 1;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

/** Build the URI the QR encodes. */
export function encode({ key, uid, databaseUrl }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('key must be a 32-byte Buffer');
  }
  if (!uid || typeof uid !== 'string') throw new TypeError('uid is required');
  if (!databaseUrl || typeof databaseUrl !== 'string') throw new TypeError('databaseUrl is required');

  const params = new URLSearchParams({
    v: String(VERSION),
    k: base64url(key),
    u: uid,
    d: databaseUrl.replace(/\/$/, ''),
  });
  return `${SCHEME}://pair?${params}`;
}

/** Parse a pairing URI back. Throws on anything malformed or unsupported. */
export function decode(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(`${SCHEME}://pair?`)) {
    throw new Error('not a pairing URI');
  }
  const params = new URLSearchParams(uri.slice(`${SCHEME}://pair?`.length));

  const version = Number(params.get('v'));
  if (version !== VERSION) {
    throw new Error(`unsupported pairing version ${params.get('v') ?? '(none)'}`);
  }

  const key = fromBase64url(params.get('k') ?? '');
  if (key.length !== 32) throw new Error('pairing key is not 32 bytes');

  const uid = params.get('u');
  const databaseUrl = params.get('d');
  if (!uid || !databaseUrl) throw new Error('pairing URI is missing uid or databaseUrl');

  return { key, uid, databaseUrl };
}
