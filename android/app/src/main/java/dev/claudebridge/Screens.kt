package dev.claudebridge

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.AccountCircle
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
import io.noties.markwon.Markwon
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
    onOpen: (SessionPayload) -> Unit,
    onDecide: (ApprovalPayload, Boolean) -> Unit,
    onUnpair: () -> Unit,
    updateState: UpdateState,
    onCheckUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    accountEmail: String?,
    accountPhotoUrl: String?,
) {
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
    ) { padding ->
        val grouped = remember(sessions) {
            sessions
                .groupBy { it.project.ifEmpty { "unknown" } }
                // Newest first inside a project, projects alphabetical, so the
                // list does not reshuffle every time a session ticks.
                .mapValues { (_, group) -> group.sortedByDescending { it.ts } }
                .toSortedMap()
        }

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
                StateTag(session.state)
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
            if (session.branch.isNotEmpty()) {
                Text(session.branch, style = MaterialTheme.typography.labelMedium)
            }
            val content = session.body.ifEmpty { session.summary }.ifEmpty { "Nothing said yet." }
            MarkdownBody(content, Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
        }
    }
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
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(LinkifyPlugin.create())
            .build()
    }
    val textColor = MaterialTheme.colorScheme.onSurface.toArgb()
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
