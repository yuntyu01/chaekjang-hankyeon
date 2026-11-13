// 책 그림 규칙(제목 조판·제목 색·재질 색·갈피 색)이 지금 앱 함수 결과와 같은지 본다.
// test/fixtures/book_art_cases.json 은 tool/gen_shaders.sh 가 커밋된 지금 앱 함수로 뽑는다.
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/binding_material.dart';
import 'package:chaekjang/domain/book_light.dart';
import 'package:chaekjang/domain/color.dart';
import 'package:chaekjang/domain/title_layout.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final json = jsonDecode(File('test/fixtures/book_art_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final titles = (json['titleCases'] as List).cast<Map<String, dynamic>>();
  final colors = (json['colorCases'] as List).cast<Map<String, dynamic>>();
  double d(Object? v) => (v as num).toDouble();
  List<String> strs(Object? v) => (v as List).cast<String>();

  test('세운 책등 제목 조판이 지금 앱과 같다', () {
    for (final c in titles) {
      final (t, h) = (d(c['T']), d(c['H']));
      for (final (key, mine) in [
        ('spine', spineTitleLayout(c['title'] as String, h, t * 0.94, 0.88, 1.0)),
        ('spine79', spineTitleLayout(c['title'] as String, h, t * 0.94, 0.79, 0.91)),
      ]) {
        final theirs = c[key] as Map<String, dynamic>;
        final why = '${c['title']} $t×$h $key';
        expect(mine.fontSize, closeTo(d(theirs['fontSize']), 1e-9), reason: '$why 크기');
        expect(mine.columns, strs(theirs['columns']), reason: '$why 열');
        expect(mine.pitch, closeTo(d(theirs['pitch']), 1e-9), reason: '$why 간격');
        expect(mine.textTop, closeTo(d(theirs['textTop']), 1e-9), reason: '$why 글자 위');
        expect(mine.artTop, closeTo(d(theirs['artTop']), 1e-9), reason: '$why 그림 위');
      }
    }
  });

  test('눕힌 책등·앞표지 제목 조판이 지금 앱과 같다', () {
    for (final c in titles) {
      final why = '${c['title']} ${c['T']}×${c['H']}×${c['W']}';
      final ly = lyingTitleLayout(c['title'] as String, d(c['H']), d(c['T']));
      final l = c['lying'] as Map<String, dynamic>;
      expect(ly.fontSize, closeTo(d(l['fontSize']), 1e-9), reason: '$why 눕힘 크기');
      expect(ly.text, l['text'], reason: '$why 눕힘 글');
      final cv = coverTitleLayout(c['title'] as String, d(c['W']), d(c['H']));
      final t = c['cover'] as Map<String, dynamic>;
      expect(cv.fontSize, closeTo(d(t['fontSize']), 1e-9), reason: '$why 표지 크기');
      expect(cv.lines, strs(t['lines']), reason: '$why 표지 줄');
    }
  });

  test('제목 색·장정 색·재질 색·갈피 색이 지금 앱과 같다', () {
    for (final c in colors) {
      final color = c['color'] as String;
      expect(jacketColor(color), c['jacket'], reason: '$color 장정 색');
      expect(titleInk(color), c['titleInk'], reason: '$color 제목 색');
      expect(displayInk(null, color), c['displayInkNone'], reason: '$color 자동 글자색');
      expect(displayInk('#2F3944', color), c['displayInkLegacy'], reason: '$color 예전 글자색');
      expect(displayInk('#AA3311', color), c['displayInkCustom'], reason: '$color 고른 글자색');
      expect(bindingSurfaceTone(jacketColor(color)).toUpperCase(), (c['tone'] as String).toUpperCase(), reason: '$color 재질 색');
      final (a, b) = tabColors(color, 'book-1');
      expect([a, b], strs(c['tabs']), reason: '$color 갈피 색');
      final (a2, b2) = tabColors(null, 'k$color');
      expect([a2, b2], strs(c['tabsNone']), reason: '$color 기본 갈피 색');
      expect(bookToneOf(jacketColor(color), photo: true).toUpperCase(), (c['photoTone'] as String).toUpperCase(), reason: '$color 사진 책 재질 색');
      for (final (key, hex) in [('albedo', bookToneOf(jacketColor(color))), ('albedoPhoto', bookToneOf(jacketColor(color), photo: true))]) {
        final want = (c[key] as List).map((e) => (e as num).toDouble()).toList();
        final got = bookAlbedo(hex);
        expect([got.r, got.g, got.b], [for (final w in want) closeTo(w, 1e-9)], reason: '$color $key 반사율');
      }
    }
  });
}
