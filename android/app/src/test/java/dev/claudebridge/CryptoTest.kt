package dev.claudebridge

import java.security.GeneralSecurityException
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Test

class CryptoTest {

    private val key = ByteArray(32) { it.toByte() }

    @Test
    fun `round trips a payload`() {
        val blob = Crypto.seal(key, "hello bridge")
        assertEquals("hello bridge", Crypto.openToString(key, blob))
    }

    @Test
    fun `a fresh nonce makes every sealing different`() {
        assertNotEquals(Crypto.seal(key, "same"), Crypto.seal(key, "same"))
    }

    @Test(expected = GeneralSecurityException::class)
    fun `refuses a key of the wrong length`() {
        Crypto.seal(ByteArray(16), "nope")
    }

    @Test(expected = GeneralSecurityException::class)
    fun `refuses a blob that is not base64`() {
        Crypto.open(key, "!!!! not base64 !!!!")
    }

    @Test(expected = GeneralSecurityException::class)
    fun `refuses a blob too short to hold a nonce and a tag`() {
        Crypto.open(key, Base64.getEncoder().encodeToString(ByteArray(20)))
    }

    @Test
    fun `a tampered byte throws rather than returning plaintext`() {
        val bytes = Base64.getDecoder().decode(Crypto.seal(key, "hello bridge"))
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 0xff).toByte()
        var threw = false
        try {
            Crypto.open(key, Base64.getEncoder().encodeToString(bytes))
        } catch (e: GeneralSecurityException) {
            threw = true
        }
        assertTrue("a forged blob must never decode", threw)
    }

    @Test
    fun `another key cannot open it`() {
        val blob = Crypto.seal(key, "secret")
        var threw = false
        try {
            Crypto.open(ByteArray(32) { 9 }, blob)
        } catch (e: GeneralSecurityException) {
            threw = true
        }
        assertTrue(threw)
    }

    // --- the contract with the Mac ------------------------------------------
    // Produced by bridge/src/core/crypto.mjs. If either implementation's wire
    // format drifts, this fails loudly instead of the phone showing an empty
    // list and nobody knowing why.

    private val nodeKey = Base64.getDecoder().decode("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
    private val nodeBlob =
        "fUMswSH0ghdP1ExUXmQDt//oOiNh6FZWEkKQwjOXx/Fm5oJW2GsH/n8JZuN171p0BW1FQK31ssq/pM0t" +
            "a/cXpHnARujVBp94bmxXqVYyT8gqfCvnAVO3mvV8Pad09wql5QbE7ekfFTFOB8SMxq+o8K+QEX1eqTlc" +
            "F7PiSV7e6z2uwRhua96PWqIL6633DYbAYJdCDn013EW2FtFrh5os4aCEJnBg"

    @Test
    fun `opens a blob sealed by the Node bridge`() {
        val session = BridgeJson.decodeFromString<SessionPayload>(Crypto.openToString(nodeKey, nodeBlob))
        assertEquals("sess-1", session.sessionId)
        assertEquals("waiting_input", session.state)
        assertEquals("api", session.project)
        assertEquals("main", session.branch)
        assertEquals("Needs your input.", session.summary)
        assertEquals(1763600000000L, session.ts)
        assertTrue(session.needsAttention)
    }

    @Test
    fun `the Node bridge can open what this app seals`() {
        // Same key, same format: proving the symmetry here means the reply path
        // works without a device in the loop.
        val blob = Crypto.seal(nodeKey, """{"v":1,"sessionId":"sess-1","text":"carry on","ts":1}""")
        val reply = BridgeJson.decodeFromString<ReplyPayload>(Crypto.openToString(nodeKey, blob))
        assertEquals("carry on", reply.text)
        assertEquals(1, reply.version)
    }
}

class PairingTest {

    private val uri =
        "cbridge://pair?v=1&k=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY" +
            "&u=UID123&d=https%3A%2F%2Fexample-default-rtdb.firebaseio.com"

    @Test
    fun `decodes the QR the Mac shows`() {
        val pairing = Pairing.decode(uri)!!
        assertEquals("UID123", pairing.uid)
        assertEquals("https://example-default-rtdb.firebaseio.com", pairing.databaseUrl)
        assertEquals(32, pairing.key.size)
        assertArrayEquals("0123456789abcdef0123456789abcdef".toByteArray(), pairing.key)
    }

    @Test
    fun `rejects anything that is not a pairing URI`() {
        assertNull(Pairing.decode("https://example.com"))
        assertNull(Pairing.decode(""))
        assertNull(Pairing.decode("cbridge://pair?v=2&k=x&u=y&d=https://z"))
    }

    @Test
    fun `rejects a missing or malformed field`() {
        assertNull(Pairing.decode("cbridge://pair?v=1&u=UID123&d=https%3A%2F%2Fa.firebaseio.com"))
        assertNull(Pairing.decode("cbridge://pair?v=1&k=c2hvcnQ&u=UID123&d=https%3A%2F%2Fa.firebaseio.com"))
        assertNull(Pairing.decode(uri.replace("&u=UID123", "&u=")))
    }

    @Test
    fun `rejects a database URL that is not https`() {
        assertNull(Pairing.decode(uri.replace("https%3A%2F%2F", "http%3A%2F%2F")))
    }
}

class DecisionTest {
    @Test(expected = IllegalArgumentException::class)
    fun `refuses a decision the hook would treat as ask`() {
        DecisionPayload("maybe")
    }

    @Test
    fun `allow and deny are the only answers`() {
        assertEquals("allow", DecisionPayload("allow").decision)
        assertEquals("deny", DecisionPayload("deny").decision)
    }
}

/**
 * The reply and decision wire formats, as the Mac parses them.
 *
 * `bridge/src/service/inject.mjs` rejects a reply whose `v` is not 1, and
 * `approval.mjs` treats anything but allow/deny as `ask`. Both read the JSON
 * this app seals, so the field names are a contract, not an implementation
 * detail: @SerialName("v") renamed to "version" would make every reply vanish
 * silently rather than fail loudly.
 */
class WireFormatTest {
    private val key = "0123456789abcdef0123456789abcdef".toByteArray()

    @Test
    fun `reply seals to the fields the bridge reads`() {
        val blob = Crypto.seal(key, BridgeJson.encodeToString(
            ReplyPayload(sessionId = "sess-1", text = "carry on", ts = 1763600000000L),
        ))
        val json = BridgeJson.parseToJsonElement(Crypto.openToString(key, blob)).jsonObject

        assertEquals(setOf("v", "sessionId", "text", "ts"), json.keys)
        assertEquals(1, json["v"]!!.jsonPrimitive.int)
        assertEquals("sess-1", json["sessionId"]!!.jsonPrimitive.content)
        assertEquals("carry on", json["text"]!!.jsonPrimitive.content)
        assertEquals(1763600000000L, json["ts"]!!.jsonPrimitive.long)
    }

    @Test
    fun `decision seals to allow or deny`() {
        val blob = Crypto.seal(key, BridgeJson.encodeToString(DecisionPayload("allow", "from phone")))
        val json = BridgeJson.parseToJsonElement(Crypto.openToString(key, blob)).jsonObject

        assertEquals("allow", json["decision"]!!.jsonPrimitive.content)
    }
}

/**
 * Version comparison decides whether an update is offered at all.
 *
 * The failure that matters is a false negative: a real update that never
 * appears, leaving a phone stuck on a broken build with no way forward.
 */
class VersionTest {
    @Test
    fun `newer patch and minor and major are offered`() {
        assertTrue(isNewer("v0.1.2", "0.1.1"))
        assertTrue(isNewer("v0.2.0", "0.1.9"))
        assertTrue(isNewer("v1.0.0", "0.99.99"))
    }

    @Test
    fun `same or older is not offered`() {
        assertFalse(isNewer("v0.1.1", "0.1.1"))
        assertFalse(isNewer("v0.1.0", "0.1.1"))
        assertFalse(isNewer("0.1.1", "v0.1.1"))
    }

    @Test
    fun `ragged and junk versions do not crash`() {
        assertTrue(isNewer("v0.2", "0.1.9"))
        assertFalse(isNewer("v0.1", "0.1.0"))
        // A tag that is not a version must not read as newer than anything.
        assertFalse(isNewer("latest", "0.1.1"))
    }
}

/**
 * Payloads already in the database, written by earlier versions of the bridge.
 *
 * A null for a non-nullable field used to throw, and the caller turned that
 * into a dropped list entry — twelve of thirteen sessions disappeared from the
 * phone with no error anywhere.
 */
class LegacyPayloadTest {
    @Test
    fun `nulls in optional fields fall back to defaults`() {
        val json = """
            {"sessionId":"sess-1","project":"api","branch":null,
             "state":"waiting_input","summary":"Needs you.","tool":null,"ts":1763600000000}
        """.trimIndent()

        val session = BridgeJson.decodeFromString<SessionPayload>(json)

        assertEquals("sess-1", session.sessionId)
        assertEquals("", session.branch)
        assertEquals("", session.tool)
        assertTrue(session.needsAttention)
    }

    @Test
    fun `unknown fields from a newer bridge are ignored`() {
        val json = """
            {"sessionId":"sess-2","state":"done","turn":14,"somethingNew":{"a":1}}
        """.trimIndent()

        assertEquals("sess-2", BridgeJson.decodeFromString<SessionPayload>(json).sessionId)
    }
}
