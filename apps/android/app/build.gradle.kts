// Explicit import: inside `android { }` the name `java` resolves to Gradle's
// JavaPluginExtension, not the JDK package.
import java.util.Base64

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.inovisolutions.paymentsync"
    compileSdk = 35

    /**
     * Release signing from CI env (Task 15 §4.5). The keystore is the single
     * highest-consequence artifact in the project: lose it and no merchant can
     * ever install an update again. Custody + backups are in docs/runbook.md.
     */
    signingConfigs {
        val storeBase64 = System.getenv("ANDROID_KEYSTORE_BASE64")
        if (!storeBase64.isNullOrBlank()) {
            create("release") {
                val keystoreFile = layout.buildDirectory.file("release.keystore").get().asFile
                keystoreFile.parentFile.mkdirs()
                keystoreFile.writeBytes(Base64.getDecoder().decode(storeBase64))
                storeFile = keystoreFile
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    defaultConfig {
        applicationId = "com.inovisolutions.paymentsync"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
            // 10.0.2.2 is the host loopback from an Android emulator; a flavour keeps
            // this out of code and a real device points at the LAN/staging URL.
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3000\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", "\"https://api.paysync.example\"")
            // Signing is supplied by CI env vars; a release build without them fails
            // loudly rather than silently falling back to the debug key (Task 15 §4.5).
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
    sourceSets {
        getByName("androidTest").assets.srcDir("$projectDir/schemas")
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

ksp {
    // Committed Room schema JSONs enable migration tests from every released version.
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.workmanager)
    implementation(libs.security.crypto)
    implementation(libs.datastore.preferences)
    implementation(libs.timber)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.truth)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.room.testing)

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.truth)
    androidTestImplementation(libs.room.testing)
    androidTestImplementation(libs.kotlinx.coroutines.test)
}
