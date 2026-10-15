package app.covebook.papermode

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import java.io.File

// 앱 프로세스 ↔ 종이 모드 프로세스(":paper") 사이의 연락.
// 오버레이 서비스를 앱(React Native)과 다른 프로세스에 두는 이유: 포그라운드 서비스가 붙은 프로세스는 백그라운드에서도
// 캐시·동결(cached app freezer)되지 않는다. 같은 프로세스면 종이 모드를 켜 둔 동안 다른 앱으로 가도 앱 전체(JS·애니메이션)가
// 계속 깨어 있다. 따로 두면 앱 프로세스는 평소처럼 동결되고, 깨어 있는 것은 그림 한 장을 든 작은 프로세스뿐이다.
// - 앱 → 서비스: 인텐트(켜기·값 바꾸기는 값과 함께, 끄기는 stopService). 서비스 쪽 SharedPreferences 캐시에 기대지 않는다.
// - 서비스 → 앱: 작은 상태 파일 + 같은 앱에만 가는 방송(바뀔 때). 서비스가 살아 있는지는 시스템에 묻는다(파일이 남아 있어도 속지 않게).
object PaperBus {
  const val ACTION_START = "app.covebook.papermode.START"
  const val ACTION_UPDATE = "app.covebook.papermode.UPDATE"
  const val ACTION_STOP = "app.covebook.papermode.STOP"
  const val ACTION_STATE = "app.covebook.papermode.STATE"

  // pid: 이 상태를 쓴 서비스 프로세스. 지금 살아 있는 서비스와 다르면 이전 실행이 남긴 상태다(새 서비스가 아직 창을 붙이는 중)
  class Snapshot(val shown: Boolean, val limited: Boolean, val windowAlpha: Float, val lastError: String?, val pid: Int = android.os.Process.myPid())

  private fun file(context: Context) = File(context.noBackupFilesDir, "paper_mode_state")

  fun withSettings(i: Intent, s: PaperSettings): Intent =
    i.putExtra("palette", s.palette).putExtra("tint", s.tint).putExtra("grain", s.grain)

  fun settingsOf(i: Intent?): PaperSettings? {
    if (i == null || !i.hasExtra("palette")) return null
    return PaperSettings.of(i.getStringExtra("palette"), i.getFloatExtra("tint", PaperSettings.DEFAULT.tint).toDouble(), i.getFloatExtra("grain", PaperSettings.DEFAULT.grain).toDouble())
  }

  // 서비스 프로세스: 상태를 쓰고 앱에 알린다
  fun publish(context: Context, s: Snapshot) {
    runCatching {
      val f = file(context)
      val tmp = File(f.parentFile, f.name + ".tmp")
      tmp.writeText("${s.shown}\n${s.limited}\n${s.windowAlpha}\n${s.lastError ?: ""}\n${s.pid}\n")
      tmp.renameTo(f)
    }
    context.sendBroadcast(Intent(ACTION_STATE).setPackage(context.packageName))
  }

  fun read(context: Context): Snapshot {
    val lines = runCatching { file(context).readLines() }.getOrNull()
    if (lines == null || lines.size < 5) return Snapshot(false, false, 0f, null, 0)
    return Snapshot(lines[0] == "true", lines[1] == "true", lines[2].toFloatOrNull() ?: 0f, lines[3].ifEmpty { null }, lines[4].toIntOrNull() ?: 0)
  }

  // 켜진 서비스의 프로세스 id(없으면 null). 이 앱의 서비스는 Android 8+에서도 getRunningServices로 보인다(다른 앱 것은 안 보인다)
  @Suppress("DEPRECATION")
  fun runningPid(context: Context): Int? {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val name = PaperOverlayService::class.java.name
    return am.getRunningServices(Int.MAX_VALUE).firstOrNull { it.service.packageName == context.packageName && it.service.className == name && it.started }?.pid
  }

  fun isRunning(context: Context): Boolean = runningPid(context) != null

  fun intent(context: Context, action: String): Intent = Intent(context, PaperOverlayService::class.java).setAction(action)

  fun registerFlags(): Int = if (Build.VERSION.SDK_INT >= 33) Context.RECEIVER_NOT_EXPORTED else 0
}
