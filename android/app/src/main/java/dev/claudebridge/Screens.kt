package dev.claudebridge

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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material3.Button
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
import androidx.compose.ui.Alignment
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
                // The count is diagnostic as much as cosmetic: it separates
                // "nothing arrived" from "it arrived and the list dropped it".
                title = { Text(if (sessions.isEmpty()) "Sessions" else "Sessions (${sessions.size})") },
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
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Approvals first: a blocked hook is on a timer, a status line is not.
            items(approvals, key = { it.requestId }) { approval ->
                ApprovalCard(approval, onDecide)
            }

            items(sessions, key = { it.sessionId }) { session ->
                SessionCard(session) { onOpen(session) }
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
                Text(
                    session.project.ifEmpty { "session" },
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(stateLabel(session.state), style = MaterialTheme.typography.labelMedium)
            }
            if (session.summary.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    session.summary,
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
fun SessionDetailScreen(session: SessionPayload, onBack: () -> Unit, onReply: (String) -> Unit) {
    var text by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(session.project.ifEmpty { "session" }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = { ReplyBar(session, onReply) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                // The summary can run long and the keyboard eats half the
                // screen, so the body scrolls and the reply row does not.
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stateLabel(session.state), style = MaterialTheme.typography.labelLarge)
            if (session.branch.isNotEmpty()) Text(session.branch, style = MaterialTheme.typography.labelMedium)
            if (session.ts > 0) {
                Text(
                    DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(session.ts)),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Text(session.summary.ifEmpty { "Nothing said yet." }, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

/** Text field and send button, same height, side by side. */
@Composable
private fun ReplyBar(session: SessionPayload, onReply: (String) -> Unit) {
    var text by remember(session.sessionId) { mutableStateOf("") }
    val canSend = text.isNotBlank()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            // Sits above the keyboard and clear of the gesture bar.
            .imePadding()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        if (!session.needsAttention) {
            // The Mac holds a reply until the session is idle, because
            // resuming a running one forks the conversation.
            Text(
                "Busy — a reply is held until it next asks for input.",
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }

        Row(
            // A fixed height on the row is what makes the button match the
            // field exactly; IntrinsicSize would leave it to the text field's
            // own minimum and drift with the font scale.
            modifier = Modifier.fillMaxWidth().height(REPLY_BAR_HEIGHT),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("Reply") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f).fillMaxHeight(),
            )
            FilledIconButton(
                onClick = {
                    onReply(text.trim())
                    text = ""
                },
                enabled = canSend,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxHeight().aspectRatio(1f),
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
            }
        }
    }
}

private val REPLY_BAR_HEIGHT = 56.dp

private fun stateLabel(state: String): String = when (state) {
    "waiting_input" -> "Needs input"
    "waiting_approval" -> "Needs permission"
    "running" -> "Running"
    "error" -> "Error"
    "done" -> "Finished"
    else -> state
}
