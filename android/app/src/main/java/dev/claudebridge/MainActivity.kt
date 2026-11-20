package dev.claudebridge

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.firebase.messaging.FirebaseMessaging
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

class MainActivity : ComponentActivity() {

    companion object {
        const val EXTRA_SESSION_ID = "sessionId"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val openSession = intent?.getStringExtra(EXTRA_SESSION_ID)
        setContent {
            BridgeTheme {
                BridgeApp(openSession)
            }
        }
    }
}

@Composable
fun BridgeApp(initialSessionId: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var signedIn by remember { mutableStateOf(Auth.uid() != null) }
    var paired by remember { mutableStateOf(Vault.isPaired() && Paired.uid(context) != null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(initialSessionId) }
    var sendError by remember { mutableStateOf<String?>(null) }

    val configured = remember { Auth.configured(context) }
    var photoUrl by remember { mutableStateOf(Auth.photoUrl(context)) }
    val updateState by Updater.state.collectAsStateWithLifecycle()

    // One quiet check per launch. It only surfaces when something is ready,
    // so a normal start shows nothing.
    LaunchedEffect(Unit) { Updater.check(context) }

    // The cached FirebaseUser can lack the Google photo even when the account
    // has one, and nothing refreshes it on its own.
    LaunchedEffect(signedIn) {
        if (signedIn) {
            Auth.refreshProfile(context)
            photoUrl = Auth.photoUrl(context)
        }
    }

    // Android 13+ shows nothing at all without this, and the whole point is
    // the notification. Asked once, on first launch.
    val notifications = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        val pairing = result.contents?.let(Pairing::decode)
        if (pairing == null) {
            error = "That QR is not a pairing code from this bridge."
            return@rememberLauncherForActivityResult
        }
        val uid = Auth.uid()
        if (uid != null && uid != pairing.uid) {
            error = "That pairing belongs to a different Google account."
            return@rememberLauncherForActivityResult
        }
        Paired.accept(context, pairing)
        paired = true
        error = null
    }

    // Register this handset for push once both halves are in place; the token
    // is what the Cloud Function fans out to.
    LaunchedEffect(signedIn, paired) {
        if (signedIn && paired) {
            runCatching {
                FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                    Devices.register(context, token)
                }
            }
        }
    }

    if (!signedIn || !paired) {
        SetupScreen(
            configured = configured,
            signedIn = signedIn,
            paired = paired,
            error = error,
            busy = busy,
            updateState = updateState,
            onCheckUpdate = { Updater.check(context, manual = true) },
            onInstallUpdate = { Updater.install(context) },
            onSignIn = {
                busy = true
                error = null
                scope.launch {
                    Auth.signIn(context)
                        .onSuccess { signedIn = true }
                        .onFailure { error = it.message ?: "Sign-in failed." }
                    busy = false
                }
            },
            onScan = {
                error = null
                scanner.launch(
                    ScanOptions()
                        .setOrientationLocked(false)
                        .setBeepEnabled(false)
                        .setPrompt("Point at the QR the Mac printed"),
                )
            },
        )
        return
    }

    val repo = remember(signedIn, paired) { Repo.of(context) }
    if (repo == null) {
        // Signed in and paired but the repo would not build: the key or the
        // database URL is gone. Pairing again is the only honest fix.
        SetupScreen(
            configured = configured,
            signedIn = true,
            paired = false,
            error = "Pairing is incomplete. Scan the QR again.",
            busy = false,
            updateState = updateState,
            onCheckUpdate = { Updater.check(context, manual = true) },
            onInstallUpdate = { Updater.install(context) },
            onSignIn = {},
            onScan = {
                scanner.launch(ScanOptions().setOrientationLocked(false).setBeepEnabled(false))
            },
        )
        return
    }

    val sessions by repo.sessions.collectAsStateWithLifecycle(emptyList())
    val approvals by repo.approvals.collectAsStateWithLifecycle(emptyList())
    val queuedReplies by repo.pendingReplies.collectAsStateWithLifecycle(emptyList())

    val open = sessions.firstOrNull { it.sessionId == selected }

    // The detail view is state in one Activity, not a second Activity, so
    // without this the system back gesture leaves the app entirely instead of
    // returning to the list.
    BackHandler(enabled = open != null) { selected = null }

    if (open != null) {
        SessionDetailScreen(
            session = open,
            queued = queuedReplies.filter { it.reply.sessionId == open.sessionId },
            onBack = { selected = null },
            onReply = { text ->
                scope.launch {
                    // A send that fails has to say so. Swallowing it meant a
                    // message that never left the phone looked identical to
                    // one the Mac had not picked up yet.
                    repo.reply(open.sessionId, text)
                        .onFailure { sendError = it.message ?: "Could not send" }
                        .onSuccess { sendError = null }
                }
            },
            sendError = sendError,
        )
    } else {
        SessionListScreen(
            sessions = sessions,
            approvals = approvals,
            onOpen = { selected = it.sessionId },
            onDecide = { approval, allow ->
                scope.launch { runCatching { repo.decide(approval.requestId, allow) } }
            },
            onUnpair = {
                Devices.unregister(context)
                Paired.clear(context)
                Auth.signOut(context)
                signedIn = false
                paired = false
                selected = null
            },
            updateState = updateState,
            onCheckUpdate = { Updater.check(context, manual = true) },
            onInstallUpdate = { Updater.install(context) },
            accountEmail = Auth.email(),
            accountPhotoUrl = photoUrl,
        )
    }
}

// Material3's stock schemes are purple with pink accents. Blue, and only the
// slots the app actually uses — the rest of the scheme stays the default.
private val LightScheme = lightColorScheme(
    primary = Color(0xFF1A5FD0),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD7E3FF),
    onPrimaryContainer = Color(0xFF00174A),
    secondary = Color(0xFF4A5C78),
    tertiary = Color(0xFF1F6B33),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFBFF0C8),
    onTertiaryContainer = Color(0xFF00210C),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFAEC8FF),
    onPrimary = Color(0xFF002B6E),
    primaryContainer = Color(0xFF00458F),
    onPrimaryContainer = Color(0xFFD7E3FF),
    secondary = Color(0xFFB6C6E3),
    tertiary = Color(0xFF8BD79B),
    onTertiary = Color(0xFF00390F),
    tertiaryContainer = Color(0xFF00531C),
    onTertiaryContainer = Color(0xFFBFF0C8),
)

@Composable
fun BridgeTheme(content: @Composable () -> Unit) {
    // Fixed schemes rather than dynamic colour: dynamic needs API 31 and this
    // app targets 26, and a status list reads better with stable colours anyway.
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkScheme else LightScheme,
    ) {
        // MaterialTheme paints nothing on its own, and Material3's
        // LocalContentColor defaults to Color.Black until a Surface sets it
        // from the scheme. Without this, any screen that is not inside a
        // Scaffold draws black text on the dark window background.
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            content = content,
        )
    }
}
