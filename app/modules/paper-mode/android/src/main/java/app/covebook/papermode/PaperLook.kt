package app.covebook.papermode

import android.content.Context
import android.graphics.Bitmap
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

// 종이 모드의 모양: 사용자가 고른 값(팔레트·색감·종이 결)과, 그것을 한 장의 오버레이 그림 + 창 불투명도로 바꾸는 합성.
//
// 오버레이 창은 아래 화면과 보통 알파 합성(out = (1 − α)·아래 + α·색)만 할 수 있다(다른 앱 화면을 곱하거나 읽을 수 없다).
// - 색감: 흰 종이가 팔레트의 '가장 진한 종이 색'(white)이 되도록 색 C를 α_t만큼 얹는다. 같은 흰 종이 색을 내는 C 중에서
//   검정이 가장 적게 들뜨는 것은 가장 많이 바뀌는 채널(파랑)을 0으로 둔 C다(검정 → α_t·C). 그래서 검은 글자는 회색이 아니라
//   아주 짙은 갈색 쪽으로 몇 단계만 뜬다. 상한(white)은 회색 보조 글자(#757575)의 대비가 원래의 88% 이상 남는 데까지(가장 진한 결 화소까지 더해도 86% 이상, 기본값은 95%).
// - 종이 결: 검정을 α_g = 결 세기 × G_MAX × n(점마다 고정된 잡음 0~1)만큼 얹는다. 검정을 얹으면 아래 색에 (1 − α_g)를 곱하는 것과 같아,
//   밝은 바탕에서만 결이 보이고 검은 글자는 그대로다(종이 반사율 무늬와 같은 성질).
// - 한 화소의 합: α = α_t + α_g − α_t·α_g, 미리 곱한 색 = α_t·(1 − α_g)·C.
// 창 불투명도(WindowManager.LayoutParams.alpha)는 그림 전체에서 가장 큰 α이고, 그림의 알파는 α / 창 불투명도다.
// 이렇게 해야 Android 12+의 터치 통과 판정(창 alpha 기준, 최대 가림 불투명도 이하)이 실제로 보이는 효과와 맞고, 8비트 알파의 단계도 촘촘하다.
data class PaperSettings(val palette: String, val tint: Float, val grain: Float) {
  companion object {
    const val BRIGHT = "bright"
    const val WARM = "warm"
    val DEFAULT = PaperSettings(BRIGHT, 0.6f, 0.35f)

    fun of(palette: String?, tint: Double?, grain: Double?): PaperSettings = PaperSettings(
      if (palette == WARM) WARM else BRIGHT,
      ((tint ?: DEFAULT.tint.toDouble()).coerceIn(0.0, 1.0)).toFloat(),
      ((grain ?: DEFAULT.grain.toDouble()).coerceIn(0.0, 1.0)).toFloat(),
    )

    private const val PREFS = "paper_mode"

    fun load(context: Context): PaperSettings {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return PaperSettings(
        if (p.getString("palette", BRIGHT) == WARM) WARM else BRIGHT,
        p.getFloat("tint", DEFAULT.tint).coerceIn(0f, 1f),
        p.getFloat("grain", DEFAULT.grain).coerceIn(0f, 1f),
      )
    }
  }

  // 켜져 있는지는 저장하지 않는다: 재부팅·강제 종료 뒤에 사용자 뜻 없이 다시 켜지지 않게
  fun save(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("palette", palette).putFloat("tint", tint).putFloat("grain", grain).apply()
  }
}

object PaperLook {
  // 팔레트: 색감 100%에서 흰 종이가 되는 색(sRGB). 밝은 종이 = 아주 옅은 아이보리, 따뜻한 종이 = 조금 더 크림 쪽(누렇게 바래지 않게)
  private val WHITE = mapOf(
    PaperSettings.BRIGHT to intArrayOf(252, 249, 241),
    PaperSettings.WARM to intArrayOf(251, 245, 232),
  )
  // 종이 결 100%에서 가장 진한 결이 밝은 바탕을 어둡게 하는 몫(3.5% ≈ 9단계, 평균은 그 절반 아래)
  const val G_MAX = 0.035f

  class Tint(val alpha: Float, val r: Int, val g: Int, val b: Int)

  // 색감 t(0~1)의 α_t와 색 C(가장 많이 바뀌는 채널 = 0)
  fun tint(s: PaperSettings): Tint {
    val w = WHITE[s.palette] ?: WHITE.getValue(PaperSettings.BRIGHT)
    val d = IntArray(3) { 255 - w[it] }
    val aMax = d.max() / 255f
    val c = IntArray(3) { if (d[it] == 0) 255 else (255 - d[it] / aMax).roundToInt().coerceIn(0, 255) }
    return Tint(aMax * s.tint, c[0], c[1], c[2])
  }

  // 창 불투명도 = 가장 진한 화소의 α(결 잡음의 최댓값은 1로 맞춘다)
  fun windowAlpha(s: PaperSettings): Float {
    val at = tint(s).alpha
    val ag = s.grain * G_MAX
    return at + ag - at * ag
  }

  // 오버레이 그림을 채운다. noise: 화소마다 0~255(PaperNoise), 크기 w×h. 반환: 창(또는 미리보기 칠하기)의 불투명도
  fun compose(s: PaperSettings, noise: ByteArray, w: Int, h: Int, out: Bitmap, maxWindowAlpha: Float): Compose {
    val t = tint(s)
    val wanted = windowAlpha(s)
    if (wanted <= 1e-4f) {
      out.eraseColor(0)
      return Compose(0f, false)
    }
    // 시스템의 최대 가림 불투명도(Android 12+, 기본 0.8)를 넘으면 그 아래로 줄인다(효과가 약해진 것을 알린다)
    val win = min(wanted, maxWindowAlpha * 0.98f)
    val limited = win < wanted
    val scale = win / wanted // 제한될 때 모든 화소를 같은 비율로
    val row = IntArray(w)
    for (y in 0 until h) {
      fillRow(s, t, noise, y * w, w, win, scale, row)
      out.setPixels(row, 0, w, 0, y, w, 1)
    }
    return Compose(win, limited)
  }

  // 한 줄의 화소(미리 곱하지 않은 ARGB). 그림 알파 = 화소 α / 창 불투명도 win, scale: 시스템 제한으로 줄인 비율
  fun fillRow(s: PaperSettings, t: Tint, noise: ByteArray, offset: Int, w: Int, win: Float, scale: Float, row: IntArray) {
    val ag = s.grain * G_MAX
    for (x in 0 until w) {
      val n = (noise[offset + x].toInt() and 0xFF) / 255f
      val g = ag * n
      val a = t.alpha + g - t.alpha * g
      if (a <= 0f) {
        row[x] = 0
        continue
      }
      // 색(미리 곱하지 않은 값) = α_t·(1 − α_g)·C / α
      val k = t.alpha * (1f - g) / a
      val alpha = ((a * scale / win) * 255f).roundToInt().coerceIn(0, 255)
      row[x] = (alpha shl 24) or ((t.r * k).roundToInt() shl 16) or ((t.g * k).roundToInt() shl 8) or (t.b * k).roundToInt()
    }
  }

  class Compose(val windowAlpha: Float, val limited: Boolean)
}

// 정적인 종이 결 잡음(0~255). 화면 크기 그대로 한 장을 만들어 타일 반복·이음새가 없다. 같은 크기·밀도면 늘 같은 무늬(고정 시드).
// 크기는 dp로 정해 기기 밀도가 달라도 같은 물리 크기: 고운 결(약 0.5mm)과 아주 옅은 굵은 결(약 1.5mm), 화소 단위 잡음 조금.
// 격자 축을 비스듬히 돌려 가로·세로 줄무늬가 생기지 않게 한다. 얼룩·비네팅·섬유 가닥은 넣지 않는다.
object PaperNoise {
  private var cacheKey = ""
  private var cache: ByteArray? = null

  @Synchronized
  fun field(w: Int, h: Int, density: Float): ByteArray {
    val key = "$w×$h@$density"
    cache?.let { if (cacheKey == key) return it }
    val out = make(w, h, density)
    cache = out
    cacheKey = key
    return out
  }

  private fun hash(ix: Int, iy: Int, seed: Int): Float {
    var h = ix * 374761393 + iy * 668265263 + seed * 1442695041
    h = (h xor (h ushr 13)) * 1274126177
    h = h xor (h ushr 16)
    return (h and 0xFFFFFF) / 16777215f * 2f - 1f
  }

  private fun smooth(t: Float) = t * t * (3f - 2f * t)

  // 값 잡음(-1~1): 격자 크기 cell(px), 축을 angle만큼 돌린다
  private fun value(x: Float, y: Float, cell: Float, angle: Float, seed: Int): Float {
    val ca = cos(angle)
    val sa = sin(angle)
    val u = (x * ca - y * sa) / cell
    val v = (x * sa + y * ca) / cell
    val iu = floor(u).toInt()
    val iv = floor(v).toInt()
    val fu = smooth(u - iu)
    val fv = smooth(v - iv)
    val a = hash(iu, iv, seed)
    val b = hash(iu + 1, iv, seed)
    val c = hash(iu, iv + 1, seed)
    val d = hash(iu + 1, iv + 1, seed)
    return (a + (b - a) * fu) + ((c + (d - c) * fu) - (a + (b - a) * fu)) * fv
  }

  internal fun make(w: Int, h: Int, density: Float): ByteArray {
    val fine = 1.2f * density // 고운 결
    val coarse = 3.6f * density // 아주 옅은 굵은 결
    val raw = FloatArray(w * h)
    var lo = Float.MAX_VALUE
    var hi = -Float.MAX_VALUE
    for (y in 0 until h) {
      for (x in 0 until w) {
        val fx = x.toFloat()
        val fy = y.toFloat()
        val v = 0.62f * value(fx, fy, fine, 0.61f, 11) +
          0.26f * value(fx, fy, coarse, 1.07f, 23) +
          0.12f * hash(x, y, 37)
        raw[y * w + x] = v
        lo = min(lo, v)
        hi = max(hi, v)
      }
    }
    // 0~1로 펴되 위쪽 끝(가장 진한 결)은 드물게: 제곱해 대부분은 옅고 조금만 진하다(결이 바탕 전체를 눈에 띄게 어둡게 하지 않는다)
    val span = max(1e-6f, hi - lo)
    val out = ByteArray(w * h)
    for (i in raw.indices) {
      val n = (raw[i] - lo) / span
      out[i] = (n * n * 255f).roundToInt().coerceIn(0, 255).toByte()
    }
    return out
  }
}
