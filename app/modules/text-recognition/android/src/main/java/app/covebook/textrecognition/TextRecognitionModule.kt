package app.covebook.textrecognition

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// 사진 한 장의 문장 인식(기기 안, ML Kit 한국어 모델). 결과는 인식한 그대로(블록 = 문단 후보, 줄 = 인쇄된 한 줄)와 각 줄의 위치.
// 인식하지 못한 부분을 지어내지 않는다: 빈 결과는 빈 블록 목록으로 돌려준다.
class TextRecognitionModule : Module() {
  private val recognizer by lazy { TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()) }

  override fun definition() = ModuleDefinition {
    Name("TextRecognition")

    // uri: file:// 또는 content:// 주소, 파일 경로
    AsyncFunction("recognize") { uri: String, promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("ERR_CONTEXT", "No context", null)
      val image = try {
        val u = if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)
        InputImage.fromFilePath(context, u)
      } catch (e: Exception) {
        return@AsyncFunction promise.reject("ERR_IMAGE", e.message ?: "Cannot read image", e)
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
                  "confidence" to (l.confidence.toDouble())
                )
              }
            )
          }
          promise.resolve(mapOf("width" to image.width, "height" to image.height, "blocks" to blocks))
        }
        .addOnFailureListener { e -> promise.reject("ERR_RECOGNIZE", e.message ?: "Recognition failed", e) }
    }
  }
}
