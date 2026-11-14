// 문장 인식 결과(블록 = 문단 후보, 줄 = 인쇄된 한 줄) → 갈피 문장(지금 앱 domain/ocr-text.ts). 인식한 글자만 쓰고 빈 곳을 지어내지 않는다.
// - 줄 끝 이어 쓰기(산문): 한 블록 안의 인쇄 줄바꿈을 잇는다(띄어쓰기 하나). 영어 단어가 하이픈으로 줄을 넘었으면 하이픈을 빼고 붙인다.
// - 줄바꿈 그대로(시 등): 인쇄된 줄을 그대로 둔다.
// 블록 사이는 빈 줄 하나(문단 구분). 앞뒤 공백은 정리한다
library;

typedef OcrLine = ({String text, int left, int top, int right, int bottom, double confidence});
typedef OcrBlock = ({String text, List<OcrLine> lines});
typedef OcrResult = ({int width, int height, List<OcrBlock> blocks});

enum LineMode { join, keep }

final _hyphenEnd = RegExp(r'[A-Za-z]-$');
final _latinStart = RegExp(r'^[A-Za-z]');
final _spaces = RegExp(r'\s{2,}');

String ocrText(OcrResult r, LineMode mode) {
  final paras = <String>[];
  for (final b in r.blocks) {
    final lines = [for (final l in b.lines) if (l.text.trim().isNotEmpty) l.text.trim()];
    if (lines.isEmpty) continue;
    if (mode == LineMode.keep) {
      paras.add(lines.join('\n'));
      continue;
    }
    var out = lines.first;
    for (final next in lines.skip(1)) {
      out = _hyphenEnd.hasMatch(out) && _latinStart.hasMatch(next) ? out.substring(0, out.length - 1) + next : '$out $next';
    }
    paras.add(out.replaceAll(_spaces, ' '));
  }
  return paras.join('\n\n').trim();
}

/// 인식 신뢰도가 낮은 줄 수(모델이 신뢰도를 주지 않으면 0으로 와서 세지 않는다)
int lowConfidenceLines(OcrResult r, [double below = 0.5]) {
  var n = 0;
  for (final b in r.blocks) {
    for (final l in b.lines) {
      if (l.confidence > 0 && l.confidence < below) n++;
    }
  }
  return n;
}
