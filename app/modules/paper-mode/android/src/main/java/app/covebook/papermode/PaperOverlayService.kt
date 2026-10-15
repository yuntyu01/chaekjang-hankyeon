package app.covebook.papermode

import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.hardware.input.InputManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.WindowManager

// 종이 모드 오버레이 서비스. 켜져 있는 동안만 산다(포그라운드 서비스 + '끄기' 알림).
// - 창은 하나: TYPE_APPLICATION_OVERLAY, 터치·입력 포커스를 받지 않는다(FLAG_NOT_TOUCHABLE | FLAG_NOT_FOCUSABLE).
//   색감과 결은 그 창 안 한 장의 그림으로 합성하고, 창 불투명도(LayoutParams.alpha)는 효과의 가장 큰 불투명도다.
//   Android 12+는 다른 앱 창이 터치를 가리는 정도를 창 alpha로 판정한다: 그 값이 시스템 최대 가림 불투명도
//   (InputManager.getMaximumObscuringOpacityForTouch, 기본 0.8) 이하여야 아래 앱이 터치를 받는다. 그림의 투명도만 낮추고 창 alpha를 1로 두면 터치가 막힌다.
// - 화면이 꺼지면 창을 떼고, 잠금이 풀리면 다시 붙인다(잠금 화면 위에 그리지 않는다).
// - 다른 앱 위 표시 권한이 회수되면 스스로 끝난다. 시스템이 죽였다가 다시 살리면(START_NOT_STICKY라 보통 없다) 켜지 않고 끝난다.
// - 켜져 있다는 사실은 저장하지 않는다: 재부팅·강제 종료 뒤에는 꺼진 상태다.
// - 앱과 다른 프로세스(":paper")에서 돈다. 앱과의 연락은 PaperBus.
class PaperOverlayService : Service() {
  companion object {
    private const val TAG = "PaperMode"
    private const val CHANNEL = "paper_mode"
    private const val NOTE_ID = 4108

    fun maxObscuringOpacity(context: Context): Float =
      if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.INPUT_SERVICE) as InputManager).maximumObscuringOpacityForTouch
      else 1f
  }

  private val main = Handler(Looper.getMainLooper())
  private lateinit var wm: WindowManager
  private var layer: PaperLayer? = null
  private var params: WindowManager.LayoutParams? = null
  private var attached = false
  private var screenReceiver: BroadcastReceiver? = null
  private var opsListener: AppOpsManager.OnOpChangedListener? = null
  private var active = false // ACTION_START로 켜졌다
  private var settings: PaperSettings = PaperSettings.DEFAULT
  // 시스템 제한으로 효과가 약해졌는지, 지금 창 불투명도, 마지막으로 끝난 이유("permission" 권한 회수·없음, "start" 시작 불가)
  private var limited = false
  private var windowAlpha = 0f
  private var lastError: String? = null

  // 앱에 지금 상태를 알린다(창이 붙어 있는지 = 꺼진 화면·잠금 중에는 떼어 둔다)
  private fun notifyState() = PaperBus.publish(this, PaperBus.Snapshot(attached, limited, if (attached) windowAlpha else 0f, lastError))

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    wm = getSystemService(WINDOW_SERVICE) as WindowManager
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == PaperBus.ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    // 앱에서 값을 바꿨다(켜져 있을 때만 앱이 보낸다). 그새 꺼졌으면 이 호출로 새로 켜지지 않게 끝낸다
    if (intent?.action == PaperBus.ACTION_UPDATE) {
      val s = PaperBus.settingsOf(intent)
      if (!active) stopSelf() else if (s != null) update(s)
      return START_NOT_STICKY
    }
    // startForegroundService로 시작했으면 끝내더라도 먼저 포그라운드로 올라가야 한다(아니면 시스템이 앱을 멈춘다)
    if (!goForeground()) return START_NOT_STICKY
    if (intent?.action != PaperBus.ACTION_START) {
      // 시스템이 되살린 경우 등: 사용자 뜻 없이 켜지 않는다
      stopSelf()
      return START_NOT_STICKY
    }
    if (!Settings.canDrawOverlays(this)) {
      lastError = "permission"
      stopSelf()
      return START_NOT_STICKY
    }
    lastError = null
    active = true
    settings = PaperBus.settingsOf(intent) ?: PaperSettings.load(this)
    layer?.settings = settings
    watch()
    if (isInteractiveUnlocked()) attach() else notifyState()
    return START_NOT_STICKY
  }

  private fun goForeground(): Boolean {
    ensureChannel()
    return try {
      if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      else startForeground(NOTE_ID, notification())
      true
    } catch (e: Exception) {
      // Android 12+: 백그라운드에서 시작하려 하면 ForegroundServiceStartNotAllowedException. 앱 화면에서 켤 때만 시작한다
      Log.w(TAG, "startForeground failed", e)
      lastError = "start"
      stopSelf()
      notifyState()
      false
    }
  }

  // 앱에서 값을 바꾸면 바로 반영(창을 다시 붙이지 않고 그림만 다시 만든다)
  private fun update(s: PaperSettings) {
    settings = s
    layer?.settings = s
  }

  private fun attach() {
    if (attached) return
    if (!Settings.canDrawOverlays(this)) {
      lastError = "permission"
      stopSelf()
      return
    }
    val v = layer ?: PaperLayer(this, asWindow = true).also { layer = it }
    v.maxWindowAlpha = maxObscuringOpacity(this)
    v.settings = settings
    val p = params ?: WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      title = "PaperMode"
      // 그림이 준비되기 전에는 보이지 않게(그림이 오면 그 불투명도로)
      alpha = 0f
      if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode =
        if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      if (Build.VERSION.SDK_INT >= 30) fitInsetsTypes = 0
    }.also { params = it }
    v.onComposed = { a, lim ->
      windowAlpha = a
      limited = lim
      p.alpha = a
      if (attached) runCatching { wm.updateViewLayout(v, p) }
      notifyState()
    }
    try {
      wm.addView(v, p)
      attached = true
    } catch (e: Exception) {
      // 권한이 막 회수됐거나 창을 붙일 수 없는 상태
      Log.w(TAG, "addView failed", e)
      lastError = "permission"
      stopSelf()
      return
    }
    notifyState()
  }

  private fun detach() {
    val v = layer ?: return
    if (attached) runCatching { wm.removeViewImmediate(v) }
    attached = false
    notifyState()
  }

  private fun isInteractiveUnlocked(): Boolean {
    val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
    val km = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
    return pm.isInteractive && !km.isKeyguardLocked
  }

  private val recheck = Runnable { if (active && isInteractiveUnlocked()) attach() }

  private fun watch() {
    if (screenReceiver == null) {
      val r = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
          when (i.action) {
            Intent.ACTION_SCREEN_OFF -> {
              main.removeCallbacks(recheck)
              detach()
            }
            // 잠금이 없으면 화면이 켜질 때 붙인다. 켜지는 순간에는 잠금 화면이 잠깐 잠긴 것으로 보일 수 있어 조금 뒤 한 번 더 본다
            Intent.ACTION_SCREEN_ON -> {
              if (isInteractiveUnlocked()) attach()
              else {
                main.removeCallbacks(recheck)
                main.postDelayed(recheck, 1500)
              }
            }
            // 잠금이 풀렸다(이 방송 자체가 사용자가 잠금을 넘겼다는 뜻이다. 이때 isKeyguardLocked가 아직 true일 수 있다)
            Intent.ACTION_USER_PRESENT -> if ((getSystemService(POWER_SERVICE) as android.os.PowerManager).isInteractive) attach()
          }
        }
      }
      val f = IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      }
      // USER_PRESENT는 시스템 서버가 아니라 SystemUI가 보내서 RECEIVER_NOT_EXPORTED로는 받지 못한다.
      // 세 동작 모두 보호된 방송(플랫폼만 보낼 수 있다)이라 내보내도 다른 앱이 흉내 낼 수 없다
      if (Build.VERSION.SDK_INT >= 33) registerReceiver(r, f, RECEIVER_EXPORTED) else registerReceiver(r, f)
      screenReceiver = r
    }
    if (opsListener == null) {
      val ops = getSystemService(APP_OPS_SERVICE) as AppOpsManager
      val l = AppOpsManager.OnOpChangedListener { _, pkg ->
        if (pkg != packageName) return@OnOpChangedListener
        // 바뀐 값이 반영된 뒤 확인한다
        main.postDelayed({
          if (active && !Settings.canDrawOverlays(this)) {
            lastError = "permission"
            stopSelf()
          }
        }, 300)
      }
      ops.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, packageName, l)
      opsListener = l
    }
  }

  override fun onDestroy() {
    detach()
    layer?.release()
    layer = null
    screenReceiver?.let { runCatching { unregisterReceiver(it) } }
    screenReceiver = null
    opsListener?.let { (getSystemService(APP_OPS_SERVICE) as AppOpsManager).stopWatchingMode(it) }
    opsListener = null
    main.removeCallbacksAndMessages(null)
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    active = false
    windowAlpha = 0f
    limited = false
    notifyState()
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL, "종이 모드", NotificationManager.IMPORTANCE_LOW).apply {
        description = "종이 모드가 켜져 있는 동안 보이는 알림이에요. 여기서 끌 수 있어요."
        setShowBadge(false)
      },
    )
  }

  private fun notification(): Notification {
    val stop = PendingIntent.getBroadcast(
      this, 1,
      Intent(this, PaperStopReceiver::class.java).setAction(PaperBus.ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 2, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    b.setSmallIcon(R.drawable.paper_mode_notification)
      .setContentTitle("종이 모드 켜짐")
      .setContentText("화면 전체에 옅은 종이 색과 결을 얹고 있어요")
      .setOngoing(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setColor(0xFF81573E.toInt())
      .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "끄기", stop).build())
    if (open != null) b.setContentIntent(open)
    if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    return b.build()
  }
}

// 알림의 '끄기': 서비스를 멈춘다(멈추기는 백그라운드에서도 허용된다)
class PaperStopReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == PaperBus.ACTION_STOP) context.stopService(Intent(context, PaperOverlayService::class.java))
  }
}
