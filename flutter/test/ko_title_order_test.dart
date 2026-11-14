// 제목순(지금 앱 localeCompare 'ko'): node에서 뽑은 순서와 같다
import 'package:chaekjang/domain/title_layout.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('한글 → 로마자, 대소문자 무시', () {
    final t = ['82년생 김지영', 'Demian', '데미안', '아무튼, 서재', '가나', 'A', 'a', 'Zebra', '흰', '100', '2']..sort(compareKoTitle);
    expect(t, ['100', '2', '82년생 김지영', '가나', '데미안', '아무튼, 서재', '흰', 'a', 'A', 'Demian', 'Zebra']);
  });
}
