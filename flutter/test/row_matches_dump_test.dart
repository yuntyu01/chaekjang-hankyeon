// Dart로 만든 줄 굽기 입력이 지금 앱(React Native)의 줄 함수로 뽑아 둔 것과 같은지 본다.
// assets/bake_case.json 은 tool/gen_shaders.sh 가 커밋된 지금 앱의 ShelfPlank·SceneLight 함수를 그대로 불러 뽑는다
// (벽·틀 안쪽 면·판 윗면·앞면·책의 보이는 면, 같은 책·같은 줄 높이·맨 윗줄 여부).
// 여기서 어긋나면 빛 계산이 달라진다 — 이식이 맞는지 보는 가장 싼 시험이다.
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/shelf_row.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final json = jsonDecode(File('assets/bake_case.json').readAsStringSync()) as Map<String, dynamic>;
  // 맨 뒤 확인용 작은 줄은 칸 수만 바꾼 것이라 뺀다
  final rows = (json['rows'] as List).cast<Map<String, dynamic>>().where((r) => r['probe'] != true).toList();

  RowCase mineOf(Map<String, dynamic> r) {
    final n = (r['nBooks'] as num).toInt();
    final space = (r['space'] as num).toDouble();
    return buildRow(sampleBooks(n, space), space, top: r['top'] as bool, last: r['last'] as bool);
  }

  test('줄 여섯을 견준다', () => expect(rows.length, 6));

  test('상자 묶음과 둘레가 지금 앱과 같다', () {
    for (var i = 0; i < rows.length; i++) {
      final mine = mineOf(rows[i]);
      final theirs = rows[i];
      final box = (theirs['box'] as List).map((e) => (e as num).toDouble()).toList();
      expect(mine.bx.list.length, theirs['nBox'], reason: '줄 $i 상자 수');
      for (var k = 0; k < box.length; k++) {
        expect(mine.bx.v[k], closeTo(box[k], 1e-9), reason: '줄 $i 상자 값 $k');
      }
      expect(mine.env.u, (theirs['env'] as List).map((e) => (e as num).toDouble()).toList(), reason: '줄 $i 둘레');
    }
  });

  test('구울 면(이름·차례·자리·칸 수·법선)이 지금 앱과 같다', () {
    for (var i = 0; i < rows.length; i++) {
      final mine = mineOf(rows[i]);
      final items = rows[i]['items'] as List;
      expect(mine.items.map((m) => m.key).toList(), items.map((t) => (t as Map)['key']).toList(), reason: '줄 $i 면 이름·차례');
      for (var k = 0; k < items.length; k++) {
        final t = items[k] as Map<String, dynamic>;
        final m = mine.items[k];
        double at(String key, int j) => ((t[key] as List)[j] as num).toDouble();
        expect(m.w, t['w'], reason: '줄 $i ${m.key} 가로 칸');
        expect(m.h, t['h'], reason: '줄 $i ${m.key} 세로 칸');
        expect(m.self, (t['self'] as num).toDouble(), reason: '줄 $i ${m.key} 제 책');
        for (final (name, v) in [('O', m.o), ('U', m.u), ('V', m.v), ('n', m.n)]) {
          expect(v.x, closeTo(at(name, 0), 1e-9), reason: '줄 $i ${m.key} $name.x');
          expect(v.y, closeTo(at(name, 1), 1e-9), reason: '줄 $i ${m.key} $name.y');
          expect(v.z, closeTo(at(name, 2), 1e-9), reason: '줄 $i ${m.key} $name.z');
        }
      }
    }
  });
}
