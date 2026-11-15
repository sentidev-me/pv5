import java.util.Properties

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
val contestSigningFile = System.getenv("PLEOS_SIGNING_PROPERTIES")?.let { file(it) }
val contestSigning = Properties().apply {
    if (contestSigningFile?.isFile == true) contestSigningFile.inputStream().use { load(it) }
}
android {
    namespace = "ai.pleosflows.vehicle"
    compileSdk = 35
    useLibrary("android.car", false)
    defaultConfig {
        applicationId = "ai.pleosflows.vehicle"
        minSdk = 28
        targetSdk = 35
        versionCode = 11
        versionName = "0.9.1-prototype"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("boolean", "LOCAL_EMULATOR_ONLY", "true")
    }
    flavorDimensions += "stateSource"
    productFlavors {
        create("vehicle") { dimension = "stateSource"; buildConfigField("boolean", "DEMO_MODE", "false") }
        create("demo") { dimension = "stateSource"; applicationIdSuffix = ".demo"; buildConfigField("boolean", "DEMO_MODE", "true") }
    }
    signingConfigs {
        if (contestSigningFile?.isFile == true) {
            create("contestRelease") {
                storeFile = file(contestSigning.getProperty("storeFile"))
                storePassword = contestSigning.getProperty("storePassword")
                keyAlias = contestSigning.getProperty("keyAlias")
                keyPassword = contestSigning.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("release") {
            applicationIdSuffix = ".contest"
            isDebuggable = false
            isMinifyEnabled = false
            if (contestSigningFile?.isFile == true) signingConfig = signingConfigs.getByName("contestRelease")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    lint { abortOnError = true }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
