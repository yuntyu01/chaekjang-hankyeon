// 낱말 단위 줄바꿈(CSS word-break: keep-all처럼). 한글은 글자마다 끊겨 '다/시'처럼 낱말이 갈린다.
// 낱말 안 글자 사이에 단어 이음표(U+2060, 폭 없음)를 넣어 띄어쓰기에서만 끊게 한다(지금 앱 ui/keep-all.ts)
library;

final _space = RegExp(r'(\s+)');

String keepAll(String t) {
  final out = StringBuffer();
  var at = 0;
  for (final m in _space.allMatches(t)) {
    out.write(_join(t.substring(at, m.start)));
    out.write(m.group(0));
    at = m.end;
  }
  out.write(_join(t.substring(at)));
  return out.toString();
}

String _join(String w) => w.runes.map(String.fromCharCode).join('\u2060');
