package app.covebook.screencapture

import android.app.Activity
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import android.widget.FrameLayout
import android.widget.ImageView
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import expo.modules.splashscreen.SplashScreenManager
import org.json.JSONObject
import java.io.File
import kotlin.math.abs

// 켜자마자 지난 홈 사진을 창 맨 위에 띄운다(2026-11-05 사용자 '앱 시작 고쳐'). 원래는 JS가 뜬 뒤에야 사진을 띄워, 그 전까지(시작의 대부분) 기기 시작 화면만 보였다.
// 사진 규칙은 ui/home-snapshot과 같은 폴더·같은 meta.json을 본다. JS의 시작 화면(LoadingScreen)이 같은 사진을 그리면 hide로 걷는다.
// 못 띄우면(사진 없음·화면 크기나 글자 크기가 다름·앱을 올린 직후) 아무것도 하지 않고 예전 흐름 그대로다.
internal object StartPhoto {
  private const val TAG = "StartPhoto"
  private const val GIVE_UP_MS = 30_000L
  private var view: View? = null
  private var tried = false // 프로세스마다 한 번(화면을 다시 만들 때는 JS가 이미 떠 있어 걷어 줄 쪽이 없다)

  fun show(activity: Activity) {
    if (tried) return
    tried = true
    val t0 = SystemClock.uptimeMillis()
    try {
      val dir = File(activity.filesDir, "home-snapshot")
      val meta = JSONObject(File(dir, "meta.json").readText())
      val file = File(dir, meta.getString("file"))
      if (!file.exists()) return
      // 앱을 올린 뒤 첫 실행은 쓰지 않는다(그림 규칙이 바뀌었을 수 있다. JS가 meta의 rev를 보고 다시 찍는다)
      val updated = activity.packageManager.getPackageInfo(activity.packageName, 0).lastUpdateTime
      if (file.lastModified() < updated) return
      val res = activity.resources
      if (abs(meta.getDouble("scale") - res.displayMetrics.density) > 0.01) return
      if (abs(meta.getDouble("fontScale") - res.configuration.fontScale) > 0.01) return
      val (winW, winH) = windowSize(activity)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      if (abs(bounds.outWidth - winW) > 2 || abs(bounds.outHeight - winH) > 2) return
      val bitmap = BitmapFactory.decodeFile(file.path) ?: return
      val photo = ImageView(activity).apply {
        setImageBitmap(bitmap)
        scaleType = ImageView.ScaleType.FIT_XY
        isClickable = true // 사진 아래로 터치가 새지 않게
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      }
      val decor = activity.window.decorView as ViewGroup
      decor.addView(photo, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      view = photo
      lightBars(activity, decor)
      // 기기 시작 화면을 바로 걷는다(시작 화면은 첫 그리기를 막아 두므로 걷지 않으면 사진도 안 보인다)
      SplashScreenManager.hide()
      Handler(Looper.getMainLooper()).postDelayed({ hide() }, GIVE_UP_MS)
      Log.i(TAG, "shown decode=${SystemClock.uptimeMillis() - t0}ms sinceProcess=${SystemClock.uptimeMillis() - Process.getStartUptimeMillis()}ms")
    } catch (e: java.io.FileNotFoundException) {
      Log.i(TAG, "no photo")
    } catch (e: Exception) {
      Log.w(TAG, "skip: ${e.message}")
    }
  }

  fun hide() {
    Handler(Looper.getMainLooper()).post {
      val photo = view ?: return@post
      view = null
      (photo.parent as? ViewGroup)?.removeView(photo)
      (photo as? ImageView)?.setImageDrawable(null)
      Log.i(TAG, "hidden sinceProcess=${SystemClock.uptimeMillis() - Process.getStartUptimeMillis()}ms")
    }
  }

  private fun windowSize(activity: Activity): Pair<Int, Int> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = activity.windowManager.currentWindowMetrics.bounds
      return b.width() to b.height()
    }
    val m = android.util.DisplayMetrics()
    @Suppress("DEPRECATION")
    activity.windowManager.defaultDisplay.getRealMetrics(m)
    return m.widthPixels to m.heightPixels
  }

  // 사진 위 상태 표시줄 글자를 어둡게(앱 화면과 같다. JS가 뜬 뒤에는 expo-status-bar가 맡는다)
  private fun lightBars(activity: Activity, decor: View) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      activity.window.insetsController?.setSystemBarsAppearance(flags, flags)
    } else {
      @Suppress("DEPRECATION")
      decor.systemUiVisibility = decor.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
    }
  }
}

internal object StartPhotoListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    StartPhoto.show(activity)
  }
}
