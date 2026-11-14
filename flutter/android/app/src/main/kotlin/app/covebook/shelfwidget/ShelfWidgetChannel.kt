package app.covebook.shelfwidget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

// 앱(Dart, services/shelf_widget.dart)이 홈 책장 그림에서 첫 네 칸을 한 장으로 떠서 알려 준다(지금 앱 ShelfWidgetModule.updateRows와 같은 일).
// 칸마다 잘라 row<칸>-<때>.jpg로, 투명 위젯용으로 오려 낸 것은 rowcut<칸>-<때>.png로 두고, 열쇠가 바뀐 칸은 버린 뒤 위젯을 다시 그린다.
// 그리기(그림 읽기·오려 내기·자르기)는 따로 한 줄에서 한다(앱 화면을 막지 않게)
object ShelfWidgetChannel {
  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  fun register(context: Context, messenger: BinaryMessenger) {
    val app = context.applicationContext
    MethodChannel(messenger, "app.covebook/shelf_widget").setMethodCallHandler { call, result ->
      when (call.method) {
        "updateRows" -> {
          val path = call.argument<String>("path")
          val band = call.argument<List<List<Int>>>("band") ?: emptyList()
          val bandKeys = call.argument<List<String>>("bandKeys") ?: emptyList()
          val keys = call.argument<List<String>>("keys") ?: emptyList()
          val books = call.argument<List<List<Double>>>("books") ?: emptyList()
          val ribbons = call.argument<List<List<Double>>>("ribbons") ?: emptyList()
          val boards = call.argument<List<List<Double>>>("boards") ?: emptyList()
          worker.execute {
            val n = try { updateRows(app, path, band, bandKeys, keys, books, ribbons, boards) } catch (e: Exception) { Log.w("ShelfWidget", "update failed", e); 0 }
            main.post { result.success(n) }
          }
        }
        else -> result.notImplemented()
      }
    }
  }

  // band: 칸마다 [칸 번호, 그림 안 위 px, 아래 px, 책장 콘텐츠 기준 위 끝 px], bandKeys: 그 칸들의 열쇠. 놓인 위젯 수를 돌려준다
  private fun updateRows(ctx: Context, path: String?, band: List<List<Int>>, bandKeys: List<String>, keys: List<String>, books: List<List<Double>>, ribbons: List<List<Double>>, boards: List<List<Double>>): Int {
    if (path != null) {
      val file = File(path)
      try {
        val src = BitmapFactory.decodeFile(file.path)
        if (src != null) {
          val cut = ShelfWidgetRenderer.cutOf(src, books, ribbons, boards)
          val stamp = file.name.removePrefix("band-").substringBeforeLast('.')
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
    return ShelfWidgetProvider.updateAll(ctx)
  }

  private fun write(b: Bitmap, f: File, fmt: Bitmap.CompressFormat, q: Int) {
    FileOutputStream(f).use { b.compress(fmt, q, it) }
    b.recycle()
  }
}
