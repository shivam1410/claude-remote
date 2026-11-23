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
    private const val KEY_ALL = "notificationsOn"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Master switch for all notifications on this phone. On by default. */
    fun notificationsOn(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ALL, true)

    /** Flip the master switch and return the new state. */
    fun toggleAll(context: Context): Boolean {
        val next = !notificationsOn(context)
        prefs(context).edit { putBoolean(KEY_ALL, next) }
        return next
    }

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
