package app.covebook.papermode

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

// JS ↔ 종이 모드. 상태의 진실은 서비스가 살아 있는지(시스템에 묻는다)와 실제 권한이다(앱이 따로 들고 있지 않는다).
// 서비스는 다른 프로세스(":paper")에 있다: 연락은 PaperBus.
class PaperModeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not ready")

  // 서비스가 상태를 바꿀 때 보내는 방송(이 앱 안에서만)
  private var receiver: BroadcastReceiver? = null

  private fun observe(on: Boolean) {
    val ctx = appContext.reactContext ?: return
    receiver?.let { runCatching { ctx.unregisterReceiver(it) } }
    receiver = null
    if (!on) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context, i: Intent) {
        runCatching { sendEvent("onChange", state()) }
      }
    }
    val f = IntentFilter(PaperBus.ACTION_STATE)
    if (Build.VERSION.SDK_INT >= 26) ctx.registerReceiver(r, f, PaperBus.registerFlags()) else ctx.registerReceiver(r, f)
    receiver = r
  }

  private fun state(): Map<String, Any?> {
    val pid = PaperBus.runningPid(context)
    val running = pid != null
    val snap = PaperBus.read(context)
    // 켜졌지만 새 서비스가 아직 상태를 쓰지 않았다(프로세스를 띄우고 창을 붙이는 중)
    val starting = running && snap.pid != pid
    val live = running && !starting
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return mapOf(
      "running" to running,
      "starting" to starting,
      "shown" to (live && snap.shown),
      "limited" to (live && snap.limited),
      "windowAlpha" to (if (live) snap.windowAlpha else 0f).toDouble(),
      "maxObscuringOpacity" to PaperOverlayService.maxObscuringOpacity(context).toDouble(),
      "canDrawOverlays" to Settings.canDrawOverlays(context),
      "notificationsEnabled" to nm.areNotificationsEnabled(),
      "lastError" to (if (running) null else snap.lastError),
    )
  }

  private fun settingsMap(s: PaperSettings) = mapOf("palette" to s.palette, "tint" to s.tint.toDouble(), "grain" to s.grain.toDouble())

  override fun definition() = ModuleDefinition {
    Name("PaperMode")
    Events("onChange")

    OnStartObserving { observe(true) }
    OnStopObserving { observe(false) }
    OnDestroy { observe(false) }

    // TYPE_APPLICATION_OVERLAY가 있는 Android 8.0(API 26)부터
    Function("isSupported") { Build.VERSION.SDK_INT >= 26 }
    Function("getState") { state() }
    Function("getSettings") { settingsMap(PaperSettings.load(context)) }

    // 값 저장 + 켜져 있으면 바로 반영
    Function("setSettings") { palette: String, tint: Double, grain: Double ->
      val s = PaperSettings.of(palette, tint, grain)
      s.save(context)
      if (PaperBus.isRunning(context)) context.startService(PaperBus.withSettings(PaperBus.intent(context, PaperBus.ACTION_UPDATE), s))
      settingsMap(s)
    }

    // 다른 앱 위 표시 설정 화면(이 앱 항목)을 연다. 돌아오면 JS가 getState로 실제 권한을 다시 확인한다
    Function("openOverlaySettings") {
      val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      val activity = appContext.currentActivity
      if (activity != null) activity.startActivity(i) else context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // 앱 화면에서 사용자가 켤 때만 부른다(포그라운드 서비스는 앱이 보이는 동안 시작해야 한다). 권한이 없으면 false
    Function("start") {
      if (Build.VERSION.SDK_INT < 26 || !Settings.canDrawOverlays(context)) return@Function false
      context.startForegroundService(PaperBus.withSettings(PaperBus.intent(context, PaperBus.ACTION_START), PaperSettings.load(context)))
      true
    }

    Function("stop") {
      context.stopService(Intent(context, PaperOverlayService::class.java))
    }

    // 설정 미리보기: 오버레이 창과 같은 그림(PaperLayer)을 같은 불투명도로 그 아래 화면(형제 뷰) 위에 합성한다
    View(PaperPreviewView::class) {
      Prop("palette") { v: PaperPreviewView, p: String -> v.set(palette = p) }
      Prop("tint") { v: PaperPreviewView, t: Double -> v.set(tint = t) }
      Prop("grain") { v: PaperPreviewView, g: Double -> v.set(grain = g) }
      Prop("active") { v: PaperPreviewView, a: Boolean -> v.setActive(a) }
    }
  }
}

class PaperPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val layer = PaperLayer(context, asWindow = false)
  private var palette: String = PaperSettings.DEFAULT.palette
  private var tint: Double = PaperSettings.DEFAULT.tint.toDouble()
  private var grain: Double = PaperSettings.DEFAULT.grain.toDouble()

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    addView(layer, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  fun set(palette: String? = null, tint: Double? = null, grain: Double? = null) {
    palette?.let { this.palette = it }
    tint?.let { this.tint = it }
    grain?.let { this.grain = it }
    layer.settings = PaperSettings.of(this.palette, this.tint, this.grain)
  }

  fun setActive(active: Boolean) {
    layer.visibility = if (active) VISIBLE else INVISIBLE
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    layer.layout(0, 0, r - l, b - t)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    layer.release()
  }
}
