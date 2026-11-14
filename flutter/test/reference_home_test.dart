// 새 서재 예시 책장(지금 앱 home-reference): 18권·자리 18개·그림 표지 3권, 갈피 보이는 책, 배치 JSON이 읽힌다
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/book_look.dart';
import 'package:chaekjang/domain/layout_json.dart';
import 'package:chaekjang/domain/reference_home.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('예시 책장 읽기', () {
    final h = referenceHomeOf(jsonDecode(File('assets/reference_home.json').readAsStringSync()) as Map<String, Object?>);
    expect(h.books.length, 18);
    final l = layoutFromJson(h.layoutJson)!;
    expect(l.placements.length, 18);
    expect(l.shelves.length, 3);
    expect(l.placements.every((p) => h.books.containsKey(p.bookId)), isTrue);
    final pictures = [for (final b in h.books.values) if (b.reference != null) b.title];
    expect(pictures, containsAll(['느린 계절', '여름의 숲', '우리가 빛의 속도로 갈 수 없다면']));
    for (final k in ['night', 'forest', 'sunset']) {
      expect(File('assets/reference/$k.png').existsSync(), isTrue);
    }
    // 그림 표지는 그림 책 빛(회색 반사율)으로 — 지금 앱은 책 색에 물들었다(Flutter에서만 고친다)
    final night = h.books.values.firstWhere((b) => b.reference == 'night');
    expect(lookOf(night).picture, isTrue);
    expect(lookOf(h.books['home-reference-b02']!).ribbons, 2);
    expect(lookOf(h.books['home-reference-b02']!).material, 'linen');
  });
}
