// Realtime Database over REST, authenticated with the user's Firebase ID token.
//
// REST rather than the Firebase SDK: this process writes a handful of small
// nodes per session, and the SDK would pull in a websocket stack and a service
// identity we deliberately do not have. Every request carries the ID token, so
// the database rules apply to the bridge exactly as they apply to the phone.
import { getIdToken } from './auth.mjs';

const TIMEOUT_MS = 10_000;

async function request(config, method, path, body) {
  const { idToken, uid } = await getIdToken(config);
  const url = `${config.databaseUrl}/u/${uid}${path}.json?auth=${encodeURIComponent(idToken)}`;

  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // The URL is never logged: it carries the ID token as a query parameter.
    throw new Error(`database ${method} /u/<uid>${path} failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

/** Replace a session node. */
export function putSession(config, sessionId, node) {
  return request(config, 'PUT', `/sessions/${sessionId}`, node);
}

/** Remove a session node — used the moment a session ends, per decision D5. */
export function deleteSession(config, sessionId) {
  return request(config, 'DELETE', `/sessions/${sessionId}`);
}

/** Read every pending reply. */
export function listReplies(config) {
  return request(config, 'GET', '/replies');
}

/**
 * Record why a delivery failed, on the reply itself.
 *
 * Sealed like everything else: the message can name a path or a command, and
 * that is exactly the kind of detail the console must not see.
 */
export function putReplyError(config, pushId, blob) {
  return request(config, 'PUT', `/replies/${pushId}/errorBlob`, blob);
}

/** Remove a reply once it has been delivered. */
export function deleteReply(config, pushId) {
  return request(config, 'DELETE', `/replies/${pushId}`);
}

/** Publish one pending tool-approval request. */
export function putApproval(config, requestId, node) {
  return request(config, 'PUT', `/approvals/${requestId}`, node);
}

/** Read every approval request, answered or not. */
export function listApprovals(config) {
  return request(config, 'GET', '/approvals');
}

/** Remove an approval request once it is answered or has expired. */
export function deleteApproval(config, requestId) {
  return request(config, 'DELETE', `/approvals/${requestId}`);
}

/**
 * Queue one push for fan-out. The Cloud Function picks it up, sends it to every
 * registered device, and deletes it.
 */
export function putPush(config, pushId, node) {
  return request(config, 'PUT', `/pushes/${pushId}`, node);
}

/** Read every queued push, so stale ones can be pruned. */
export function listPushes(config) {
  return request(config, 'GET', '/pushes');
}

/** Remove one push. */
export function deletePush(config, pushId) {
  return request(config, 'DELETE', `/pushes/${pushId}`);
}

/** Read the uid the bridge is currently authenticated as. */
export async function currentUid(config) {
  return (await getIdToken(config)).uid;
}
