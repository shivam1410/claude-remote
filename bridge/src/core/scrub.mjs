// Redaction pass applied to every string that leaves this machine.
//
// This is defence in depth, not the primary control: the payload is also
// encrypted and capped at a short summary. The point is that a secret pasted
// into a prompt must not survive into a notification, a log, or a spool file.
//
// Order matters. Specific, high-confidence patterns run before the generic
// high-entropy sweep so that a JWT is labelled a JWT rather than a blob.

const PATTERNS = [
  // Vendor-prefixed API keys.
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, 'anthropic-key'],
  [/\bsk-[A-Za-z0-9]{16,}/g, 'api-key'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, 'github-token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github-token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'slack-token'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, 'google-key'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'aws-key-id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'private-key'],

  // JWTs: three base64url segments, first one starts an encoded JSON header.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'jwt'],

  // Authorization headers and inline bearer tokens.
  [/\b(?:bearer|token|authorization)\s*[:=]?\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'bearer-token'],

  // Obvious key=value secrets.
  [/\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+/gi, 'secret'],

  // Contact details.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'email'],

  // Long hex runs: hashes, raw keys, session ids pasted as hex.
  [/\b[0-9a-fA-F]{32,}\b/g, 'hex'],
];

// Generic high-entropy sweep for anything the named patterns missed. Only fires
// on long mixed-case-plus-digit runs so that ordinary long words survive.
const BLOB = /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;

function looksRandom(token) {
  return /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token);
}

/**
 * Redact secrets and contact details from a string.
 * Returns the input unchanged when it holds nothing sensitive.
 */
export function scrub(text) {
  if (typeof text !== 'string' || text.length === 0) return '';

  let out = text;
  for (const [pattern, label] of PATTERNS) {
    out = out.replace(pattern, `[redacted:${label}]`);
  }
  out = out.replace(BLOB, (match) =>
    looksRandom(match) ? '[redacted:blob]' : match,
  );
  return out;
}
