package app.covebook.shelfwidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS(ui/home-snapshot)가 홈이 가만히 있을 때 책장 한두 칸을 떠서 알려 준다. 위젯은 그 그림으로 다시 그린다
class ShelfWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShelfWidget")

    // 그리기(그림 읽기·합치기)는 모듈 작업 줄에서 한다(JS 줄을 막지 않게)
    AsyncFunction("update") { path: String, bottoms: List<Int>, year: Int ->
      val ctx = appContext.reactContext?.applicationContext ?: return@AsyncFunction 0
      ShelfWidgetProvider.save(ctx, path, bottoms, year)
      ShelfWidgetProvider.updateAll(ctx)
    }
  }
}
