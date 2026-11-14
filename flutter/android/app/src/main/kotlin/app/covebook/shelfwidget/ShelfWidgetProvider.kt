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
import java.io.File

import app.covebook.chaekjang.R

// 홈 화면 위젯 세 가지(지금 앱 modules/shelf-widget을 그대로 옮김, 클래스 이름도 같다). 그림은 앱이 홈 책장 그림에서 떠 둔 칸(ShelfWidgetChannel.updateRows)이고,
// 위젯 크기가 바뀌면 그 크기에 맞춰 다시 그린다. 누르면 앱이 열린다.
// - ShelfWidgetProvider '나의 책장': 글자 없이 책장(틀 포함)이 위젯을 채운다
// - ShelfNicheWidgetProvider '나의 책장(벽 없이)': 구멍 가장자리가 위젯 경계, 구멍 밖 벽은 없다(투명)
// - ShelfCutWidgetProvider '나의 책장(투명)': 선반 판과 책만, 나머지는 투명
enum class ShelfWidgetKind { FILL, NICHE, CUT }

open class ShelfWidgetBase(private val kind: ShelfWidgetKind) : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) ShelfWidgetProvider.draw(context, manager, id, kind)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    ShelfWidgetProvider.draw(context, manager, id, kind)
  }
}

class ShelfWidgetProvider : ShelfWidgetBase(ShelfWidgetKind.FILL) {
  companion object {
    private const val TAG = "ShelfWidget"
    internal const val PREFS = "shelf_widget"

    const val MAX_ROWS = 4

    // 칸 하나(그림·오려 낸 그림·열쇠·책장 콘텐츠 기준 위 끝 px·높이 px)
    data class Row(val path: String, val cut: String, val key: String, val top: Int, val height: Int)

    fun saveRow(context: Context, index: Int, path: String, cutPath: String, key: String, top: Int, height: Int) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("row$index", listOf(path, cutPath, key, top, height).joinToString("|"))
        .putLong("at", System.currentTimeMillis())
        .apply()
    }

    // 지금 책장 칸의 열쇠(keys)와 다른 칸, 칸 수보다 아래 칸은 버린다. 남은 칸이 쓰지 않는 파일도 지운다(뜨는 중인 band-…는 두고)
    fun keepRows(context: Context, keys: List<String>) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val edit = prefs.edit()
      // 예전 판(두 칸 한 장) 값은 버린다
      edit.remove("path").remove("cut").remove("bottoms").remove("year")
      val used = mutableSetOf<String>()
      for (i in 0 until MAX_ROWS) {
        val r = rowOf(prefs.getString("row$i", null))
        if (r == null || i >= keys.size || keys[i] != r.key) edit.remove("row$i")
        else { used += File(r.path).name; used += File(r.cut).name }
      }
      edit.commit()
      // 앱(Dart)이 쓰는 폴더(getApplicationSupportDirectory = filesDir)
      File(context.filesDir, "shelf-widget").listFiles()?.forEach { f -> if (f.name !in used && !f.name.startsWith("band-")) f.delete() }
    }

    // 위 칸부터 끊김 없이 이어진 칸들(파일이 있는 것만)
    fun rows(context: Context): List<Row> {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val out = mutableListOf<Row>()
      for (i in 0 until MAX_ROWS) {
        val r = rowOf(prefs.getString("row$i", null)) ?: break
        if (!File(r.path).exists() || !File(r.cut).exists()) break
        if (out.isNotEmpty() && kotlin.math.abs(r.top - (out.last().top + out.last().height)) > 8) break
        out += r
      }
      return out
    }

    private fun rowOf(v: String?): Row? {
      val p = v?.split("|") ?: return null
      if (p.size < 5) return null
      return Row(p[0], p[1], p[2], p[3].toIntOrNull() ?: return null, p[4].toIntOrNull() ?: return null)
    }

    // 놓인 위젯(세 가지 모두)을 다시 그린다(놓인 수)
    fun updateAll(context: Context): Int {
      val manager = AppWidgetManager.getInstance(context)
      var n = 0
      val all = listOf(ShelfWidgetProvider::class.java to ShelfWidgetKind.FILL, ShelfNicheWidgetProvider::class.java to ShelfWidgetKind.NICHE, ShelfCutWidgetProvider::class.java to ShelfWidgetKind.CUT)
      for ((cls, kind) in all) {
        val ids = manager.getAppWidgetIds(ComponentName(context, cls))
        for (id in ids) draw(context, manager, id, kind)
        n += ids.size
      }
      return n
    }

    internal fun draw(context: Context, manager: AppWidgetManager, id: Int, kind: ShelfWidgetKind) {
      try {
        // 꽉 찬 위젯만 시스템 바탕(둥근 모서리로 깎임), 나머지는 바탕 없는 틀
        val views = RemoteViews(context.packageName, if (kind == ShelfWidgetKind.FILL) R.layout.shelf_widget else R.layout.shelf_widget_cut)
        // 세로 화면 기준 크기: 폭은 가장 좁을 때, 높이는 가장 높을 때(런처가 알려 준 dp)
        val o = manager.getAppWidgetOptions(id)
        val wDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 } ?: 250
        val hDp = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT).takeIf { it > 0 } ?: 110
        val bitmap = when (kind) {
          ShelfWidgetKind.FILL -> ShelfWidgetRenderer.renderFill(context, wDp, hDp)
          ShelfWidgetKind.NICHE -> ShelfWidgetRenderer.renderNiche(context, wDp, hDp)
          ShelfWidgetKind.CUT -> ShelfWidgetRenderer.renderCut(context, wDp, hDp)
        }
        views.setImageViewBitmap(R.id.shelf_widget_image, bitmap)
        val year = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)
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

class ShelfNicheWidgetProvider : ShelfWidgetBase(ShelfWidgetKind.NICHE)

class ShelfCutWidgetProvider : ShelfWidgetBase(ShelfWidgetKind.CUT)
