package dev.claudebridge

import android.content.Context
import androidx.core.content.edit

/**
 * The set of muted session ids, persisted in the same non-secret prefs as the
 * pairing. Muting only suppresses the local notification — the push is
 * data-only and composed on this phone — so nothing about it leaves the device
 * and it is a display preference, not session data.
 */
object Mutes {
    private const val PREFS = "claude-bridge"
    private const val KEY = "mutedSessions"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isMuted(context: Context, sessionId: String): Boolean =
        prefs(context).getStringSet(KEY, emptySet())?.contains(sessionId) == true

    /** Flip the mute for [sessionId] and return the new state. */
    fun toggle(context: Context, sessionId: String): Boolean {
        // The returned set must not be mutated in place, so copy it first.
        val current = prefs(context).getStringSet(KEY, emptySet()).orEmpty().toMutableSet()
        val muted = if (sessionId in current) {
            current.remove(sessionId)
            false
        } else {
            current.add(sessionId)
            true
        }
        prefs(context).edit { putStringSet(KEY, current) }
        return muted
    }
}
