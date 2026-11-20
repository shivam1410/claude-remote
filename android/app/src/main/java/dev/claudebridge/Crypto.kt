package dev.claudebridge

import java.security.GeneralSecurityException
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The wire format shared with the Mac: base64( nonce[12] || ciphertext || tag[16] ).
 *
 * Java's GCM cipher already appends the tag to the ciphertext, so the layout
 * matches Node's `Buffer.concat([nonce, ciphertext, authTag])` byte for byte.
 * There is a round-trip test against a blob produced by the Node implementation;
 * if either side's format drifts, that test fails rather than the phone silently
 * showing nothing.
 */
object Crypto {
    const val KEY_BYTES = 32
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    /** Wrap raw bytes as a key. Used by tests and by pairing, before the key
     *  is handed to the Keystore; at runtime the key comes from [Vault] and
     *  these bytes never exist. */
    fun keyOf(bytes: ByteArray): SecretKey {
        if (bytes.size != KEY_BYTES) throw GeneralSecurityException("key must be $KEY_BYTES bytes")
        return SecretKeySpec(bytes, "AES")
    }

    fun seal(key: ByteArray, plaintext: ByteArray): String = seal(keyOf(key), plaintext)

    fun seal(key: SecretKey, plaintext: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // Let the provider pick the nonce. A Keystore key is created with
        // randomised encryption required, which forbids a caller-supplied IV,
        // and GCM's default is the 12 bytes the Mac expects either way.
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val sealed = cipher.doFinal(plaintext)
        return Base64.getEncoder().encodeToString(cipher.iv + sealed)
    }

    fun seal(key: ByteArray, plaintext: String): String = seal(keyOf(key), plaintext.toByteArray())

    fun seal(key: SecretKey, plaintext: String): String = seal(key, plaintext.toByteArray())

    /**
     * Decrypt, or throw. Never returns plaintext for a tampered blob: GCM
     * authenticates, so a flipped bit anywhere raises instead of decoding.
     */
    fun open(key: ByteArray, blob: String): ByteArray = open(keyOf(key), blob)

    fun open(key: SecretKey, blob: String): ByteArray {
        val bytes = try {
            Base64.getDecoder().decode(blob)
        } catch (e: IllegalArgumentException) {
            throw GeneralSecurityException("blob is not base64", e)
        }
        // nonce + at least the tag. Anything shorter cannot be a sealed payload.
        if (bytes.size < NONCE_BYTES + TAG_BITS / 8) throw GeneralSecurityException("blob too short")

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, NONCE_BYTES))
        return cipher.doFinal(bytes, NONCE_BYTES, bytes.size - NONCE_BYTES)
    }

    fun openToString(key: ByteArray, blob: String): String = String(open(key, blob))

    fun openToString(key: SecretKey, blob: String): String = String(open(key, blob))
}
