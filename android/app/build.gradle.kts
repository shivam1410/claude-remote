plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Applied only when the file is present. Registering the Android app in Firebase
// is a manual step, and the build — including every unit test — must work before
// anyone has done it. google-services.json is gitignored.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Single source of truth for the app version; scripts/release.sh bumps it.
val versionNameProp = providers.gradleProperty("VERSION_NAME").get()
val versionCodeProp = versionNameProp.split(".").map(String::toInt).let { (a, b, c) -> a * 10000 + b * 100 + c }

android {
    namespace = "dev.claudebridge"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.claudebridge"
        // 26: the Android Keystore's AES-GCM support is dependable from here on.
        minSdk = 26
        targetSdk = 35
        versionCode = versionCodeProp
        versionName = versionNameProp
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Only exists when CR_STORE_FILE is set, so the project still builds on a
    // machine without the keystore — the same reason google-services is
    // applied conditionally above.
    signingConfigs {
        val storeFilePath = providers.gradleProperty("CR_STORE_FILE").orNull
        if (storeFilePath != null) create("release") {
            storeFile = file(storeFilePath)
            storePassword = providers.gradleProperty("CR_STORE_PASSWORD").get()
            keyAlias = providers.gradleProperty("CR_KEY_ALIAS").get()
            keyPassword = providers.gradleProperty("CR_KEY_PASSWORD").get()
            // v3 carries proof-of-rotation. Without it this key can never be
            // rotated, and losing it would mean uninstall-and-re-pair.
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-database-ktx")
    implementation("com.google.firebase:firebase-auth-ktx")
    implementation("com.google.firebase:firebase-messaging-ktx")

    // Credential Manager rather than the retired GoogleSignIn API.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    // Task.await() for the Firebase SDKs.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
