// 기기 안 문장 인식(지금 앱 modules/text-recognition: Android ML Kit 한국어 모델, MainActivity의 채널. iOS는 Vision, AppDelegate). 사진은 기기 밖으로 보내지 않는다.
// 지원하지 않는 곳에서는 available이 false이고 가짜 결과를 돌려주지 않는다(iOS 16 아래는 채널이 오류를 돌려 실패로 보인다)
library;

import 'dart:io';

import 'package:flutter/services.dart';

import '../domain/ocr_text.dart';

const _channel = MethodChannel('app.covebook/text_recognition');

bool get textRecognitionAvailable => Platform.isAndroid || Platform.isIOS;

/// 인식하지 못하는 곳에서 보일 안내(지금 앱 ocr.reason)
const textRecognitionReason = '이 기기에서는 문장 인식을 쓸 수 없어요. 사진을 보면서 옮겨 적거나 사진으로 남길 수 있어요.';

/// path: 파일 경로 또는 content:// 주소
Future<OcrResult> recognizeText(String path) async {
  if (!textRecognitionAvailable) throw StateError('text recognition unavailable');
  final m = (await _channel.invokeMapMethod<String, Object?>('recognize', path))!;
  return (
    width: (m['width']! as num).toInt(),
    height: (m['height']! as num).toInt(),
    blocks: [
      for (final b in (m['blocks']! as List).cast<Map<Object?, Object?>>())
        (
          text: b['text']! as String,
          lines: [
            for (final l in (b['lines']! as List).cast<Map<Object?, Object?>>())
              (
                text: l['text']! as String,
                left: (l['left']! as num).toInt(),
                top: (l['top']! as num).toInt(),
                right: (l['right']! as num).toInt(),
                bottom: (l['bottom']! as num).toInt(),
                confidence: (l['confidence']! as num).toDouble(),
              ),
          ],
        ),
    ],
  );
}
