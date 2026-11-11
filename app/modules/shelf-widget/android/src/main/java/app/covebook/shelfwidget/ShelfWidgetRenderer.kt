package app.covebook.shelfwidget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import java.io.File
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

// 위젯 한 장 그리기. 비율은 사용자 시안(2026-11-11, 카드 폭 W 기준)에서 잰 값:
// 머리글 가운데 높이 0.0525W, 좌우 여백 0.0558W, '나의 책장' Bold 0.0478W(짙은 회색), 해 Medium 0.0286W(옅은 갈회색),
// 책장 구멍 위 끝 0.106W, 맨 아래 선반 밑 여백 0.045W. 글꼴은 앱 화면과 같은 G마켓 산스(위젯에 쓰는 글자만 떼어 낸 파일).
// 책장 그림은 위 끝(벽만 있는 줄)을 걷어 내고 카드 폭에 꽉 차게 둔다. 들어가는 만큼(두 칸 → 한 칸) 보이고, 한 칸도 안 들어가면 줄여서 가운데.
internal object ShelfWidgetRenderer {
  private const val MAX_W = 1000 // 그림 폭 상한(px): 위젯 그림은 RemoteViews로 넘어가 메모리 한도가 있다
  private const val MIN_FILL = 0.8f // 두 칸을 넣으려고 줄일 수 있는 한도(책장 폭이 카드 폭의 80%까지)
  private val TITLE = Color.rgb(34, 30, 31)
  private val YEAR = Color.rgb(172, 154, 140)
  private val HINT = Color.rgb(150, 140, 135)
  private val CARD = Color.rgb(246, 244, 242) // 그림이 없을 때 카드 바탕

  private var bold: Typeface? = null
  private var medium: Typeface? = null
  private fun fonts(context: Context): Pair<Typeface, Typeface> {
    val b = bold ?: runCatching { Typeface.createFromAsset(context.assets, "shelf-widget/GmarketSansBold.ttf") }.getOrDefault(Typeface.DEFAULT_BOLD).also { bold = it }
    val m = medium ?: runCatching { Typeface.createFromAsset(context.assets, "shelf-widget/GmarketSansMedium.ttf") }.getOrDefault(Typeface.DEFAULT).also { medium = it }
    return b to m
  }

  fun render(context: Context, wDp: Int, hDp: Int): Bitmap {
    val density = context.resources.displayMetrics.density
    var w = (wDp * density).roundToInt().coerceAtLeast(1)
    var h = (hDp * density).roundToInt().coerceAtLeast(1)
    if (w > MAX_W) { h = (h * MAX_W.toFloat() / w).roundToInt(); w = MAX_W }
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val W = w.toFloat()
    val prefs = context.getSharedPreferences(ShelfWidgetProvider.PREFS, Context.MODE_PRIVATE)
    val year = prefs.getInt("year", java.util.Calendar.getInstance().get(java.util.Calendar.YEAR))
    val shelf = prefs.getString("path", null)?.let { p -> if (File(p).exists()) runCatching { BitmapFactory.decodeFile(p) }.getOrNull() else null }
    val bottoms = prefs.getString("bottoms", "")!!.split(",").mapNotNull { it.trim().toIntOrNull() }.filter { it > 0 }

    // 카드: 책장 벽과 같은 색(그림 맨 위 가운데)이라 그림 가장자리가 보이지 않는다
    val card = shelf?.getPixel(shelf.width / 2, 1) ?: CARD
    val radius = if (Build.VERSION.SDK_INT >= 31) runCatching { context.resources.getDimension(android.R.dimen.system_app_widget_background_radius) }.getOrDefault(0.048f * W) else 0.048f * W
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = card }
    canvas.drawRoundRect(RectF(0f, 0f, W, h.toFloat()), radius, radius, fill)

    // 머리글: 두 글자의 세로 가운데를 같은 높이에
    val (b, m) = fonts(context)
    val pad = 0.0558f * W
    val midY = 0.0525f * W
    val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = b; textSize = 0.0478f * W; color = TITLE }
    val yearPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = m; textSize = 0.0286f * W; color = YEAR; textAlign = Paint.Align.RIGHT }
    canvas.drawText("나의 책장", pad, centerBaseline(title, "나의 책장", midY), title)
    canvas.drawText(year.toString(), W - pad, centerBaseline(yearPaint, year.toString(), midY), yearPaint)

    val top = 0.106f * W
    val bottomPad = 0.045f * W
    if (shelf == null || bottoms.isEmpty()) {
      val hint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = m; textSize = 0.04f * W; color = HINT; textAlign = Paint.Align.CENTER }
      canvas.drawText("앱을 열면 책장이 보여요.", W / 2, centerBaseline(hint, "앱을 열면 책장이 보여요.", (top + h) / 2), hint)
      return out
    }
    val skip = wallRows(shelf, card, bottoms.first())
    val avail = h - top - bottomPad
    val fullScale = W / shelf.width
    // 보일 칸 수: 카드 폭의 80% 이상으로 들어가는 가장 많은 칸(위젯을 세로로 늘리면 두 칸). 한 칸은 늘 보이고, 모자라면 줄여서 가운데
    var rows = 0
    for (i in bottoms.indices) {
      val need = (min(bottoms[i], shelf.height) - skip) * fullScale
      if (i == 0 || avail / need >= MIN_FILL) rows = i
    }
    val srcBottom = min(bottoms[rows], shelf.height)
    val srcH = (srcBottom - skip).coerceAtLeast(1)
    val scale = min(fullScale, avail / srcH)
    val dw = shelf.width * scale
    val dh = srcH * scale
    // 남는 높이는 위아래로 나눠(머리글 쪽은 시안 간격을 지킨다)
    val dy = top + (avail - dh).coerceAtLeast(0f) / 2f
    val dx = (W - dw) / 2f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.save()
    canvas.clipRect(0f, top - 1f, W, h - bottomPad * 0.35f)
    canvas.drawBitmap(shelf, Rect(0, skip, shelf.width, srcBottom), RectF(dx, dy, dx + dw, dy + dh), paint)
    canvas.restore()
    shelf.recycle()
    return out
  }

  // 글자 칸의 세로 가운데가 y에 오도록 하는 기준선
  private fun centerBaseline(p: Paint, text: String, y: Float): Float {
    val r = Rect()
    p.getTextBounds(text, 0, text.length, r)
    return y - (r.top + r.bottom) / 2f
  }

  // 그림 위쪽에서 벽 색만 있는 줄 수(책장 구멍 위 끝까지). 가운데 90%를 8px 간격으로 본다
  private fun wallRows(img: Bitmap, wall: Int, limit: Int): Int {
    val x0 = (img.width * 0.05f).toInt()
    val x1 = (img.width * 0.95f).toInt()
    for (y in 0 until min(limit, img.height)) {
      var x = x0
      while (x < x1) {
        val c = img.getPixel(x, y)
        if (abs(Color.red(c) - Color.red(wall)) + abs(Color.green(c) - Color.green(wall)) + abs(Color.blue(c) - Color.blue(wall)) > 24) return (y - 2).coerceAtLeast(0)
        x += 8
      }
    }
    return 0
  }
}
