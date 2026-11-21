package dev.claudebridge

import android.content.Context
import androidx.core.content.edit

/** How the Home list orders repo groups. A per-viewer UI preference only. */
enum class SortMode(val label: String) {
    NAME_ASC("Name A–Z"),
    NAME_DESC("Name Z–A"),
    RECENT_DESC("Recently updated"),
    RECENT_ASC("Oldest first"),
}

/**
 * The chosen sort, persisted in the same non-secret prefs as the pairing. This
 * is a display preference, not session data, so it is fine on disk — no work
 * content is stored here.
 */
object SessionSort {
    private const val PREFS = "claude-bridge"
    private const val KEY = "sortMode"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(context: Context): SortMode =
        runCatching { SortMode.valueOf(prefs(context).getString(KEY, "") ?: "") }
            .getOrDefault(SortMode.NAME_ASC)

    fun save(context: Context, mode: SortMode) {
        prefs(context).edit { putString(KEY, mode.name) }
    }

    /**
     * Group the sessions by project and order the groups per [mode]. Within a
     * group the newest session is always first; [mode] only sets the order of
     * the groups themselves.
     */
    fun group(
        sessions: List<SessionPayload>,
        mode: SortMode,
    ): List<Pair<String, List<SessionPayload>>> {
        val groups = sessions
            .groupBy { it.project.ifEmpty { "unknown" } }
            .mapValues { (_, g) -> g.sortedByDescending { it.ts } }
        val entries = groups.entries.toList()
        val ordered = when (mode) {
            SortMode.NAME_ASC -> entries.sortedBy { it.key.lowercase() }
            SortMode.NAME_DESC -> entries.sortedByDescending { it.key.lowercase() }
            SortMode.RECENT_DESC ->
                entries.sortedByDescending { e -> e.value.maxOf { it.ts } }
            SortMode.RECENT_ASC ->
                entries.sortedBy { e -> e.value.maxOf { it.ts } }
        }
        return ordered.map { it.key to it.value }
    }
}
