package dev.claudebridge

import android.content.Context
import androidx.core.content.edit
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import java.util.UUID

/**
 * This handset's entry under /u/{uid}/devices.
 *
 * The Cloud Function reads it to know where to send a push and prunes it when
 * FCM reports the token dead, so an uninstall cleans itself up.
 */
object Devices {
    private const val PREFS = "claude-bridge"
    private const val KEY_INSTALL_ID = "installId"

    /** A stable id for this install, so reinstalling does not orphan a token. */
    fun installId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_INSTALL_ID, null)?.let { return it }
        return UUID.randomUUID().toString().also { prefs.edit { putString(KEY_INSTALL_ID, it) } }
    }

    fun register(context: Context, token: String) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        FirebaseDatabase.getInstance()
            .getReference("/u/$uid/devices/${installId(context)}")
            .setValue(mapOf("fcmToken" to token, "updatedAt" to System.currentTimeMillis()))
    }

    fun unregister(context: Context) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        FirebaseDatabase.getInstance()
            .getReference("/u/$uid/devices/${installId(context)}")
            .removeValue()
    }
}
