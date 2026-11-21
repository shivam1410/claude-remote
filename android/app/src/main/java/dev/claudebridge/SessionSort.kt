package dev.claudebridge

import android.content.Context
import androidx.core.content.edit

/** How the Home list orders groups. A per-viewer UI preference only. */
enum class SortMode(val label: String) {
    NAME_ASC("Name A–Z"),
    NAME_DESC("Name Z–A"),
    RECENT_DESC("Recently updated"),
    RECENT_ASC("Oldest first"),
}

/** What the Home list groups sessions by. A per-viewer UI preference only. */
enum class GroupMode(val label: String) {
    // The user's desktop sidebar group (DEA, Enhancement, …).
    CATEGORY("Group by category"),
    // The session's project folder.
    FOLDER("Group by folder"),
}

/**
 * The chosen sort, persisted in the same non-secret prefs as the pairing. This
 * is a display preference, not session data, so it is fine on disk — no work
 * content is stored here.
 */
object SessionSort {
    private const val PREFS = "claude-bridge"
    private const val KEY = "sortMode"
    private const val GROUP_KEY = "groupMode"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(context: Context): SortMode =
        runCatching { SortMode.valueOf(prefs(context).getString(KEY, "") ?: "") }
            .getOrDefault(SortMode.NAME_ASC)

    fun save(context: Context, mode: SortMode) {
        prefs(context).edit { putString(KEY, mode.name) }
    }

    fun loadGroup(context: Context): GroupMode =
        runCatching { GroupMode.valueOf(prefs(context).getString(GROUP_KEY, "") ?: "") }
            .getOrDefault(GroupMode.CATEGORY)

    fun saveGroup(context: Context, mode: GroupMode) {
        prefs(context).edit { putString(GROUP_KEY, mode.name) }
    }

    // The bucket a session falls in: its category, or its folder. The fallback
    // label names the sessions that have no value for the chosen key.
    private fun keyOf(session: SessionPayload, group: GroupMode): String = when (group) {
        GroupMode.CATEGORY -> session.category.ifEmpty { "Ungrouped" }
        GroupMode.FOLDER -> session.project.ifEmpty { "unknown" }
    }

    /**
     * Bucket the sessions by [group] and order the buckets per [sort]. Within a
     * bucket the newest session is always first; [sort] only sets the order of
     * the buckets themselves.
     */
    fun group(
        sessions: List<SessionPayload>,
        sort: SortMode,
        group: GroupMode = GroupMode.CATEGORY,
    ): List<Pair<String, List<SessionPayload>>> {
        val groups = sessions
            .groupBy { keyOf(it, group) }
            .mapValues { (_, g) -> g.sortedByDescending { it.ts } }
        val entries = groups.entries.toList()
        val ordered = when (sort) {
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
