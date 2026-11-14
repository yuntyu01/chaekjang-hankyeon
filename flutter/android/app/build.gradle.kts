plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "app.covebook.chaekjang"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // 지금 앱(Play 'app.covebook')과 같은 앱 id: 기존 설치 위에 업데이트로 깔려 같은 저장소(files/SQLite·files/images)를 그대로 읽는다.
        // 코드 패키지(namespace app.covebook.chaekjang)는 앱 id와 따로라 그대로 둔다
        applicationId = "app.covebook"
        // 시험 빌드를 실제 앱(같은 id, 다른 서명) 옆에 따로 깔 때: -PappIdSuffix=.chaekjang → app.covebook.chaekjang(지금 앱이 깔린 실기기에서 덮어쓰거나 지우지 않게)
        (project.findProperty("appIdSuffix") as String?)?.let { applicationIdSuffix = it }
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // 출시 서명: 지금 앱 CI(scripts/configure-android-release.js)와 같은 환경 변수·같은 업로드 키. 없으면(로컬 시험 빌드) 디버그 키
    val releaseStore = System.getenv("STORE_FILE")
    signingConfigs {
        if (releaseStore != null) {
            create("release") {
                storeFile = file(releaseStore)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (releaseStore != null) "release" else "debug")
            // ML Kit 리플렉션 클래스 지키기(proguard-rules.pro)
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// 기기 안 문장 인식(지금 앱 modules/text-recognition과 같은 모델): ML Kit 한국어(한글·라틴). 모델이 앱에 들어 있어 인터넷 없이 동작하고 사진은 밖으로 보내지 않는다
dependencies {
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")
}
