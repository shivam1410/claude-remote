package dev.claudebridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.app.NotificationManagerCompat

/**
 * Trampoline for the notification's "Open in Claude" action.
 *
 * A notification *action* does not dismiss the notification the way a body tap
 * with setAutoCancel does, and the action fires ACTION_VIEW straight at the
 * Claude app — which can't clear our notification. So it goes through here
 * instead: cancel the notification, hand the URL on, finish. An activity
 * trampoline is allowed on Android 12+, unlike a broadcast or service one.
 */
class OpenUrlActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        if (notificationId != -1) {
            NotificationManagerCompat.from(this).cancel(notificationId)
        }

        intent.getStringExtra(EXTRA_URL)?.let { url ->
            runCatching {
                startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
        finish()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_NOTIFICATION_ID = "notificationId"
    }
}
