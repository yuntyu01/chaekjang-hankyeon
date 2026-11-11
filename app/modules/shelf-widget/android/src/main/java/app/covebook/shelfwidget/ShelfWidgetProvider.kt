package app.covebook.shelfwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.RemoteViews

// 홈 화면 위젯 두 가지(2026-11-11 사용자 시안·요청). 그림은 앱이 홈을 찍을 때 함께 떠 둔 책장(ShelfWidgetModule.update)이고,
// 위젯 크기가 바뀌면 그 크기에 맞춰 다시 그린다. 누르면 앱이 열린다.
// - ShelfWidgetProvider '나의 책장': 글자 없이 책장(틀 포함)이 위젯을 채운다
// - ShelfCutWidgetProvider '나의 책장(투명)': 선반 판과 책만, 나머지는 투명
open class ShelfWidgetBase(private val cut: Boolean) : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) ShelfWidgetProvider.draw(context, manager, id, cut)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    ShelfWidgetProvider.draw(context, manager, id, cut)
  }
}

class ShelfWidgetProvider : ShelfWidgetBase(false) {
  companion object {
    private const val TAG = "ShelfWidget"
    internal const val PREFS = "shelf_widget"

    fun save(context: Context, path: String, cutPath: String?, bottoms: List<Int>, year: Int) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("path", path)
        .putString("cut", cutPath)
        .putString("bottoms", bottoms.joinToString(","))
        .putInt("year", year)
        .putLong("at", System.currentTimeMillis())
        .apply()
    }

    // 놓인 위젯(두 가지 모두)을 다시 그린다(놓인 수)
    fun updateAll(context: Context): Int {
      val manager = AppWidgetManager.getInstance(context)
      var n = 0
      for ((cls, cut) in listOf(ShelfWidgetProvider::class.java to false, ShelfCutWidgetProvider::class.java to true)) {
        val ids = manager.getAppWidgetIds(ComponentName(context, cls))
        for (id in ids) draw(context, manager, id, cut)
        n += ids.size
      }
      return n
    }

    internal fun draw(context: Context, manager: AppWidgetManager, id: Int, cut: Boolean) {
      try {
        val views = RemoteViews(context.packageName, if (cut) R.layout.shelf_widget_cut else R.layout.shelf_widget)
        // 세로 화면 기준 크기: 폭은 가장 좁을 때, 높이는 가장 높을 때(런처가 알려 준 dp)
        val o = manager.getAppWidgetOptions(id)
        val wDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 } ?: 250
        val hDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT).takeIf { it > 0 } ?: 110
        val bitmap = if (cut) ShelfWidgetRenderer.renderCut(context, wDp, hDp) else ShelfWidgetRenderer.renderFill(context, wDp, hDp)
        views.setImageViewBitmap(R.id.shelf_widget_image, bitmap)
        val year = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("year", java.util.Calendar.getInstance().get(java.util.Calendar.YEAR))
        views.setContentDescription(R.id.shelf_widget_image, "${context.getString(R.string.shelf_widget_label)}, $year")
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
          launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
          val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
          views.setOnClickPendingIntent(R.id.shelf_widget_image, pending)
        }
        manager.updateAppWidget(id, views)
      } catch (e: Exception) {
        Log.w(TAG, "draw failed", e)
      }
    }
  }
}

class ShelfCutWidgetProvider : ShelfWidgetBase(true)
