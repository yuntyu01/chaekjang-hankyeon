// 문장 인식 결과 → 갈피 문장(지금 앱 domain/ocr-text.ts 규칙): 줄 잇기·영어 하이픈 붙이기·문단 사이 빈 줄·흐린 줄 세기
import 'package:chaekjang/domain/ocr_text.dart';
import 'package:flutter_test/flutter_test.dart';

OcrLine l(String t, [double c = 0.9]) => (text: t, left: 0, top: 0, right: 0, bottom: 0, confidence: c);

void main() {
  final r = (
    width: 100,
    height: 100,
    blocks: <OcrBlock>[
      (text: '', lines: [l('나는 그 문장을 '), l('오래 붙잡고 있었다.  '), l('read-'), l('ing is fun', 0.3)]),
      (text: '', lines: [l('  '), l('두 번째 문단', 0)]),
    ],
  );
  test('줄 끝 이어 쓰기', () {
    expect(ocrText(r, LineMode.join), '나는 그 문장을 오래 붙잡고 있었다. reading is fun\n\n두 번째 문단');
  });
  test('줄바꿈 그대로', () {
    expect(ocrText(r, LineMode.keep), '나는 그 문장을\n오래 붙잡고 있었다.\nread-\ning is fun\n\n두 번째 문단');
  });
  test('흐린 줄(신뢰도 0은 세지 않는다)', () {
    expect(lowConfidenceLines(r), 1);
  });
}
