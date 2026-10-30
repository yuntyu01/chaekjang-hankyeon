package app.covebook.screencapture

import android.graphics.Bitmap
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.PixelCopy
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

// 앱 창의 지금 화면을 JPEG 파일로. 화면에 이미 그려진 창 버퍼를 GPU에서 복사(PixelCopy)하고 압축·저장은 따로 도는 스레드에서 해
// 메인 스레드를 막지 않는다(뷰를 하나씩 다시 그리는 방식은 줄 캔버스 읽기로 메인 스레드가 1.6초 멈췄다)
class ScreenCaptureModule : Module() {
  private val worker by lazy { HandlerThread("ScreenCapture").apply { start() } }
  private val handler by lazy { Handler(worker.looper) }

  override fun definition() = ModuleDefinition {
    Name("ScreenCapture")

    // path: 저장할 파일(file:// 주소 또는 경로), x·y·w·h: 창 안 영역(물리 픽셀), quality: JPEG 품질 0~100
    AsyncFunction("captureWindow") { path: String, x: Int, y: Int, w: Int, h: Int, quality: Int, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction promise.reject("ERR_UNSUPPORTED", "PixelCopy(Window) needs Android 8", null)
      val window = appContext.currentActivity?.window ?: return@AsyncFunction promise.reject("ERR_NO_WINDOW", "No activity window", null)
      if (w <= 0 || h <= 0) return@AsyncFunction promise.reject("ERR_SIZE", "Empty capture rect", null)
      val file = File(if (path.startsWith("file:")) Uri.parse(path).path!! else path)
      val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      try {
        PixelCopy.request(window, Rect(x, y, x + w, y + h), bitmap, { result ->
          try {
            if (result != PixelCopy.SUCCESS) {
              promise.reject("ERR_COPY", "PixelCopy failed: $result", null)
            } else {
              file.parentFile?.mkdirs()
              FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }
              promise.resolve(mapOf("width" to w, "height" to h))
            }
          } catch (e: Exception) {
            promise.reject("ERR_SAVE", e.message ?: "save failed", e)
          } finally {
            bitmap.recycle()
          }
        }, handler)
      } catch (e: Exception) {
        bitmap.recycle()
        promise.reject("ERR_COPY", e.message ?: "PixelCopy failed", e)
      }
    }
  }
}
