package app.covebook.shelfwidget

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

// JS(ui/home-snapshot)가 홈이 가만히 있을 때 화면에 다 보이는 책장 칸을 한 장으로 떠서 알려 준다(2026-11-11 사용자 '1단 2단 3단 4단').
// 칸마다 잘라 row<칸>-<때>.jpg로, 투명 위젯용으로 오려 낸 것은 rowcut<칸>-<때>.png로 두고, 열쇠가 바뀐 칸은 버린 뒤 위젯을 다시 그린다
class ShelfWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShelfWidget")

    // 그리기(그림 읽기·오려 내기·자르기)는 모듈 작업 줄에서 한다(JS 줄을 막지 않게)
    // band: 칸마다 [칸 번호, 그림 안 위 px, 아래 px, 책장 콘텐츠 기준 위 끝 px], bandKeys: 그 칸들의 열쇠(Expo 함수 인자는 8개까지라 묶어 받는다)
    AsyncFunction("updateRows") { path: String?, band: List<List<Int>>, bandKeys: List<String>, keys: List<String>, books: List<List<Double>>, ribbons: List<List<Double>>, boards: List<List<Double>> ->
      val ctx = appContext.reactContext?.applicationContext ?: return@AsyncFunction 0
      if (path != null) {
        val file = File(if (path.startsWith("file://")) path.removePrefix("file://") else path)
        try {
          val src = BitmapFactory.decodeFile(file.path)
          if (src != null) {
            val cut = ShelfWidgetRenderer.cutOf(src, books, ribbons, boards)
            val stamp = file.name.removePrefix("band-").removeSuffix(".jpg")
            for ((k, r) in band.withIndex()) {
              if (r.size < 4 || k >= bandKeys.size) continue
              val index = r[0]
              val a = r[1].coerceIn(0, src.height - 1)
              val b = r[2].coerceIn(a + 1, src.height)
              val jpg = File(file.parentFile, "row$index-$stamp.jpg")
              val png = File(file.parentFile, "rowcut$index-$stamp.png")
              write(Bitmap.createBitmap(src, 0, a, src.width, b - a), jpg, Bitmap.CompressFormat.JPEG, 92)
              write(Bitmap.createBitmap(cut, 0, a, cut.width, b - a), png, Bitmap.CompressFormat.PNG, 100)
              ShelfWidgetProvider.saveRow(ctx, index, jpg.path, png.path, bandKeys[k], r[3], b - a)
            }
            cut.recycle()
            src.recycle()
          }
        } catch (e: Exception) {
          Log.w("ShelfWidget", "rows failed", e)
        }
        file.delete()
      }
      ShelfWidgetProvider.keepRows(ctx, keys)
      ShelfWidgetProvider.updateAll(ctx)
    }
  }

  private fun write(b: Bitmap, f: File, fmt: Bitmap.CompressFormat, q: Int) {
    FileOutputStream(f).use { b.compress(fmt, q, it) }
    b.recycle()
  }
}
