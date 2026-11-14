package app.covebook.chaekjang

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

// 환경음 잠금 화면 표시(just_audio_background)가 이 활동의 Flutter 엔진을 함께 쓴다
class MainActivity : AudioServiceActivity() {
  private val recognizer by lazy { TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()) }

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    // 사진 한 장의 문장 인식(지금 앱 TextRecognitionModule과 같다): 블록 = 문단 후보, 줄 = 인쇄된 한 줄과 그 위치·신뢰도.
    // 인식하지 못한 부분을 지어내지 않는다: 빈 결과는 빈 블록 목록
    // 공유 그림을 사진첩(Pictures/책장한켠)에 저장한다(지금 앱 screen-capture saveImageToGallery와 같다). Android 10+는 MediaStore로 권한 없이 쓴다
    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "app.covebook/gallery").setMethodCallHandler { call, result ->
      when (call.method) {
        "canSave" -> result.success(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        "save" -> {
          if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@setMethodCallHandler result.error("ERR_UNSUPPORTED", "Saving to gallery needs Android 10", null)
          val path = call.argument<String>("path") ?: return@setMethodCallHandler result.error("ERR_SAVE", "No file", null)
          val name = call.argument<String>("name") ?: File(path).name
          val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/책장한켠")
            put(MediaStore.Images.Media.IS_PENDING, 1)
          }
          val uri = contentResolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
            ?: return@setMethodCallHandler result.error("ERR_SAVE", "MediaStore insert failed", null)
          try {
            val out = contentResolver.openOutputStream(uri) ?: throw IllegalStateException("No output stream")
            out.use { o -> File(path).inputStream().use { it.copyTo(o) } }
            contentResolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            result.success(uri.toString())
          } catch (e: Exception) {
            contentResolver.delete(uri, null, null)
            result.error("ERR_SAVE", e.message ?: "save failed", null)
          }
        }
        else -> result.notImplemented()
      }
    }
    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "app.covebook/text_recognition").setMethodCallHandler { call, result ->
      if (call.method != "recognize") return@setMethodCallHandler result.notImplemented()
      val uri = call.arguments as? String ?: return@setMethodCallHandler result.error("ERR_IMAGE", "No image", null)
      val image = try {
        val u = if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)
        InputImage.fromFilePath(this, u)
      } catch (e: Exception) {
        android.util.Log.e("TextRecognition", "image $uri", e)
        return@setMethodCallHandler result.error("ERR_IMAGE", e.message ?: "Cannot read image", null)
      }
      recognizer.process(image)
        .addOnSuccessListener { text ->
          val blocks = text.textBlocks.map { b ->
            mapOf(
              "text" to b.text,
              "lines" to b.lines.map { l ->
                val r = l.boundingBox
                mapOf(
                  "text" to l.text,
                  "left" to (r?.left ?: 0), "top" to (r?.top ?: 0), "right" to (r?.right ?: 0), "bottom" to (r?.bottom ?: 0),
                  "confidence" to l.confidence.toDouble(),
                )
              },
            )
          }
          result.success(mapOf("width" to image.width, "height" to image.height, "blocks" to blocks))
        }
        .addOnFailureListener { e ->
          android.util.Log.e("TextRecognition", "recognize", e)
          result.error("ERR_RECOGNIZE", e.message ?: "Recognition failed", null)
        }
    }
  }
}
