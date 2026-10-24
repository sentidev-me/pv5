plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "ai.mobflow.bridge"
    compileSdk = 35
    defaultConfig {
        applicationId = "ai.mobflow.bridge"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.5.0-dev"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("ai.pleos.playground:NaviHelper:3.0.5") }
