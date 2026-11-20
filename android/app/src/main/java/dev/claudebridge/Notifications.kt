package dev.claudebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Notification text is built here, on the device, from a decrypted payload.
 * Nothing readable arrives in the push itself.
 */
object Notifications {
    private const val CHANNEL_ID = "sessions"

    fun showSession(context: Context, blob: String) {
        val key = Vault.key() ?: return
        val session = try {
            BridgeJson.decodeFromString<SessionPayload>(Crypto.openToString(key, blob))
        } catch (e: Exception) {
            // Sealed with a key this phone does not have, or malformed. There is
            // nothing useful to show and nothing worth logging.
            return
        }

        val title = when (session.state) {
            "waiting_input" -> "${session.project} needs you"
            "waiting_approval" -> "${session.project} wants permission"
            "error" -> "${session.project} hit an error"
            "done" -> "${session.project} finished"
            else -> session.project
        }

        ensureChannel(context)
        val tap = PendingIntent.getActivity(
            context,
            session.sessionId.hashCode(),
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(MainActivity.EXTRA_SESSION_ID, session.sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(session.summary.ifEmpty { session.state })
            .setStyle(NotificationCompat.BigTextStyle().bigText(session.summary))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()

        try {
            // One notification per session: a later update replaces the earlier
            // one rather than stacking five lines about the same thing.
            NotificationManagerCompat.from(context).notify(session.sessionId.hashCode(), notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted. The in-app list still works.
        }
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.channel_sessions),
                NotificationManager.IMPORTANCE_HIGH,
            ),
        )
    }
}
