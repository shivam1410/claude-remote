package dev.claudebridge

import android.content.Context
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.encodeToString
import javax.crypto.SecretKey

/**
 * The database, as this app sees it: streams of decrypted payloads in, sealed
 * blobs out.
 *
 * Everything readable is produced here, on the handset. What travels is
 * ciphertext plus a version and a timestamp, and that is all the console shows.
 */
/** A reply the phone has sent, with the reason it has not landed yet. */
data class QueuedReply(val reply: ReplyPayload, val error: String?)

class Repo(private val uid: String, private val key: SecretKey, databaseUrl: String) {

    private val root: DatabaseReference =
        FirebaseDatabase.getInstance(databaseUrl).getReference("/u/$uid")

    companion object {
        /** Build a Repo, or null when sign-in or pairing is incomplete. */
        fun of(context: Context): Repo? {
            val uid = Auth.uid() ?: return null
            val key = Vault.key() ?: return null
            val url = Paired.databaseUrl(context) ?: return null
            return Repo(uid, key, url)
        }
    }

    val sessions: Flow<List<SessionPayload>> = stream("sessions") { snapshot ->
        decode<SessionPayload>(snapshot.child("blob").getValue(String::class.java))
    }

    val approvals: Flow<List<ApprovalPayload>> = stream("approvals") { snapshot ->
        // An approval that already carries a decision has been answered — on
        // this phone or another one — and is on its way out. Hide it now rather
        // than letting it flicker until the Mac deletes it.
        if (snapshot.hasChild("decisionBlob")) null
        else decode<ApprovalPayload>(snapshot.child("blob").getValue(String::class.java))
    }

    /**
     * Replies this phone has sent that the Mac has not delivered yet.
     *
     * Without this a sent message vanished: it was written to the database and
     * held until the session went idle, but nothing on screen said so.
     */
    val pendingReplies: Flow<List<QueuedReply>> = stream("replies") { snapshot ->
        val reply = decode<ReplyPayload>(snapshot.child("blob").getValue(String::class.java))
        reply?.let {
            QueuedReply(
                reply = it,
                // Present only when the Mac has tried and failed.
                error = decode<ReplyError>(
                    snapshot.child("errorBlob").getValue(String::class.java),
                )?.message,
            )
        }
    }

    /**
     * Queue a reply. The Mac delivers it when that session is next idle.
     *
     * Returns a Result so a failed write can be shown. Firebase queues writes
     * offline and the await only completes once the server has them, so a
     * failure here genuinely means the message is not in the database.
     */
    suspend fun reply(sessionId: String, text: String): Result<Unit> = runCatching {
        val payload = ReplyPayload(sessionId = sessionId, text = text, ts = System.currentTimeMillis())
        root.child("replies").push().setValue(
            mapOf(
                "v" to PAYLOAD_VERSION,
                "createdAt" to payload.ts,
                "blob" to Crypto.seal(key, BridgeJson.encodeToString(payload)),
            ),
        ).await()
        Unit
    }

    /**
     * Answer a pending tool permission. The hook on the Mac is blocked polling
     * for this, so it is written straight onto the request it answers.
     */
    suspend fun decide(requestId: String, allow: Boolean) {
        val payload = DecisionPayload(decision = if (allow) "allow" else "deny", reason = "from phone")
        root.child("approvals").child(requestId).child("decisionBlob")
            .setValue(Crypto.seal(key, BridgeJson.encodeToString(payload)))
            .await()
    }

    /** One child-list path, re-emitted on every change, decrypted on arrival. */
    private fun <T> stream(path: String, map: (DataSnapshot) -> T?): Flow<List<T>> = callbackFlow {
        val ref = root.child(path)
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                trySend(snapshot.children.mapNotNull(map))
            }

            override fun onCancelled(error: DatabaseError) {
                // Permission denied or offline. An empty list is the honest
                // answer; the UI says when nothing is connected.
                trySend(emptyList())
            }
        }
        ref.addValueEventListener(listener)
        awaitClose { ref.removeEventListener(listener) }
    }

    private inline fun <reified T> decode(blob: String?): T? {
        if (blob == null) return null
        return try {
            BridgeJson.decodeFromString<T>(Crypto.openToString(key, blob))
        } catch (e: Exception) {
            // Sealed with another key, or a payload this version cannot read.
            null
        }
    }
}
