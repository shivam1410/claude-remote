package dev.claudebridge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Tolerant on read: the Mac may add fields before this app is updated. */
val BridgeJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

const val PAYLOAD_VERSION = 1

/** What one session node decrypts to. Already summarised and scrubbed by the Mac. */
@Serializable
data class SessionPayload(
    val sessionId: String,
    val project: String = "",
    val branch: String = "",
    val state: String,
    val summary: String = "",
    val tool: String = "",
    val ts: Long = 0,
) {
    val needsAttention: Boolean get() = state == "waiting_input" || state == "waiting_approval"
}

/** What this app seals into /u/{uid}/replies/{id}. */
@Serializable
data class ReplyPayload(
    @SerialName("v") val version: Int = PAYLOAD_VERSION,
    val sessionId: String,
    val text: String,
    val ts: Long,
)

/** A pending tool permission, relayed from a blocked PreToolUse hook. */
@Serializable
data class ApprovalPayload(
    @SerialName("v") val version: Int = PAYLOAD_VERSION,
    val requestId: String,
    val sessionId: String,
    val project: String = "",
    val tool: String = "",
    val detail: String = "",
    val ts: Long = 0,
)

/** The answer, sealed back into that approval's decisionBlob. */
@Serializable
data class DecisionPayload(
    val decision: String,
    val reason: String? = null,
) {
    init {
        // The hook treats anything else as `ask`; failing here makes a typo
        // loud on this side instead of silently timing out on the Mac.
        require(decision == "allow" || decision == "deny") { "decision must be allow or deny" }
    }
}
