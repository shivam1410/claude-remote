package dev.claudebridge

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.Alignment
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
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sessions") },
                actions = { TextButton(onClick = onUnpair) { Text("Unpair") } },
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

            item {
                Spacer(Modifier.height(16.dp))
                UpdateRow(updateState, onCheckUpdate, onInstallUpdate)
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
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
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

            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text("Reply") },
                modifier = Modifier.fillMaxWidth(),
            )
            if (!session.needsAttention) {
                // The Mac holds a reply until the session is idle, because
                // resuming a running one forks the conversation.
                Text(
                    "This session is busy. A reply is held until it next asks for input.",
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Button(
                onClick = {
                    onReply(text.trim())
                    text = ""
                },
                enabled = text.isNotBlank(),
            ) {
                Icon(Icons.Filled.Send, contentDescription = null)
                Spacer(Modifier.height(0.dp))
                Text("  Send")
            }
        }
    }
}

private fun stateLabel(state: String): String = when (state) {
    "waiting_input" -> "Needs input"
    "waiting_approval" -> "Needs permission"
    "running" -> "Running"
    "error" -> "Error"
    "done" -> "Finished"
    else -> state
}
