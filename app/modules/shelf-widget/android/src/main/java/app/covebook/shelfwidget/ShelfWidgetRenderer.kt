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
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// 위젯 그림 세 가지(2026-11-11 사용자):
// - 꽉 찬 위젯: 글자 없이 책장 구멍(틀 포함)이 위젯을 채운다. 카드 바탕은 책장 벽 색이라 남는 자리는 벽처럼 보인다.
// - 벽 없는 위젯: 구멍 가장자리(벽이 시작하는 곳)가 곧 위젯 경계. 구멍 밖 평평한 벽은 그리지 않는다('저 벽이 그 경계선인 걸로').
// - 투명 위젯: 선반 판과 책만(벽·틀은 투명). 앱이 넘긴 모양(책·판 외곽, 갈피 띠)으로 홈 사진을 오려 낸 PNG를 쓴다.
// 칸 그림은 칸마다 따로 떠 둔 것(ShelfWidgetModule)을 위에서부터 이어 붙인다(최대 4칸).
// 보일 칸 수는 위젯을 가장 넓게 채우는 쪽: 위젯 모양(가로세로 비율)을 따른다(넓으면 1단, 정사각형에 가까우면 2단, 좁고 길면 3·4단).
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

  private fun load(path: String?) = path?.let { p -> if (File(p).exists()) runCatching { BitmapFactory.decodeFile(p) }.getOrNull() else null }

  // 떠 둔 칸을 위에서부터 이어 붙인 그림과 칸마다 아래 끝(그림 px). cut이면 투명 위젯용으로 오려 낸 칸들
  private fun stitched(context: Context, cut: Boolean): Pair<Bitmap, List<Int>>? {
    val rows = ShelfWidgetProvider.rows(context)
    if (rows.isEmpty()) return null
    val top0 = rows[0].top
    val bottoms = rows.map { it.top + it.height - top0 }
    var out: Bitmap? = null
    var canvas: Canvas? = null
    for (r in rows) {
      val b = load(if (cut) r.cut else r.path)
      if (b == null) { out?.recycle(); return null }
      if (out == null) {
        out = Bitmap.createBitmap(b.width, bottoms.last(), Bitmap.Config.ARGB_8888)
        canvas = Canvas(out)
      }
      canvas!!.drawBitmap(b, 0f, (r.top - top0).toFloat(), null)
      b.recycle()
    }
    return out?.let { it to bottoms }
  }

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
    val (shelf, bottoms) = stitched(context, false) ?: (null to emptyList())
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

  // 벽 없는 위젯: 구멍 위 끝·옆 끝(벽 색이 끝나는 곳)부터 선반 한두 칸 아래 끝까지만 옮긴다. 남는 자리는 투명
  fun renderNiche(context: Context, wDp: Int, hDp: Int): Bitmap {
    val out = bitmapFor(context, wDp, hDp)
    val canvas = Canvas(out)
    val W = out.width.toFloat()
    val H = out.height.toFloat()
    val (shelf, bottoms) = stitched(context, false) ?: (null to emptyList())
    if (shelf == null || bottoms.isEmpty()) { hint(canvas, W, H); return out }
    val wall = shelf.getPixel(shelf.width / 2, 1)
    // wallRows는 벽 2줄을 남기고 돌려준다: 구멍 첫 줄부터
    val top = min(wallRows(shelf, wall, bottoms.first()) + 2, bottoms.first() - 1)
    val mid = top + (bottoms.first() - top) / 2
    val left = wallCols(shelf, wall, mid)
    val right = shelf.width - wallColsRight(shelf, wall, mid)
    val boxes = bottoms.map { b -> RectF(left.toFloat(), top.toFloat(), right.toFloat(), min(b, shelf.height).toFloat()) }
    val (src, dst) = place(W, H, boxes) ?: return out
    canvas.drawBitmap(shelf, Rect(src.left.toInt(), src.top.toInt(), src.right.toInt(), src.bottom.toInt()), dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    shelf.recycle()
    return out
  }

  fun renderCut(context: Context, wDp: Int, hDp: Int): Bitmap {
    val out = bitmapFor(context, wDp, hDp)
    val canvas = Canvas(out)
    val W = out.width.toFloat()
    val H = out.height.toFloat()
    val (cut, bottoms) = stitched(context, true) ?: (null to emptyList())
    if (cut == null || bottoms.isEmpty()) { hint(canvas, W, H); return out }
    // 내용(불투명 화소)이 있는 범위만: 위 끝·왼쪽·오른쪽은 오려 낸 그림에서 잰다
    val bounds = opaqueBounds(cut) ?: return out
    val boxes = bottoms.map { b -> RectF(bounds.left.toFloat(), bounds.top.toFloat(), bounds.right.toFloat(), min(b, cut.height).toFloat()) }
    val (src, dst) = place(W, H, boxes) ?: return out
    canvas.drawBitmap(cut, Rect(src.left.toInt(), src.top.toInt(), src.right.toInt(), src.bottom.toInt()), dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    cut.recycle()
    return out
  }

  // 홈 사진에서 책·갈피·선반 판만 남기고 나머지를 투명하게(PNG). 책과 판은 외곽 다각형 그대로(가장자리 부드럽게),
  // 갈피 띠 안에서는 색이 있는 화소(벽은 흰·회색)만 남긴다.
  // 판을 나무 색 화소로 고르면 윗면·앞면 사이 어두운 모서리 줄이 빠져 판이 갈라져 보였다(2026-11-11 사용자): 판도 앱이 그린 윤곽으로 오린다
  fun cutOf(src: Bitmap, books: List<List<Double>>, ribbons: List<List<Double>>, boards: List<List<Double>>): Bitmap {
    val w = src.width
    val h = src.height
    val mask = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val mc = Canvas(mask)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
    for (poly in books + boards) {
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
    return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
  }

  private fun hsv(c: Int): FloatArray { val v = FloatArray(3); Color.colorToHSV(c, v); return v }
  // 갈피: 벽(흰·회색, 책 색이 조금 번진 정도)보다 뚜렷한 색
  private fun colorful(c: Int): Boolean { val v = hsv(c); return v[1] > 0.16f && v[2] > 0.25f }

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
  // 오른쪽에서 벽 색만 있는 열 수
  private fun wallColsRight(img: Bitmap, wall: Int, y: Int): Int {
    val yy = y.coerceIn(0, img.height - 1)
    for (i in 0 until img.width / 4) if (differs(img.getPixel(img.width - 1 - i, yy), wall)) return i
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
