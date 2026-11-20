// FCM fan-out.
//
// The bridge writes a node under /u/{uid}/pushes when something happens that
// is worth waking the phone for. This function forwards that node's ciphertext
// to every device registered for the same uid and then deletes it.
//
// It cannot read what it sends. `blob` is sealed with the key shared between
// the Mac and the phone, which never exists in this project. That is the point:
// a function with full admin access to the database still learns nothing about
// the work being done. It moves an opaque string and no more.
//
// The message is data-only — no `notification` block — so Android builds the
// notification text locally after decrypting. A notification block here would
// mean the title and body travelled in the clear through Google's servers.
import { onValueCreated } from 'firebase-functions/v2/database';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

initializeApp();

// Tokens Google tells us are dead. Keeping them would mean every later push
// reports partial failure and the device list grows forever.
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export const onPush = onValueCreated(
  { ref: '/u/{uid}/pushes/{pushId}', region: 'us-central1' },
  async (event) => {
    const { uid, pushId } = event.params;
    const node = event.data.val();
    const db = getDatabase();
    const pushRef = db.ref(`/u/${uid}/pushes/${pushId}`);

    if (typeof node?.blob !== 'string') {
      await pushRef.remove();
      return;
    }

    const devices = (await db.ref(`/u/${uid}/devices`).get()).val() ?? {};
    const entries = Object.entries(devices)
      .filter(([, d]) => typeof d?.fcmToken === 'string' && d.fcmToken !== '');

    if (entries.length === 0) {
      await pushRef.remove();
      return;
    }

    const response = await getMessaging().sendEachForMulticast({
      tokens: entries.map(([, d]) => d.fcmToken),
      // Strings only: FCM data values must be strings.
      data: { v: String(node.v ?? 1), blob: node.blob },
      android: {
        // Without high priority the message waits for the next Doze window,
        // which defeats the purpose of telling someone their session is stuck.
        priority: 'high',
      },
    });

    const dead = response.responses
      .map((r, i) => (r.success || !DEAD_TOKEN_ERRORS.has(r.error?.code) ? null : entries[i][0]))
      .filter(Boolean);

    await Promise.all([
      pushRef.remove(),
      ...dead.map((installId) => db.ref(`/u/${uid}/devices/${installId}`).remove()),
    ]);
  },
);
