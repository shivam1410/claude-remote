package dev.claudebridge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Tolerant on read: the Mac may add fields before this app is updated, and
 * older nodes written by an earlier bridge are still sitting in the database.
 *
 * coerceInputValues matters more than it looks. Without it an explicit JSON
 * null for a non-nullable property throws, even when the property has a
 * default — so one legacy node with "branch": null made the whole session
 * vanish from the list with nothing logged and nothing shown.
 */
val BridgeJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
    coerceInputValues = true
}

const val PAYLOAD_VERSION = 1

/** What one session node decrypts to. Already summarised and scrubbed by the Mac. */
@Serializable
data class SessionPayload(
    val sessionId: String,
    val project: String = "",
    val branch: String = "",
    // Claude Code's own name for the session; empty when the session is unnamed.
    val title: String = "",
    val state: String,
    val summary: String = "",
    val tool: String = "",
    val ts: Long = 0,
    // Present only when the session is connected to Remote Control. The URL to
    // open it in the official Claude app (or browser).
    val openUrl: String? = null,
    // The full last message, markdown preserved, for the detail view.
    val body: String = "",
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

/** Why a delivery failed, sealed onto the reply it belongs to. */
@Serializable
data class ReplyError(
    @SerialName("v") val version: Int = PAYLOAD_VERSION,
    val message: String,
    val ts: Long = 0,
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
