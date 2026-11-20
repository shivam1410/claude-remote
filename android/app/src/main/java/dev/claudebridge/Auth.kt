package dev.claudebridge

import android.content.Context
import androidx.core.content.edit
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

/**
 * Google sign-in, pinned to the account that did the pairing.
 *
 * The pin is the point: the database rules key everything off `auth.uid`, so
 * signing in as a second account would authenticate fine and then show an empty
 * list with no explanation. Here it fails loudly instead.
 */
object Auth {
    private const val PREFS = "claude-bridge"
    private const val KEY_PHOTO = "accountPhotoUrl"


    /** True once Firebase has a config — that is, once google-services.json exists. */
    fun configured(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    fun uid(): String? = runCatching { FirebaseAuth.getInstance().currentUser?.uid }.getOrNull()

    fun email(): String? = runCatching { FirebaseAuth.getInstance().currentUser?.email }.getOrNull()

    /**
     * The Google account photo.
     *
     * Firebase only carries a photo URL when the ID token happened to include
     * a picture claim, which it often does not. The Credential Manager
     * response always has one, so that is captured at sign-in and used as the
     * fallback. Null is still normal — some accounts have no photo at all.
     */
    fun photoUrl(context: Context): String? {
        val found = runCatching {
            val user = FirebaseAuth.getInstance().currentUser
            // The top-level photoUrl is only set when the ID token carried a
            // picture claim. The Google provider entry almost always has one
            // regardless, and reading it needs no fresh sign-in.
            user?.photoUrl?.toString()?.takeIf { it.isNotEmpty() }
                ?: user?.providerData
                    ?.firstOrNull { it.providerId == GoogleAuthProvider.PROVIDER_ID }
                    ?.photoUrl?.toString()?.takeIf { it.isNotEmpty() }
        }.getOrNull()

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (found != null) {
            // Cache it so the avatar survives a cold start before Firebase has
            // restored the user.
            prefs.edit { putString(KEY_PHOTO, found) }
            return found
        }
        return prefs.getString(KEY_PHOTO, null)?.takeIf { it.isNotEmpty() }
    }

    /**
     * The OAuth web client id the google-services plugin writes into resources.
     * Looked up by name rather than through R so the project still compiles
     * before the Android app has been registered in Firebase.
     */
    fun webClientId(context: Context): String? {
        val id = context.resources.getIdentifier("default_web_client_id", "string", context.packageName)
        return if (id == 0) null else context.getString(id)
    }

    /**
     * Sign in and return the uid, or an error worth showing the user.
     *
     * When this phone is already paired, a uid that does not match the pairing
     * is rejected and the session is dropped — no silent half-signed state.
     */
    suspend fun signIn(context: Context): Result<String> {
        if (!configured(context)) {
            return Result.failure(IllegalStateException("google-services.json is missing from the build"))
        }
        val clientId = webClientId(context)
            ?: return Result.failure(IllegalStateException("no OAuth client id in this build"))

        return runCatching {
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(
                    GetGoogleIdOption.Builder()
                        .setServerClientId(clientId)
                        // Any Google account on the device, so the first sign-in
                        // can pick the one that owns the Firebase project.
                        .setFilterByAuthorizedAccounts(false)
                        .build(),
                )
                .build()

            val response = CredentialManager.create(context).getCredential(context, request)
            val google = GoogleIdTokenCredential.createFrom(response.credential.data)
            val token = google.idToken
            google.profilePictureUri?.toString()?.let { photo ->
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit { putString(KEY_PHOTO, photo) }
            }
            val user = FirebaseAuth.getInstance()
                .signInWithCredential(GoogleAuthProvider.getCredential(token, null))
                .await()
                .user ?: throw IllegalStateException("sign-in returned no user")

            val expected = Paired.uid(context)
            if (expected != null && expected != user.uid) {
                FirebaseAuth.getInstance().signOut()
                throw IllegalStateException("that is a different Google account than the Mac paired with")
            }
            user.uid
        }
    }

    fun signOut(context: Context) = runCatching {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { remove(KEY_PHOTO) }
        FirebaseAuth.getInstance().signOut()
    }
}
