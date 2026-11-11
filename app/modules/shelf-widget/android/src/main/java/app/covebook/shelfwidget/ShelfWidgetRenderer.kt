package app.covebook.shelfwidget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// 위젯 그림 두 가지(2026-11-11 사용자):
// - 꽉 찬 위젯: 글자 없이 책장 구멍(틀 포함)이 위젯을 채운다. 카드 바탕은 책장 벽 색이라 남는 자리는 벽처럼 보인다.
// - 투명 위젯: 선반 판과 책만(벽·틀은 투명). 앱이 넘긴 모양(책 외곽·갈피 띠·판 띠)으로 홈 사진을 오려 낸 PNG를 쓴다.
// 보일 칸 수는 위젯을 가장 넓게 채우는 쪽(4×2는 한 칸, 세로로 늘리면 두 칸).
internal object ShelfWidgetRenderer {
  private const val MAX_W = 1000 // 그림 폭 상한(px): 위젯 그림은 RemoteViews로 넘어가 메모리 한도가 있다
  private val HINT = Color.rgb(150, 140, 135)
  private val CARD = Color.rgb(246, 244, 242) // 그림이 없을 때 카드 바탕

  private fun bitmapFor(context: Context, wDp: Int, hDp: Int): Bitmap {
    val density = context.resources.displayMetrics.density
    var w = (wDp * density).roundToInt().coerceAtLeast(1)
    var h = (hDp * density).roundToInt().coerceAtLeast(1)
    if (w > MAX_W) { h = (h * MAX_W.toFloat() / w).roundToInt(); w = MAX_W }
    return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  }

  private fun prefs(context: Context) = context.getSharedPreferences(ShelfWidgetProvider.PREFS, Context.MODE_PRIVATE)
  private fun bottomsOf(context: Context) = prefs(context).getString("bottoms", "")!!.split(",").mapNotNull { it.trim().toIntOrNull() }.filter { it > 0 }
  private fun load(path: String?) = path?.let { p -> if (File(p).exists()) runCatching { BitmapFactory.decodeFile(p) }.getOrNull() else null }

  // 위젯 안에 내용(box) 한 칸·두 칸 중 위젯을 가장 넓게 채우는 것을 골라 비율 그대로 가운데에(남는 자리는 비운다)
  private fun place(W: Float, H: Float, boxes: List<RectF>): Pair<RectF, RectF>? {
    var best: Pair<RectF, RectF>? = null
    var bestArea = -1f
    for (src in boxes) {
      if (src.width() <= 0f || src.height() <= 0f) continue
      val s = min(W / src.width(), H / src.height())
      val dw = src.width() * s
      val dh = src.height() * s
      val area = dw * dh
      if (area > bestArea * 1.03f) { // 거의 같으면 칸이 적은 쪽(먼저 본 쪽)
        bestArea = area
        best = src to RectF((W - dw) / 2f, (H - dh) / 2f, (W + dw) / 2f, (H + dh) / 2f)
      }
    }
    return best
  }

  private fun hint(canvas: Canvas, W: Float, H: Float) {
    val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 0.045f * W; color = HINT; textAlign = Paint.Align.CENTER }
    canvas.drawText("앱을 열면 책장이 보여요.", W / 2, H / 2 - (p.ascent() + p.descent()) / 2, p)
  }

  fun renderFill(context: Context, wDp: Int, hDp: Int): Bitmap {
    val out = bitmapFor(context, wDp, hDp)
    val canvas = Canvas(out)
    val W = out.width.toFloat()
    val H = out.height.toFloat()
    val shelf = load(prefs(context).getString("path", null))
    val bottoms = bottomsOf(context)
    // 카드: 책장 벽과 같은 색(그림 맨 위 가운데)이라 그림 가장자리가 보이지 않는다
    val card = shelf?.getPixel(shelf.width / 2, 1) ?: CARD
    val radius = if (Build.VERSION.SDK_INT >= 31) runCatching { context.resources.getDimension(android.R.dimen.system_app_widget_background_radius) }.getOrDefault(0.048f * W) else 0.048f * W
    canvas.drawRoundRect(RectF(0f, 0f, W, H), radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = card })
    if (shelf == null || bottoms.isEmpty()) { hint(canvas, W, H); return out }
    // 구멍 위 끝(벽만 있는 줄을 걷어 낸 곳)과 옆 여백(구멍 밖 벽 폭): 위·아래에도 옆과 같은 벽 여백을 둬 시스템 둥근 모서리가 틀을 깎지 않게
    val top = wallRows(shelf, card, bottoms.first())
    val side = wallCols(shelf, card, top + (bottoms.first() - top) / 2).toFloat()
    val boxes = bottoms.map { b -> RectF(0f, top - side, shelf.width.toFloat(), min(b, shelf.height) + side) }
    val (src, dst) = place(W, H, boxes) ?: return out
    // 그림 밖(위·아래 여백)은 카드 색 그대로: 그림 안쪽만 옮긴다
    val s = dst.width() / src.width()
    val inner = Rect(0, max(0, src.top.toInt()), shelf.width, min(shelf.height, src.bottom.toInt()))
    val innerDst = RectF(dst.left, dst.top + (inner.top - src.top) * s, dst.right, dst.top + (inner.bottom - src.top) * s)
    canvas.drawBitmap(shelf, inner, innerDst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    shelf.recycle()
    return out
  }

  fun renderCut(context: Context, wDp: Int, hDp: Int): Bitmap {
    val out = bitmapFor(context, wDp, hDp)
    val canvas = Canvas(out)
    val W = out.width.toFloat()
    val H = out.height.toFloat()
    val cut = load(prefs(context).getString("cut", null))
    val bottoms = bottomsOf(context)
    if (cut == null || bottoms.isEmpty()) { hint(canvas, W, H); return out }
    // 내용(불투명 화소)이 있는 범위만: 위 끝·왼쪽·오른쪽은 오려 낸 그림에서 잰다
    val bounds = opaqueBounds(cut) ?: return out
    val boxes = bottoms.map { b -> RectF(bounds.left.toFloat(), bounds.top.toFloat(), bounds.right.toFloat(), min(b, cut.height).toFloat()) }
    val (src, dst) = place(W, H, boxes) ?: return out
    canvas.drawBitmap(cut, Rect(src.left.toInt(), src.top.toInt(), src.right.toInt(), src.bottom.toInt()), dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    cut.recycle()
    return out
  }

  // 홈 사진에서 책·갈피·선반 판만 남기고 나머지를 투명하게(PNG). 책은 외곽 다각형 그대로(가장자리 부드럽게),
  // 갈피 띠 안에서는 색이 있는 화소(벽은 흰·회색), 판 띠 안에서는 나무 색 화소(노란 주황 색조)만 남긴다.
  fun makeCut(src: Bitmap, books: List<List<Double>>, ribbons: List<List<Double>>, boards: List<List<Double>>, file: File) {
    val w = src.width
    val h = src.height
    val mask = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val mc = Canvas(mask)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
    for (poly in books) {
      if (poly.size < 6) continue
      val path = Path()
      path.moveTo(poly[0].toFloat(), poly[1].toFloat())
      var i = 2
      while (i + 1 < poly.size) { path.lineTo(poly[i].toFloat(), poly[i + 1].toFloat()); i += 2 }
      path.close()
      mc.drawPath(path, fill)
    }
    val px = IntArray(w * h)
    src.getPixels(px, 0, w, 0, 0, w, h)
    val alpha = IntArray(w * h)
    mask.getPixels(alpha, 0, w, 0, 0, w, h)
    mask.recycle()
    val keep = ByteArray(w * h) // 색으로 고른 화소(가장자리를 한 화소 흐리게 하려고 따로)
    for (r in ribbons) {
      if (r.size < 4) continue
      val x0 = r[0].toInt().coerceIn(0, w); val y0 = r[1].toInt().coerceIn(0, h)
      val x1 = (r[0] + r[2]).toInt().coerceIn(0, w); val y1 = (r[1] + r[3]).toInt().coerceIn(0, h)
      for (y in y0 until y1) for (x in x0 until x1) if (colorful(px[y * w + x])) keep[y * w + x] = 1
    }
    for (b in boards) {
      if (b.size < 2) continue
      val y0 = b[0].toInt().coerceIn(0, h); val y1 = b[1].toInt().coerceIn(0, h)
      for (y in y0 until y1) for (x in 0 until w) if (woody(px[y * w + x])) keep[y * w + x] = 1
    }
    for (i in 0 until w * h) {
      var a = Color.alpha(alpha[i])
      if (keep[i].toInt() == 1) {
        // 이웃 넷 중 고른 화소 비율로 가장자리 부드럽게
        val x = i % w; val y = i / w
        var n = 1; var k = 1
        if (x > 0) { n++; k += keep[i - 1] }
        if (x < w - 1) { n++; k += keep[i + 1] }
        if (y > 0) { n++; k += keep[i - w] }
        if (y < h - 1) { n++; k += keep[i + w] }
        a = max(a, 255 * k / n)
      }
      px[i] = (a shl 24) or (px[i] and 0xFFFFFF)
    }
    val out = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { out.compress(Bitmap.CompressFormat.PNG, 100, it) }
    out.recycle()
  }

  private fun hsv(c: Int): FloatArray { val v = FloatArray(3); Color.colorToHSV(c, v); return v }
  // 갈피: 벽(흰·회색, 책 색이 조금 번진 정도)보다 뚜렷한 색
  private fun colorful(c: Int): Boolean { val v = hsv(c); return v[1] > 0.16f && v[2] > 0.25f }
  // 판: 노란 주황 색조의 나무 색(밝은 앞면부터 책 그늘이 진 윗면까지)
  private fun woody(c: Int): Boolean { val v = hsv(c); return v[0] in 18f..52f && v[1] > 0.12f && v[2] > 0.35f }

  // 그림 위쪽에서 벽 색만 있는 줄 수(책장 구멍 위 끝까지). 가운데 90%를 8px 간격으로 본다
  private fun wallRows(img: Bitmap, wall: Int, limit: Int): Int {
    val x0 = (img.width * 0.05f).toInt()
    val x1 = (img.width * 0.95f).toInt()
    for (y in 0 until min(limit, img.height)) {
      var x = x0
      while (x < x1) {
        if (differs(img.getPixel(x, y), wall)) return (y - 2).coerceAtLeast(0)
        x += 8
      }
    }
    return 0
  }
  // 왼쪽에서 벽 색만 있는 열 수(y 줄에서, 구멍 옆 벽 폭)
  private fun wallCols(img: Bitmap, wall: Int, y: Int): Int {
    val yy = y.coerceIn(0, img.height - 1)
    for (x in 0 until img.width / 4) if (differs(img.getPixel(x, yy), wall)) return x
    return 0
  }
  private fun differs(c: Int, wall: Int) = abs(Color.red(c) - Color.red(wall)) + abs(Color.green(c) - Color.green(wall)) + abs(Color.blue(c) - Color.blue(wall)) > 24

  // 불투명 화소가 있는 범위(없으면 null). 4px 간격으로 훑는다
  private fun opaqueBounds(img: Bitmap): Rect? {
    var l = img.width; var t = img.height; var r = -1; var b = -1
    var y = 0
    while (y < img.height) {
      var x = 0
      while (x < img.width) {
        if (Color.alpha(img.getPixel(x, y)) > 16) { l = min(l, x); r = max(r, x); t = min(t, y); b = max(b, y) }
        x += 4
      }
      y += 4
    }
    if (r < 0) return null
    return Rect(max(0, l - 4), max(0, t - 4), min(img.width, r + 5), min(img.height, b + 5))
  }
}
