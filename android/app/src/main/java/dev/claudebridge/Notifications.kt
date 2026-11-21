package dev.claudebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
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

        // Muted on this phone: the session still updates in the list, it just
        // does not raise a notification.
        if (Mutes.isMuted(context, session.sessionId)) return

        val name = session.title.ifEmpty { session.project }
        val title = when (session.state) {
            "waiting_input" -> "$name needs you"
            "waiting_approval" -> "$name wants permission"
            "error" -> "$name hit an error"
            "done" -> "$name finished"
            else -> name
        }

        ensureChannel(context)
        val notificationId = session.sessionId.hashCode()
        val tap = PendingIntent.getActivity(
            context,
            notificationId,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(MainActivity.EXTRA_SESSION_ID, session.sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            // Claude's coral tints the small icon and the action label.
            .setColor(0xFFD97757.toInt())
            .setContentTitle(title)
            .setContentText(plainText(session.summary).ifEmpty { session.state })
            .setStyle(NotificationCompat.BigTextStyle().bigText(plainText(session.summary)))
            .setAutoCancel(true)
            .setContentIntent(tap)

        // "Open in Claude" only when the session is on Remote Control: that is
        // the one way to reply into a live session, which this app cannot.
        session.openUrl?.let { url ->
            // Through the trampoline, not straight to ACTION_VIEW, so the
            // notification is dismissed as the Claude app opens.
            val open = PendingIntent.getActivity(
                context,
                url.hashCode(),
                Intent(context, OpenUrlActivity::class.java)
                    .putExtra(OpenUrlActivity.EXTRA_URL, url)
                    .putExtra(OpenUrlActivity.EXTRA_NOTIFICATION_ID, notificationId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(R.drawable.ic_claude, "Open in Claude", open)
        }

        val notification = builder.build()

        try {
            // One notification per session: a later update replaces the earlier
            // one rather than stacking five lines about the same thing.
            NotificationManagerCompat.from(context).notify(notificationId, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted. The in-app list still works.
        }
    }

    // A notification is plain text: the Compose list renders markdown, but here
    // "**tetet**" would show its asterisks. Strip the common inline markers
    // (bold, italic, code, links) so the body reads clean.
    private fun plainText(md: String): String =
        md.replace(Regex("""\*\*(.*?)\*\*"""), "$1")
            .replace(Regex("""__(.*?)__"""), "$1")
            .replace(Regex("""(?<!\*)\*(?!\*)(.+?)\*"""), "$1")
            .replace(Regex("""`([^`]*)`"""), "$1")
            .replace(Regex("""\[([^\]]+)]\([^)]+\)"""), "$1")
            .trim()

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
