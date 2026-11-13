// Dart로 만든 줄 굽기 입력이 지금 앱(React Native)의 빛 모델이 뽑아 둔 것과 같은지 본다.
// assets/bake_case.json 은 tool/gen_shaders.sh 가 지금 앱에서 뽑는다(같은 책·같은 줄 높이).
// 여기서 어긋나면 빛 계산이 달라진다 — 이식이 맞는지 보는 가장 싼 시험이다.
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/shelf_row.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final json = jsonDecode(File('assets/bake_case.json').readAsStringSync()) as Map<String, dynamic>;
  final rows = json['rows'] as List;

  // tool/dump_sksl.test.ts 의 줄들과 같은 책 수·줄 높이
  const want = [(0, 190.0), (5, 190.0), (4, 205.0), (4, 205.0), (7, 215.0), (4, 205.0)];

  test('상자 묶음이 지금 앱과 같다', () {
    for (var i = 0; i < want.length; i++) {
      final (n, space) = want[i];
      final mine = buildRow(sampleBooks(n, space), space);
      final theirs = rows[i] as Map<String, dynamic>;
      final box = (theirs['box'] as List).map((e) => (e as num).toDouble()).toList();
      expect(mine.bx.list.length, theirs['nBox'], reason: '줄 $i 상자 수');
      for (var k = 0; k < box.length; k++) {
        expect(mine.bx.v[k], closeTo(box[k], 1e-9), reason: '줄 $i 상자 값 $k');
      }
      expect(mine.env.u, (theirs['env'] as List).map((e) => (e as num).toDouble()).toList(), reason: '줄 $i 둘레');
    }
  });

  test('구울 면이 지금 앱과 같다', () {
    for (var i = 0; i < want.length; i++) {
      final (n, space) = want[i];
      final mine = buildRow(sampleBooks(n, space), space);
      final items = (rows[i] as Map<String, dynamic>)['items'] as List;
      expect(mine.items.length, items.length, reason: '줄 $i 면 수');
      for (var k = 0; k < items.length; k++) {
        final t = items[k] as Map<String, dynamic>;
        final m = mine.items[k];
        double at(String key, int j) => ((t[key] as List)[j] as num).toDouble();
        expect(m.w, t['w'], reason: '줄 $i 면 $k 가로 칸');
        expect(m.h, t['h'], reason: '줄 $i 면 $k 세로 칸');
        expect(m.self, (t['self'] as num).toDouble(), reason: '줄 $i 면 $k 제 책');
        for (final (name, v) in [('O', m.o), ('U', m.u), ('V', m.v), ('n', m.n)]) {
          expect(v.x, closeTo(at(name, 0), 1e-9), reason: '줄 $i 면 $k $name.x');
          expect(v.y, closeTo(at(name, 1), 1e-9), reason: '줄 $i 면 $k $name.y');
          expect(v.z, closeTo(at(name, 2), 1e-9), reason: '줄 $i 면 $k $name.z');
        }
      }
    }
  });
}
