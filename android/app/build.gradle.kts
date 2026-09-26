import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.jetbrains.kotlin.android)
  alias(libs.plugins.compose.compiler)
}

android {
  namespace = "com.baseacademy.glasses"
  compileSdk = 36

  buildFeatures {
    buildConfig = true
    compose = true
  }

  defaultConfig {
    applicationId = "com.baseacademy.glasses"
    minSdk = 31
    targetSdk = 36
    versionCode = 1
    versionName = "1.0"
    // Developer Mode in the Meta AI app: attestation is off, so both can be 0.
    // For a published app, put the Wearables Developer Center values here.
    manifestPlaceholders["mwdat_application_id"] = "0"
    manifestPlaceholders["mwdat_client_token"] = "0"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_17 } }

dependencies {
  implementation(libs.androidx.activity.compose)
  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.material3)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.service)
  implementation(libs.androidx.exifinterface)
  implementation(libs.mwdat.core)
  implementation(libs.mwdat.camera)
  implementation(libs.mwdat.mockdevice)
  implementation(libs.okhttp)
}
