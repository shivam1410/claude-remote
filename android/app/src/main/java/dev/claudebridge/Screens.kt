package dev.claudebridge

import android.content.Intent
import android.net.Uri
import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.FilledIconButton
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date

/**
 * Update status and the manual check, shown on every screen.
 *
 * Deliberately available before pairing too: the setup screen is exactly where
 * someone sits when a build is broken, and that is when they most need to pull
 * a newer one.
 */
/**
 * The avatar in the top bar, and everything behind it.
 *
 * Update status and unpairing both live here rather than in the session list:
 * the list is for sessions, and a line reading "Up to date" among them is
 * noise at exactly the moment you are looking for something else.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountMenu(
    email: String?,
    photoUrl: String?,
    updateState: UpdateState,
    onCheckUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onUnpair: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }

    IconButton(onClick = { open = true }) {
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = "Account",
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(32.dp).clip(CircleShape),
                // Shown while loading and if the photo cannot be fetched, so
                // a slow or blocked image never leaves an empty button.
                placeholder = rememberVectorPainter(Icons.Filled.AccountCircle),
                error = rememberVectorPainter(Icons.Filled.AccountCircle),
            )
        } else {
            Icon(Icons.Filled.AccountCircle, contentDescription = "Account", modifier = Modifier.size(32.dp))
        }
    }

    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        if (email != null) {
            Text(
                email,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            HorizontalDivider()
        }

        DropdownMenuItem(
            text = { Text("Version ${BuildConfig.VERSION_NAME}") },
            onClick = {},
            enabled = false,
        )

        when (updateState) {
            is UpdateState.Checking ->
                DropdownMenuItem(text = { Text("Checking…") }, onClick = {}, enabled = false)

            is UpdateState.Downloading -> DropdownMenuItem(
                text = { Text("Downloading ${updateState.tag} ${(updateState.fraction * 100).toInt()}%") },
                onClick = {},
                enabled = false,
            )

            is UpdateState.Ready -> DropdownMenuItem(
                text = { Text("Install ${updateState.tag}") },
                onClick = { open = false; onInstallUpdate() },
            )

            is UpdateState.UpToDate -> DropdownMenuItem(
                text = { Text("Up to date — check again") },
                onClick = onCheckUpdate,
            )

            is UpdateState.Failed -> DropdownMenuItem(
                text = { Text(updateState.reason) },
                onClick = onCheckUpdate,
            )

            is UpdateState.Idle -> DropdownMenuItem(
                text = { Text("Check for updates") },
                onClick = onCheckUpdate,
            )
        }

        HorizontalDivider()
        DropdownMenuItem(
            text = { Text("Unpair this phone") },
            onClick = { open = false; onUnpair() },
        )
    }
}

@Composable
private fun NewSessionDialog(
    projects: List<String>,
    onDismiss: () -> Unit,
    onStart: (String, String) -> Unit,
) {
    var prompt by remember { mutableStateOf("") }
    var project by remember { mutableStateOf(projects.firstOrNull() ?: "") }
    var pickerOpen by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New session") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Starts a background session on the Mac. It shows here and, " +
                        "with Remote Control on, in Claude — not in the desktop app.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text("Prompt") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                )
                Box {
                    OutlinedButton(onClick = { pickerOpen = true }) {
                        Text(project.ifEmpty { "Pick a project" })
                    }
                    DropdownMenu(expanded = pickerOpen, onDismissRequest = { pickerOpen = false }) {
                        for (p in projects) {
                            DropdownMenuItem(
                                text = { Text(p) },
                                onClick = { project = p; pickerOpen = false },
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onStart(prompt.trim(), project) },
                enabled = prompt.isNotBlank() && project.isNotEmpty(),
            ) { Text("Start") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SortMenu(sortMode: SortMode, onSortChange: (SortMode) -> Unit) {
    var open by remember { mutableStateOf(false) }

    IconButton(onClick = { open = true }) {
        Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = "Sort sessions")
    }

    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        for (mode in SortMode.entries) {
            DropdownMenuItem(
                text = { Text(mode.label) },
                // A check marks the active mode; others leave the slot empty so
                // the labels still line up.
                leadingIcon = {
                    if (mode == sortMode) {
                        Icon(Icons.Filled.Check, contentDescription = null)
                    }
                },
                onClick = { open = false; onSortChange(mode) },
            )
        }
    }
}

@Composable
fun UpdateRow(state: UpdateState, onCheck: () -> Unit, onInstall: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        when (state) {
            is UpdateState.Idle -> TextButton(onClick = onCheck) { Text("Check for updates") }
            is UpdateState.Checking -> Text("Checking for updates…", style = MaterialTheme.typography.labelMedium)
            is UpdateState.Downloading -> {
                Text("Downloading ${state.tag}…", style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { state.fraction },
                    modifier = Modifier.fillMaxWidth(0.7f),
                )
            }
            is UpdateState.Ready -> {
                Text("${state.tag} is ready to install", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(6.dp))
                Button(onClick = onInstall) { Text("Install ${state.tag}") }
            }
            is UpdateState.UpToDate -> {
                Text("Up to date (v${state.version})", style = MaterialTheme.typography.labelMedium)
                TextButton(onClick = onCheck) { Text("Check again") }
            }
            is UpdateState.Failed -> {
                Text(state.reason, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                TextButton(onClick = onCheck) { Text("Try again") }
            }
        }
    }
}

/** The one screen shown before pairing is complete. */
@Composable
fun SetupScreen(
    configured: Boolean,
    signedIn: Boolean,
    paired: Boolean,
    error: String?,
    busy: Boolean,
    updateState: UpdateState,
    onCheckUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onSignIn: () -> Unit,
    onScan: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Claude Remote", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))

        when {
            !configured -> Text(
                "This build has no Firebase config. Register the Android app " +
                    "(dev.claudebridge) in your Firebase project and add " +
                    "google-services.json to android/app/.",
                style = MaterialTheme.typography.bodyMedium,
            )

            !signedIn -> {
                Text(
                    "Sign in with the same Google account the Mac is paired to.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(16.dp))
                Button(onClick = onSignIn, enabled = !busy) { Text("Sign in with Google") }
            }

            !paired -> {
                Text(
                    "Run `bridge --pair` on the Mac and scan the QR it prints.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(16.dp))
                Button(onClick = onScan, enabled = !busy) { Text("Scan pairing QR") }
            }
        }

        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(32.dp))
        UpdateRow(updateState, onCheckUpdate, onInstallUpdate)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    sessions: List<SessionPayload>,
    approvals: List<ApprovalPayload>,
    // True until the first snapshot lands, so the empty state is not shown while
    // the live query is still in flight. No local cache — just a loading gate.
    loading: Boolean,
    sortMode: SortMode,
    onSortChange: (SortMode) -> Unit,
    projects: List<String>,
    onStartSession: (String, String) -> Unit,
    onOpen: (SessionPayload) -> Unit,
    onDecide: (ApprovalPayload, Boolean) -> Unit,
    onUnpair: () -> Unit,
    updateState: UpdateState,
    onCheckUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    accountEmail: String?,
    accountPhotoUrl: String?,
) {
    var showNew by remember { mutableStateOf(false) }
    if (showNew) {
        NewSessionDialog(
            projects = projects,
            onDismiss = { showNew = false },
            onStart = { prompt, project ->
                showNew = false
                onStartSession(prompt, project)
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Sessions")
                        if (sessions.isNotEmpty()) {
                            Spacer(Modifier.width(8.dp))
                            CountBadge(sessions.size)
                        }
                    }
                },
                actions = {
                    // Sort control sits left of the account avatar.
                    SortMenu(sortMode, onSortChange)
                    AccountMenu(
                        email = accountEmail,
                        photoUrl = accountPhotoUrl,
                        updateState = updateState,
                        onCheckUpdate = onCheckUpdate,
                        onInstallUpdate = onInstallUpdate,
                        onUnpair = onUnpair,
                    )
                },
            )
        },
        // A new session can only start in a project the Mac already knows, so the
        // action appears only once at least one is listed.
        floatingActionButton = {
            if (projects.isNotEmpty()) {
                FloatingActionButton(onClick = { showNew = true }) {
                    Icon(Icons.Filled.Add, contentDescription = "New session")
                }
            }
        },
    ) { padding ->
        val grouped = remember(sessions, sortMode) { SessionSort.group(sessions, sortMode) }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Approvals first: a blocked hook is on a timer, a status line is not.
            items(approvals, key = { it.requestId }) { approval ->
                ApprovalCard(approval, onDecide)
            }

            // Grouped by project. Thirteen flat rows across eight repos is a
            // wall; the repo name is the thing you scan for first.
            for ((project, group) in grouped) {
                item(key = "header-$project") {
                    Text(
                        project,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
                    )
                }
                items(group, key = { it.sessionId }) { session ->
                    SessionCard(session) { onOpen(session) }
                }
            }

            if (sessions.isEmpty() && approvals.isEmpty()) {
                item {
                    if (loading) {
                        // First snapshot still in flight: a spinner, not the
                        // "nothing running" copy, so the empty state never flashes.
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    } else {
                        Text(
                            "No sessions running. A session appears here as soon as " +
                                "one starts on the Mac.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }

        }
    }
}

@Composable
private fun ApprovalCard(approval: ApprovalPayload, onDecide: (ApprovalPayload, Boolean) -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("${approval.project} wants to run ${approval.tool}", style = MaterialTheme.typography.titleMedium)
            if (approval.detail.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(approval.detail, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onDecide(approval, true) }) { Text("Allow") }
                OutlinedButton(onClick = { onDecide(approval, false) }) { Text("Deny") }
            }
            Spacer(Modifier.height(8.dp))
            // Saying this out loud matters: silence here is not an approval.
            Text(
                "No answer in a few seconds and the Mac asks you there instead.",
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun SessionCard(session: SessionPayload, onClick: () -> Unit) {
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                // The project is the group header above. Prefer Claude Code's
                // own session name; fall back to the branch (worktree branches
                // are named after the work), then the time.
                Text(
                    session.title.ifEmpty {
                        session.branch.ifEmpty {
                            if (session.ts > 0) {
                                DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(session.ts))
                            } else {
                                "session"
                            }
                        }
                    },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(8.dp))
                // Read fresh on each (re)composition; the list rebuilds when you
                // return from the detail screen, so a toggle there shows here.
                if (Mutes.isMuted(context, session.sessionId)) {
                    Icon(
                        Icons.Filled.NotificationsOff,
                        contentDescription = "Muted",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.width(6.dp))
                }
                StateTag(session.state)
            }
            if (session.ts > 0) {
                Spacer(Modifier.height(2.dp))
                Text(
                    // Last activity, relative ("5 min ago"). Native, re-reads on
                    // each recomposition — close enough for a status list.
                    DateUtils.getRelativeTimeSpanString(
                        session.ts,
                        System.currentTimeMillis(),
                        DateUtils.MINUTE_IN_MILLIS,
                    ).toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (session.summary.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    inlineMarkdown(session.summary),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionDetailScreen(session: SessionPayload, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(session.title.ifEmpty { session.project.ifEmpty { "session" } }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    val context = LocalContext.current
                    var muted by remember(session.sessionId) {
                        mutableStateOf(Mutes.isMuted(context, session.sessionId))
                    }
                    IconButton(onClick = { muted = Mutes.toggle(context, session.sessionId) }) {
                        Icon(
                            if (muted) Icons.Filled.NotificationsOff else Icons.Filled.Notifications,
                            contentDescription = if (muted) "Unmute notifications" else "Mute notifications",
                        )
                    }
                },
            )
        },
        // The handoff is the primary action, so it is pinned to the bottom and
        // stays put while the message scrolls — the spot the reply bar held.
        bottomBar = {
            session.openUrl?.let { url ->
                val context = LocalContext.current
                Button(
                    onClick = {
                        runCatching {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ClaudeOrange,
                        contentColor = Color.White,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                        .height(52.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.ic_claude),
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Open in Claude to reply")
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StateTag(session.state)
                if (session.ts > 0) {
                    Text(
                        DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(session.ts)),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            SessionChips(session)
            val content = session.body.ifEmpty { session.summary }.ifEmpty { "Nothing said yet." }
            MarkdownBody(content, Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** Short facts about the session as wrapping chips: branch, model, uptime, tool. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SessionChips(session: SessionPayload) {
    val context = LocalContext.current
    val chips = buildList {
        when (session.origin) {
            "bg" -> add("background")
            "cli" -> add("terminal")
            "desktop" -> add("desktop app")
        }
        if (session.branch.isNotEmpty()) add("⎇ ${session.branch}")
        // "claude-opus-4-8" -> "opus-4-8": the vendor prefix is noise on a chip.
        if (session.model.isNotEmpty()) add(session.model.removePrefix("claude-"))
        if (session.startedAt > 0) {
            add(
                "started " + DateUtils.getRelativeTimeSpanString(
                    session.startedAt,
                    System.currentTimeMillis(),
                    DateUtils.MINUTE_IN_MILLIS,
                ),
            )
        }
        if (session.tool.isNotEmpty()) add("⚒ ${session.tool}")
    }
    val prUrl = session.prUrl
    if (chips.isEmpty() && prUrl == null) return
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        // Without this, chips that wrap to a second line sit flush against the
        // first row; the gap matches the horizontal one.
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // The PR chip is tappable: it opens the pull request in the browser.
        if (prUrl != null) {
            val label = buildString {
                append("PR #${session.prNumber}")
                if (session.prState.isNotEmpty()) append(" ${session.prState.lowercase()}")
            }
            InfoChip(label) {
                runCatching {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse(prUrl))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            }
        }
        for (chip in chips) InfoChip(chip)
    }
}

@Composable
private fun InfoChip(label: String, onClick: (() -> Unit)? = null) {
    val base = Modifier
        .clip(RoundedCornerShape(8.dp))
        .background(MaterialTheme.colorScheme.surfaceVariant)
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = (if (onClick != null) base.clickable(onClick = onClick) else base)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/**
 * The session count, as a notification badge.
 *
 * A pill rather than a fixed circle: at two digits a circle either clips the
 * number or has to grow, and a capsule does that on its own.
 */
@Composable
private fun CountBadge(count: Int) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .defaultMinSize(minWidth = 22.dp, minHeight = 22.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary)
            .padding(horizontal = 6.dp),
    ) {
        Text(
            count.toString(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

/**
 * The state, as a coloured pill.
 *
 * Colour carries the urgency so the list can be read at a glance: anything
 * wanting you is tinted, anything merely working is not.
 */
@Composable
private fun StateTag(state: String) {
    // Explicit hues rather than the scheme's containers: tertiaryContainer is
    // pink in this scheme, so "Finished" read as a failure next to "Error".
    // Each state needs its own hue, and five of them is more than the scheme
    // has semantic slots for.
    val dark = isSystemInDarkTheme()
    val hue = when (state) {
        "waiting_input" -> if (dark) Color(0xFFAEC8FF) else Color(0xFF1A5FD0)
        "waiting_approval" -> if (dark) Color(0xFFFFB77C) else Color(0xFFB34700)
        "error" -> if (dark) Color(0xFFFF8A80) else Color(0xFFB3261E)
        "done" -> if (dark) Color(0xFF8BD79B) else Color(0xFF1F6B33)
        // Running is the quiet state: nothing is being asked of you, so it
        // stays uncoloured and recedes.
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val background = hue.copy(alpha = if (dark) 0.22f else 0.14f)
    val foreground = hue

    Text(
        stateLabel(state),
        style = MaterialTheme.typography.labelSmall,
        color = foreground,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(background)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/**
 * The message body as rendered markdown: tables, links, lists, code.
 *
 * A TextView via Markwon rather than Compose text: Markwon's table extension
 * draws real grids, which the Compose-native renderers did not.
 */
@Composable
private fun MarkdownBody(text: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val textColor = MaterialTheme.colorScheme.onSurface.toArgb()
    val codeTextColor = MaterialTheme.colorScheme.onSurfaceVariant.toArgb()
    val codeBlockBg = MaterialTheme.colorScheme.surfaceVariant.toArgb()
    // The page background, used as the inline-code background so the span blends
    // in. Markwon reads 0 as "unset" and draws its own grey tint, so the only
    // way to kill the highlight is an opaque colour that matches the surface.
    val pageBg = MaterialTheme.colorScheme.background.toArgb()
    val markwon = remember(context, codeTextColor, codeBlockBg, pageBg) {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder
                        // No inline-code highlight: its background broke across
                        // wrapped lines into blotchy blocks. Match the page so
                        // the span is invisible; monospace plus a muted colour
                        // sets code apart without the mess. (0 does not work —
                        // Markwon reads it as unset and draws a grey default.)
                        .codeBackgroundColor(pageBg)
                        .codeTextColor(codeTextColor)
                        // Blocks keep one clean panel — they do not wrap-blotch.
                        .codeBlockBackgroundColor(codeBlockBg)
                        .codeBlockTextColor(textColor)
                }
            })
            .build()
    }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                textSize = 16f
                setLineSpacing(0f, 1.15f)
                movementMethod = LinkMovementMethod.getInstance()
                setTextIsSelectable(true)
            }
        },
        update = { tv ->
            tv.setTextColor(textColor)
            markwon.setMarkdown(tv, text)
        },
    )
}

/** Claude's brand coral, for anything that hands off to the Claude app. */
val ClaudeOrange = Color(0xFFD97757)

private fun stateLabel(state: String): String = when (state) {
    "waiting_input" -> "Needs input"
    "waiting_approval" -> "Needs permission"
    "running" -> "Running"
    "error" -> "Error"
    "done" -> "Finished"
    else -> state
}
