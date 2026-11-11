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

// 홈 화면 위젯 '나의 책장'(2026-11-11 사용자 시안): 둥근 카드 위 왼쪽 '나의 책장', 오른쪽 해, 아래 책장 한 칸(4×2) 또는 두 칸(세로로 늘리면).
// 그림은 앱이 홈을 찍을 때 함께 떠 둔 책장(ShelfWidgetModule.update)이고, 위젯 크기가 바뀌면 그 크기에 맞춰 다시 그린다. 누르면 앱이 열린다.
class ShelfWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) draw(context, manager, id)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    draw(context, manager, id)
  }

  companion object {
    private const val TAG = "ShelfWidget"
    internal const val PREFS = "shelf_widget"

    fun save(context: Context, path: String, bottoms: List<Int>, year: Int) {
      val file = if (path.startsWith("file://")) path.removePrefix("file://") else path
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("path", file)
        .putString("bottoms", bottoms.joinToString(","))
        .putInt("year", year)
        .putLong("at", System.currentTimeMillis())
        .apply()
    }

    // 놓인 위젯을 모두 다시 그린다(놓인 수)
    fun updateAll(context: Context): Int {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ShelfWidgetProvider::class.java))
      for (id in ids) draw(context, manager, id)
      return ids.size
    }

    private fun draw(context: Context, manager: AppWidgetManager, id: Int) {
      try {
        val views = RemoteViews(context.packageName, R.layout.shelf_widget)
        // 세로 화면 기준 크기: 폭은 가장 좁을 때, 높이는 가장 높을 때(런처가 알려 준 dp)
        val o = manager.getAppWidgetOptions(id)
        val wDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 } ?: 250
        val hDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT).takeIf { it > 0 } ?: 110
        val bitmap = ShelfWidgetRenderer.render(context, wDp, hDp)
        views.setImageViewBitmap(R.id.shelf_widget_image, bitmap)
        val year = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("year", java.util.Calendar.getInstance().get(java.util.Calendar.YEAR))
        views.setContentDescription(R.id.shelf_widget_image, "${context.getString(R.string.shelf_widget_label)}, $year")
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
          launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
          val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
          views.setOnClickPendingIntent(android.R.id.background, pending)
          views.setOnClickPendingIntent(R.id.shelf_widget_image, pending)
        }
        manager.updateAppWidget(id, views)
      } catch (e: Exception) {
        Log.w(TAG, "draw failed", e)
      }
    }
  }
}
