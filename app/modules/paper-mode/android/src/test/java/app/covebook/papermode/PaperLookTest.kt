package app.covebook.papermode

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sqrt

// 오버레이 합성(창 alpha × 그림 알파로 보통 알파 합성)을 화면에서 일어나는 그대로 계산해, 색감·종이 결의 약속을 확인한다
class PaperLookTest {
  // 화소 p(미리 곱하지 않은 ARGB)를 창 불투명도 win으로 아래 색 under(sRGB 0~255) 위에 합성
  private fun over(under: IntArray, p: Int, win: Float): DoubleArray {
    val a = win * ((p ushr 24) and 0xFF) / 255.0
    val c = intArrayOf((p shr 16) and 0xFF, (p shr 8) and 0xFF, p and 0xFF)
    return DoubleArray(3) { (1 - a) * under[it] + a * c[it] }
  }

  private fun lin(v: Double): Double { val s = v / 255; return if (s <= 0.04045) s / 12.92 else ((s + 0.055) / 1.055).pow(2.4) }
  private fun lum(c: DoubleArray) = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  private fun contrast(a: DoubleArray, b: DoubleArray): Double { val x = lum(a); val y = lum(b); return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05) }

  // 결 잡음 값 n(0~255) 하나로 된 화소
  private fun pixel(s: PaperSettings, n: Int, maxWin: Float = 0.8f): Pair<Int, Float> {
    val t = PaperLook.tint(s)
    val wanted = PaperLook.windowAlpha(s)
    val win = minOf(wanted, maxWin * 0.98f)
    val row = IntArray(1)
    PaperLook.fillRow(s, t, byteArrayOf(n.toByte()), 0, 1, win, win / wanted, row)
    return row[0] to win
  }

  private val white = intArrayOf(255, 255, 255)
  private val black = intArrayOf(0, 0, 0)
  private val gray = intArrayOf(0x75, 0x75, 0x75)

  @Test fun `색감 100%에서 흰 종이는 팔레트 색이 된다`() {
    for ((pal, want) in listOf(PaperSettings.BRIGHT to intArrayOf(252, 249, 241), PaperSettings.WARM to intArrayOf(251, 245, 232))) {
      val (p, win) = pixel(PaperSettings(pal, 1f, 0f), 0)
      val out = over(white, p, win)
      for (i in 0..2) assertEquals("$pal ch$i", want[i].toDouble(), out[i], 1.0)
    }
  }

  @Test fun `최대 강도에서도 검은 글자는 회색으로 뜨지 않고 회색 보조 글자 대비가 86% 이상 남는다`() {
    for (pal in listOf(PaperSettings.BRIGHT, PaperSettings.WARM)) for (n in listOf(0, 255)) {
      val (p, win) = pixel(PaperSettings(pal, 1f, 1f), n)
      val k = over(black, p, win)
      val w = over(white, p, win)
      val g = over(gray, p, win)
      assertTrue("$pal n=$n 검정 ${k.toList()}", k.max() <= 24.0 && lum(k) < 0.008)
      assertTrue("$pal n=$n 검정/흰 대비 ${contrast(k, w)}", contrast(k, w) >= 16.0)
      val orig = contrast(gray.map { it.toDouble() }.toDoubleArray(), white.map { it.toDouble() }.toDoubleArray())
      assertTrue("$pal n=$n 회색 대비 ${contrast(g, w) / orig}", contrast(g, w) / orig >= 0.86)
    }
  }

  @Test fun `종이 결은 검정을 얹어 밝은 바탕만 어둡게 한다(검정은 그대로)`() {
    val s = PaperSettings(PaperSettings.BRIGHT, 0f, 1f)
    val (p, win) = pixel(s, 255)
    assertEquals(0, p and 0xFFFFFF)
    assertEquals(0.0, over(black, p, win).max(), 1e-9)
    val dark = 255 - over(white, p, win)[1]
    assertEquals(PaperLook.G_MAX * 255.0, dark, 0.6)
  }

  @Test fun `창 불투명도는 효과의 가장 큰 불투명도이고 시스템 최대 가림 불투명도를 넘지 않는다`() {
    val s = PaperSettings(PaperSettings.WARM, 1f, 1f)
    assertTrue(PaperLook.windowAlpha(s) < 0.15f)
    // 가장 진한 화소의 그림 알파는 255(창 alpha가 효과 전체를 맡는다)
    val (p, _) = pixel(s, 255)
    assertEquals(255, p ushr 24)
    // 기기가 최대 가림 불투명도를 아주 낮게 두면 그 아래로 줄인다
    val (q, win) = pixel(s, 255, maxWin = 0.05f)
    assertTrue(win <= 0.05f * 0.98f + 1e-6f)
    assertTrue(q ushr 24 <= 255)
  }

  @Test fun `기본값(밝은 종이 60%, 결 35%)은 회색 보조 글자 대비를 95% 가까이 지킨다`() {
    val orig = contrast(gray.map { it.toDouble() }.toDoubleArray(), white.map { it.toDouble() }.toDoubleArray())
    for (n in listOf(0, 255)) {
      val (p, win) = pixel(PaperSettings.DEFAULT, n)
      assertTrue("n=$n", contrast(over(gray, p, win), over(white, p, win)) / orig >= 0.945)
    }
  }

  @Test fun `색감 0·결 0이면 아무것도 얹지 않는다`() {
    assertEquals(0f, PaperLook.windowAlpha(PaperSettings(PaperSettings.WARM, 0f, 0f)), 0f)
  }

  @Test fun `결 잡음 — 고정 시드라 같은 크기면 같고, 0~255를 쓰고, 줄무늬(행·열 평균 치우침)가 없다`() {
    val w = 360
    val h = 480
    val a = PaperNoise.make(w, h, 2.625f)
    val b = PaperNoise.make(w, h, 2.625f)
    assertArrayEquals(a, b)
    val v = a.map { (it.toInt() and 0xFF).toDouble() }
    assertEquals(0.0, v.min(), 0.0)
    assertEquals(255.0, v.max(), 0.0)
    val mean = v.average()
    val sd = sqrt(v.sumOf { (it - mean) * (it - mean) } / v.size)
    val cols = DoubleArray(w) { x -> (0 until h).sumOf { y -> v[y * w + x] } / h }
    val rows = DoubleArray(h) { y -> (0 until w).sumOf { x -> v[y * w + x] } / w }
    fun spread(m: DoubleArray): Double { val mm = m.average(); return sqrt(m.sumOf { (it - mm) * (it - mm) } / m.size) }
    assertTrue("열 평균 퍼짐 ${spread(cols)} / 화소 ${sd}", spread(cols) < 0.12 * sd)
    assertTrue("행 평균 퍼짐 ${spread(rows)} / 화소 ${sd}", spread(rows) < 0.12 * sd)
    // 대부분은 옅다(제곱 분포): 평균이 가운데(127)보다 아래
    assertTrue("평균 $mean", mean < 110)
    // 타일 반복이 없다: 한 덩이를 옆으로 옮긴 자리와 같지 않다
    for (dx in listOf(32, 64, 128, 256)) {
      var same = 0
      for (y in 0 until 64) for (x in 0 until 64) if (a[y * w + x] == a[y * w + x + dx]) same++
      assertTrue("dx=$dx 같은 화소 $same", same < 64 * 64 / 8)
    }
    assertTrue(abs(mean - v.average()) < 1e-9)
  }
}
