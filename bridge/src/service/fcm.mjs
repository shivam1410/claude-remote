// Sending pushes from the Mac, using the signed-in user's own credential.
//
// The original design put a Cloud Function in front of this, which needs the
// Blaze plan. FCM itself is free on every plan, and the FCM v1 API accepts a
// user access token carrying the firebase.messaging scope — measured, not
// assumed. So no service account key has to exist on disk, which is what the
// nhi7 rule forbids and what made the Cloud Function the original choice.
//
// What travels is still only { v, blob }. The phone decrypts and composes the
// notification text locally; Google never sees anything readable.
import { getAccessToken } from './auth.mjs';

const SEND_TIMEOUT_MS = 10_000;

// FCM's own vocabulary for a token that will never work again. Anything else
// — a timeout, a 503 — is transient and the device is left registered.
const DEAD_TOKEN_ERRORS = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
]);

function endpoint(projectId) {
  return `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
}

/**
 * Send one sealed payload to one device.
 *
 * Returns { ok } on success, or { ok: false, dead } where `dead` means the
 * token should be dropped rather than retried.
 */
export async function sendToToken(config, accessToken, token, blob) {
  const response = await fetch(endpoint(config.projectId), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        // Data-only. A notification block would put readable text in
        // Google's hands and show it without the app ever decrypting.
        data: { v: '1', blob },
        // High priority survives Doze, which is the only time a push about a
        // blocked session is worth anything.
        android: { priority: 'high' },
      },
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (response.ok) return { ok: true };

  const body = await response.json().catch(() => null);
  const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode
    ?? body?.error?.status;
  return { ok: false, dead: DEAD_TOKEN_ERRORS.has(code), code: code ?? response.status };
}

/**
 * Send to every registered device. Returns the tokens that are dead and
 * should be unregistered.
 *
 * A send failure is never fatal: the session state is already in the database
 * and the phone will show it on next open. A push is a nudge, not the record.
 */
export async function broadcast(config, devices, blob, deps = {}) {
  const { accessToken = await getAccessToken(config), send = sendToToken } = deps;
  if (!accessToken) return { sent: 0, dead: [], reason: 'no messaging credential' };

  const dead = [];
  let sent = 0;
  for (const [installId, device] of Object.entries(devices ?? {})) {
    const token = device?.fcmToken;
    if (typeof token !== 'string' || token === '') continue;

    try {
      const result = await send(config, accessToken, token, blob);
      if (result.ok) sent += 1;
      else if (result.dead) dead.push(installId);
    } catch {
      // Network trouble. Leave the device registered and move on.
    }
  }
  return { sent, dead };
}
