import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcast } from '../src/service/fcm.mjs';

const config = { projectId: 'p' };
const devices = {
  phone: { fcmToken: 'tok-a' },
  tablet: { fcmToken: 'tok-b' },
  broken: {},
};

test('sends to every registered device and skips entries with no token', async () => {
  const seen = [];
  const result = await broadcast(config, devices, 'blob', {
    accessToken: 'at',
    send: async (_c, _t, token) => { seen.push(token); return { ok: true }; },
  });

  assert.deepEqual(seen, ['tok-a', 'tok-b']);
  assert.equal(result.sent, 2);
  assert.deepEqual(result.dead, []);
});

test('reports dead tokens by install id so they can be unregistered', async () => {
  // FCM only tells you a token is finished when you try to use it, so this is
  // the one chance to notice an uninstall.
  const result = await broadcast(config, devices, 'blob', {
    accessToken: 'at',
    send: async (_c, _t, token) =>
      (token === 'tok-a' ? { ok: false, dead: true } : { ok: true }),
  });

  assert.deepEqual(result.dead, ['phone']);
  assert.equal(result.sent, 1);
});

test('a transient failure leaves the device registered', async () => {
  const result = await broadcast(config, devices, 'blob', {
    accessToken: 'at',
    send: async () => { throw new Error('socket hang up'); },
  });

  assert.deepEqual(result.dead, []);
  assert.equal(result.sent, 0);
});

test('with no messaging credential it reports why rather than failing', async () => {
  // The bridge has to keep publishing state and delivering replies even when
  // it cannot push — the sign-in predates the messaging scope.
  const result = await broadcast(config, devices, 'blob', {
    accessToken: null,
    send: async () => assert.fail('must not send without a credential'),
  });

  assert.equal(result.sent, 0);
  assert.equal(result.reason, 'no messaging credential');
});
