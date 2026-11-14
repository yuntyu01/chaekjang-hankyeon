package app.covebook.chaekjang

import android.net.Uri
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
