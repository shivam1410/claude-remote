package dev.claudebridge

import java.net.URLDecoder
import java.util.Base64

/**
 * The QR payload the Mac shows: cbridge://pair?v=1&k=<base64url>&u=<uid>&d=<url>
 *
 * Parsed by hand rather than with Uri/URI so the same code runs in a JVM unit
 * test, and so a malformed scan is a null rather than an exception on the
 * camera thread.
 */
data class Pairing(
    val key: ByteArray,
    val uid: String,
    val databaseUrl: String,
) {
    // Generated equals/hashCode compare the ByteArray by identity, which makes
    // tests lie. Data classes do not fix this for arrays, so do it here.
    override fun equals(other: Any?): Boolean =
        other is Pairing && key.contentEquals(other.key) &&
            uid == other.uid && databaseUrl == other.databaseUrl

    override fun hashCode(): Int =
        (key.contentHashCode() * 31 + uid.hashCode()) * 31 + databaseUrl.hashCode()

    companion object {
        private const val PREFIX = "cbridge://pair?"
        const val VERSION = "1"

        fun decode(text: String): Pairing? {
            if (!text.startsWith(PREFIX)) return null
            val fields = text.removePrefix(PREFIX)
                .split("&")
                .mapNotNull { part ->
                    val i = part.indexOf('=')
                    // The Mac percent-encodes each value, so the database URL
                    // arrives as https%3A%2F%2F... and must be decoded first.
                    if (i <= 0) null else part.substring(0, i) to decodeValue(part.substring(i + 1))
                }
                .toMap()

            if (fields["v"] != VERSION) return null
            val uid = fields["u"]?.takeIf { it.isNotEmpty() } ?: return null
            val url = fields["d"]?.takeIf { it.startsWith("https://") } ?: return null
            val key = fields["k"]?.let(::decodeKey) ?: return null
            return Pairing(key, uid, url)
        }

        private fun decodeValue(raw: String): String = try {
            URLDecoder.decode(raw, "UTF-8")
        } catch (e: IllegalArgumentException) {
            raw
        }

        private fun decodeKey(encoded: String): ByteArray? = try {
            Base64.getUrlDecoder().decode(encoded).takeIf { it.size == Crypto.KEY_BYTES }
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
