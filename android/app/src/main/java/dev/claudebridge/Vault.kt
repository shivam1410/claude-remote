package dev.claudebridge

import android.security.keystore.KeyProperties
import android.security.keystore.KeyProtection
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * Where the key shared with the Mac lives once pairing is done.
 *
 * It is imported into the Android Keystore, which means the app can use it but
 * cannot read it back — and neither can anything that later reads the app's
 * files or a backup. The raw bytes exist only for the few milliseconds between
 * decoding the QR and [store] returning.
 */
object Vault {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "claude-bridge-shared-key"

    private fun keystore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    fun isPaired(): Boolean = keystore().containsAlias(ALIAS)

    /** Import the paired key, replacing whatever was there. */
    fun store(raw: ByteArray) {
        require(raw.size == Crypto.KEY_BYTES) { "key must be ${Crypto.KEY_BYTES} bytes" }
        keystore().setEntry(
            ALIAS,
            KeyStore.SecretKeyEntry(SecretKeySpec(raw, KeyProperties.KEY_ALGORITHM_AES)),
            KeyProtection.Builder(KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                // The provider must choose every nonce. Reusing one under
                // AES-GCM is catastrophic, and this makes it impossible.
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        raw.fill(0)
    }

    /** The key, or null when this phone has not been paired. */
    fun key(): SecretKey? = (keystore().getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey

    /** Forget the pairing. Used when the Mac rotates the key, or on sign-out. */
    fun clear() {
        val store = keystore()
        if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
    }
}
