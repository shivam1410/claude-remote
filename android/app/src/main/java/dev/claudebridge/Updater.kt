package dev.claudebridge

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/** What the UI shows about an update. */
sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data class Downloading(val tag: String, val fraction: Float) : UpdateState
    data class Ready(val tag: String) : UpdateState
    data class UpToDate(val version: String) : UpdateState
    data class Failed(val reason: String) : UpdateState
}

/**
 * Updates come from GitHub Releases: there is no store in the loop.
 *
 * The APK is verified against the running app's own signing certificate before
 * it is handed to the installer. PackageInstaller enforces same-signer anyway,
 * but it fails with a code rather than a sentence; checking here turns a
 * tampered or mis-signed download into a message that says what went wrong.
 */
object Updater {
    private const val REPO = "shivam1410/claude-remote"
    private const val API = "https://api.github.com/repos/$REPO/releases/latest"
    private const val TIMEOUT_MS = 15_000

    val state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    private var downloaded: File? = null

    /** [manual] is the button; a launch check stays quiet unless something is ready. */
    fun check(context: Context, manual: Boolean = false) {
        when (state.value) {
            is UpdateState.Checking, is UpdateState.Downloading -> return // already running
            else -> Unit
        }
        state.value = UpdateState.Checking
        val app = context.applicationContext
        thread { runCheck(app, manual) }
    }

    private fun runCheck(context: Context, manual: Boolean) {
        try {
            val release = JSONObject(fetch(API))
            val tag = release.getString("tag_name")
            if (!isNewer(tag, BuildConfig.VERSION_NAME)) {
                state.value = if (manual) UpdateState.UpToDate(BuildConfig.VERSION_NAME) else UpdateState.Idle
                return
            }

            val assets = release.getJSONArray("assets")
            val asset = (0 until assets.length())
                .map(assets::getJSONObject)
                .firstOrNull { it.getString("name").endsWith(".apk") }
            if (asset == null) {
                state.value = UpdateState.Failed("$tag has no APK attached yet")
                return
            }

            val file = File(context.cacheDir, "update-$tag.apk")
            if (!file.exists()) {
                state.value = UpdateState.Downloading(tag, 0f)
                download(asset.getString("browser_download_url"), file, asset.optLong("size", -1)) { done ->
                    state.value = UpdateState.Downloading(tag, done)
                }
            }

            if (!signerMatches(context, file)) {
                // Either the release was signed with a different key or the
                // download was tampered with. Installing would fail anyway;
                // deleting it stops a bad file sitting in the cache.
                file.delete()
                state.value = UpdateState.Failed("$tag is signed with a different key — not installing")
                return
            }

            downloaded = file
            state.value = UpdateState.Ready(tag)
        } catch (e: IOException) {
            state.value = UpdateState.Failed("Could not reach GitHub")
        } catch (e: Exception) {
            state.value = UpdateState.Failed("Update check failed")
        }
    }

    /**
     * Hand the APK to the system installer. Android asks the user to allow
     * installs from this app the first time; that consent screen is the
     * REQUEST_INSTALL_PACKAGES flow and cannot be skipped.
     */
    fun install(context: Context) {
        val file = downloaded ?: return
        if (!context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${context.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val status = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, InstallReceiver::class.java).setPackage(context.packageName),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            session.commit(status.intentSender)
        }
    }

    /** Dismiss a message without re-checking. */
    fun clear() {
        state.value = UpdateState.Idle
    }

    /** True when the downloaded APK is signed by whoever signed the running app. */
    private fun signerMatches(context: Context, apk: File): Boolean = try {
        val installed = certificates(context, context.packageName, null)
        val candidate = certificates(context, null, apk.path)
        installed.isNotEmpty() && installed == candidate
    } catch (e: Exception) {
        false
    }

    @Suppress("DEPRECATION")
    private fun certificates(context: Context, packageName: String?, archivePath: String?): Set<String> {
        val pm = context.packageManager
        val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
        val flags = if (modern) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val info = if (packageName != null) {
            pm.getPackageInfo(packageName, flags)
        } else {
            pm.getPackageArchiveInfo(archivePath!!, flags)
        } ?: return emptySet()

        val signatures = if (modern) {
            info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        } ?: return emptySet()

        val sha256 = MessageDigest.getInstance("SHA-256")
        return signatures.map { sha256.digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }.toSet()
    }

    private fun fetch(url: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        if (connection.responseCode !in 200..299) throw IOException("HTTP ${connection.responseCode}")
        return connection.inputStream.use { it.readBytes().decodeToString() }
    }

    private fun download(url: String, dest: File, expectedSize: Long, onProgress: (Float) -> Unit) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = TIMEOUT_MS
            readTimeout = 120_000
            instanceFollowRedirects = true
        }
        if (connection.responseCode !in 200..299) throw IOException("HTTP ${connection.responseCode}")

        // Write to a partial file and rename, so an interrupted download is
        // never mistaken for a complete one on the next check.
        val partial = File(dest.path + ".part")
        connection.inputStream.use { input ->
            partial.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    total += read
                    if (expectedSize > 0) onProgress((total.toFloat() / expectedSize).coerceIn(0f, 1f))
                }
            }
        }
        if (!partial.renameTo(dest)) throw IOException("could not finish download")
    }
}

/** Compares dotted versions, ignoring a leading `v`. */
fun isNewer(remote: String, local: String): Boolean {
    fun parts(v: String) = v.trimStart('v').split(".").map { it.toIntOrNull() ?: 0 }
    val a = parts(remote)
    val b = parts(local)
    for (i in 0 until maxOf(a.size, b.size)) {
        val diff = a.getOrElse(i) { 0 } - b.getOrElse(i) { 0 }
        if (diff != 0) return diff > 0
    }
    return false
}
