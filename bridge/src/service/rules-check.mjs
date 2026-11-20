#!/usr/bin/env node
// Live denial proof for the database rules.
//
// Unit tests cannot cover this: the rules run on Google's servers, and the only
// honest check is to hold a real token and be refused. Run it after any change
// to firebase/database.rules.json, and after deploying them.
//
// Every probe but the control must be denied. The control proves the token is
// genuinely valid, so that a blanket outage cannot masquerade as good security.
import { load } from './config.mjs';
import { getIdToken } from './auth.mjs';

const OTHER_UID = 'SOMEONEELSEUID000000000000000000';

const config = load();
const { idToken, uid } = await getIdToken(config);
const auth = `?auth=${encodeURIComponent(idToken)}`;

const probes = [
  { label: 'write to another uid', method: 'PUT', path: `/u/${OTHER_UID}/sessions/evil`, body: { v: 1, updatedAt: 1, blob: 'eA==' } },
  { label: 'read another uid', method: 'GET', path: `/u/${OTHER_UID}/sessions` },
  { label: 'read the whole tree', method: 'GET', path: '/' },
  { label: 'write outside /u', method: 'PUT', path: '/admin/evil', body: { x: 1 } },
  { label: 'unexpected subtree', method: 'PUT', path: `/u/${uid}/secrets/x`, body: { x: 1 } },
  { label: 'session without a blob', method: 'PUT', path: `/u/${uid}/sessions/nb`, body: { v: 1, updatedAt: 1 } },
  { label: 'oversized blob', method: 'PUT', path: `/u/${uid}/sessions/big`, body: { v: 1, updatedAt: 1, blob: 'A'.repeat(5000) } },
  { label: 'own session (control)', method: 'PUT', path: `/u/${uid}/sessions/__rules_probe`, body: { v: 1, updatedAt: 1, blob: 'eA==' }, expectAllowed: true },
];

let failures = 0;
for (const probe of probes) {
  const response = await fetch(`${config.databaseUrl}${probe.path}.json${auth}`, {
    method: probe.method,
    headers: probe.body ? { 'content-type': 'application/json' } : {},
    body: probe.body ? JSON.stringify(probe.body) : undefined,
  });
  const denied = response.status === 401 || response.status === 403;
  const ok = probe.expectAllowed ? !denied : denied;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${probe.label.padEnd(24)} HTTP ${response.status}`);
}

// Remove the control probe so the database is left as it was found.
await fetch(`${config.databaseUrl}/u/${uid}/sessions/__rules_probe.json${auth}`, { method: 'DELETE' });

console.log(failures === 0 ? '\nAll rule probes behaved as specified.' : `\n${failures} probe(s) behaved unexpectedly.`);
process.exitCode = failures === 0 ? 0 : 1;
