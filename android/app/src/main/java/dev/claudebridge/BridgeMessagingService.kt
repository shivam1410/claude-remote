package dev.claudebridge

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives the data-only push and builds the notification locally.
 *
 * The message carries ciphertext, so the title and body are composed here,
 * after decryption, and never travel through Google's servers as text.
 */
class BridgeMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // Registered against the signed-in uid; the Cloud Function reads it.
        Devices.register(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val blob = message.data["blob"] ?: return
        Notifications.showSession(applicationContext, blob)
    }
}
