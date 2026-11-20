package dev.claudebridge

import android.content.Context
import androidx.core.content.edit

/**
 * The non-secret half of a pairing: which account the Mac signed in as, and
 * which database it writes to. Both are public identifiers — the secret half is
 * the key, and that lives in [Vault], never here.
 *
 * The uid is what pins this app to one account (decision D4). Signing in as a
 * different Google account is refused rather than silently showing an empty list.
 */
object Paired {
    private const val PREFS = "claude-bridge"
    private const val KEY_UID = "pairedUid"
    private const val KEY_DB = "databaseUrl"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun uid(context: Context): String? = prefs(context).getString(KEY_UID, null)

    fun databaseUrl(context: Context): String? = prefs(context).getString(KEY_DB, null)

    /** Accept a scanned pairing: key into the Keystore, the rest into prefs. */
    fun accept(context: Context, pairing: Pairing) {
        // Keystore first. If the import fails the pairing is not recorded at
        // all, rather than leaving a uid with no key to decrypt anything.
        Vault.store(pairing.key)
        prefs(context).edit {
            putString(KEY_UID, pairing.uid)
            putString(KEY_DB, pairing.databaseUrl)
        }
    }

    /** Forget everything about the pairing. Used when a phone is being handed on. */
    fun clear(context: Context) {
        Vault.clear()
        prefs(context).edit {
            remove(KEY_UID)
            remove(KEY_DB)
        }
    }
}
