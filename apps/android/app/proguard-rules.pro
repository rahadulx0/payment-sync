# R8 keep rules (Task 15 §4.2). Reflection-driven libraries need explicit keeps —
# a missing rule here shows up only at runtime in a release build, which is why
# the instrumented suite is run against a minified build in CI.

-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# --- kotlinx.serialization -----------------------------------------------------
-keepclassmembers class ** {
    @kotlinx.serialization.SerialName <fields>;
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
    static **$* *;
}
-keepclasseswithmembers class **$$serializer { *; }
-keep,includedescriptorclasses class com.inovisolutions.paymentsync.**$$serializer { *; }
-keep class com.inovisolutions.paymentsync.data.remote.dto.** { *; }
-keep class com.inovisolutions.paymentsync.data.sms.ProviderRule { *; }
-keep class com.inovisolutions.paymentsync.data.sms.MessageTypeRule { *; }
-keep class com.inovisolutions.paymentsync.update.LatestRelease { *; }

# --- Retrofit / OkHttp ---------------------------------------------------------
-keep,allowobfuscation interface com.inovisolutions.paymentsync.data.remote.DeviceApi
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**

# --- Room ----------------------------------------------------------------------
-keep class com.inovisolutions.paymentsync.data.local.** { *; }
-dontwarn androidx.room.paging.**

# --- Hilt / Dagger --------------------------------------------------------------
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ViewComponentManager$FragmentContextWrapper

# --- WorkManager workers are instantiated reflectively by name -------------------
-keep class com.inovisolutions.paymentsync.work.** { *; }

# --- Tink (via androidx.security-crypto) ----------------------------------------
# Tink references compile-only Error Prone annotations and an OPTIONAL remote
# keyset downloader (Google HTTP client + Joda). This app never downloads a
# keyset — the master key is local to the Keystore — so those classes are
# legitimately absent. Without these rules R8 fails the release build outright.
-dontwarn com.google.errorprone.annotations.**
-dontwarn com.google.api.client.http.**
-dontwarn org.joda.time.**
-keep class com.google.crypto.tink.** { *; }

# Strip debug logging from release builds (no bodies or tokens in logcat).
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
}
