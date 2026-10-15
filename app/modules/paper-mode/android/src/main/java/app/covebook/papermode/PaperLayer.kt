package app.covebook.papermode

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.view.View
import java.util.concurrent.Executors

// 종이 한 장(색감 + 결)을 그리는 뷰. 오버레이 창과 설정 미리보기가 같은 그림·같은 합성을 쓴다:
// 그림(compose)을 불투명도 windowAlpha로 아래 화면 위에 보통 알파 합성한다. 오버레이 창에서는 창 alpha가, 미리보기에서는 칠하기 alpha가 그 값이다.
// 그림은 크기·값이 바뀔 때만 다시 만들고(백그라운드 한 스레드), 그 사이에는 다시 그리지 않는다(정적인 결이라 프레임마다 그릴 일이 없다).
class PaperLayer(context: Context, private val asWindow: Boolean) : View(context) {
  var settings: PaperSettings = PaperSettings.DEFAULT
    set(value) {
      if (field == value) return
      field = value
      rebuild()
    }
  // 시스템이 허용하는 최대 가림 불투명도(창으로 쓸 때만 의미가 있다)
  var maxWindowAlpha = 1f
  // 새 그림이 준비됐을 때: 창 불투명도(창은 LayoutParams.alpha로 반영)와 시스템 제한으로 약해졌는지
  var onComposed: ((Float, Boolean) -> Unit)? = null

  private var bitmap: Bitmap? = null
  private var layerAlpha = 0f
  @Volatile private var generation = 0
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val main = Handler(Looper.getMainLooper())

  init {
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    isClickable = false
    isFocusable = false
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    rebuild()
  }

  private fun rebuild() {
    val w = width
    val h = height
    if (w <= 0 || h <= 0) return
    val s = settings
    val density = resources.displayMetrics.density
    val maxA = maxWindowAlpha
    val gen = ++generation
    worker.execute {
      // 값을 끌며 바꾸는 동안 쌓인 옛 요청은 건너뛴다(마지막 값만 그린다)
      if (gen != generation) return@execute
      val noise = PaperNoise.field(w, h, density)
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val c = PaperLook.compose(s, noise, w, h, bmp, maxA)
      main.post {
        if (gen != generation) {
          bmp.recycle()
          return@post
        }
        val old = bitmap
        bitmap = bmp
        layerAlpha = c.windowAlpha
        onComposed?.invoke(c.windowAlpha, c.limited)
        invalidate()
        old?.recycle()
      }
    }
  }

  override fun onDraw(canvas: Canvas) {
    val b = bitmap ?: return
    // 창이면 불투명도는 창 alpha가 맡는다(그림은 그대로). 미리보기면 같은 값을 칠하기에 준다
    // (창 alpha는 실수라, 미리보기도 8비트로 반올림하지 않게 Android 10+에서는 실수 불투명도를 쓴다)
    val a = if (asWindow) 1f else layerAlpha
    if (android.os.Build.VERSION.SDK_INT >= 29) paint.setColor(android.graphics.Color.pack(0f, 0f, 0f, a))
    else paint.alpha = (a * 255f).toInt().coerceIn(0, 255)
    if (b.width == width && b.height == height) canvas.drawBitmap(b, 0f, 0f, paint)
    else canvas.drawBitmap(b, null, android.graphics.Rect(0, 0, width, height), paint) // 회전 직후 새 그림이 오기 전 잠깐
  }

  fun release() {
    generation++
    bitmap?.recycle()
    bitmap = null
  }

  companion object {
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "paper-mode").apply { isDaemon = true } }
  }
}
