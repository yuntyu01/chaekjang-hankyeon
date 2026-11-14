// 지금 앱 features/book/__tests__/book-share.test.ts와 같은 시험 + 갈피 공유 문장 줄 나누기
import 'package:chaekjang/features/book/book_share.dart';
import 'package:chaekjang/features/share/mark_scene.dart' show breakLines;
import 'package:chaekjang/ui/keep_all.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('읽은 기간: 같은 해면 끝은 월.일만, 해를 넘기면 끝도 해까지', () {
    expect(readPeriod('2026-10-12', '2026-11-05'), '2026.10.12 — 11.05');
    expect(readPeriod('2025-12-30', '2026-01-04'), '2025.12.30 — 2026.01.04');
    expect(readPeriod('2026-10-12', null, true), '2026.10.12부터');
    expect(readPeriod(null, '2026-11-05'), '2026.11.05 완독');
    expect(readPeriod(), isNull);
  });
  test('낱말 단위 줄바꿈: 낱말 안 글자 사이에만 단어 이음표, 띄어쓰기는 그대로', () {
    final t = keepAll('여러 번  다시');
    expect(t.replaceAll('⁠', ''), '여러 번  다시');
    expect('⁠'.allMatches(t).length, 2);
    expect(keepAll(''), '');
  });
  test('문장 줄 나누기: 가장 적은 줄 수에서 가장 긴 줄을 짧게, 꾸미는 짧은 낱말 뒤에서는 끊지 않는다', () {
    // 글자 수를 폭으로 본다
    double w(String s) => s.length.toDouble();
    expect(breakLines(['누구에게나', '자기', '자신에게로', '가는', '길이', '있다.'], w, 12), ['누구에게나', '자기 자신에게로', '가는 길이 있다.']);
    expect(breakLines(['짧다'], w, 12), ['짧다']);
    // 한 낱말이 폭보다 길어도 한 줄에 둔다
    expect(breakLines(['아주아주아주아주긴낱말'], w, 4), ['아주아주아주아주긴낱말']);
  });
}
