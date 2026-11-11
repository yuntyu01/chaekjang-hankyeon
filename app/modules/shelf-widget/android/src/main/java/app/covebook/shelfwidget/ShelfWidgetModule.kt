package app.covebook.shelfwidget

import android.graphics.BitmapFactory
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// JS(ui/home-snapshot)가 홈이 가만히 있을 때 책장 한두 칸을 떠서 알려 준다. 투명 위젯 그림(cut-<같은 때>.png)도 여기서 오려 낸 뒤 위젯을 다시 그린다
class ShelfWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShelfWidget")

    // 그리기(그림 읽기·오려 내기·합치기)는 모듈 작업 줄에서 한다(JS 줄을 막지 않게)
    AsyncFunction("update") { path: String, bottoms: List<Int>, year: Int, books: List<List<Double>>, ribbons: List<List<Double>>, boards: List<List<Double>> ->
      val ctx = appContext.reactContext?.applicationContext ?: return@AsyncFunction 0
      val file = File(if (path.startsWith("file://")) path.removePrefix("file://") else path)
      val cutFile = File(file.parentFile, file.name.replace("shelf-", "cut-").replace(".jpg", ".png"))
      val cut = try {
        val src = BitmapFactory.decodeFile(file.path)
        if (src != null) {
          ShelfWidgetRenderer.makeCut(src, books, ribbons, boards, cutFile)
          src.recycle()
          cutFile.path
        } else null
      } catch (e: Exception) {
        Log.w("ShelfWidget", "cut failed", e)
        null
      }
      ShelfWidgetProvider.save(ctx, file.path, cut, bottoms, year)
      ShelfWidgetProvider.updateAll(ctx)
    }
  }
}
