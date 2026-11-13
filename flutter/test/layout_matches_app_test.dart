// 배치 계산(자리·쌓기·표지 전시·기대기 물리)이 지금 앱 computeShelf 결과와 같은지 본다.
// test/fixtures/layout_cases.json 은 tool/gen_shaders.sh 가 커밋된 지금 앱의 실제 책 비교 책장(real·real-front·real-side·real-before)과
// 그 변형(위치 없는 예전 저장본·기대는 방향 뒤집기)으로 뽑는다.
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/layout.dart';
import 'package:chaekjang/domain/layout_engine.dart';
import 'package:chaekjang/domain/shelf_scene.dart';
import 'package:chaekjang/domain/types.dart';
import 'package:flutter_test/flutter_test.dart';

Pose poseOf(String s) => switch (s) { 'front' => Pose.front, 'horizontal' => Pose.horizontal, _ => Pose.upright };
double? d(Object? v) => (v as num?)?.toDouble();

void main() {
  final json = jsonDecode(File('test/fixtures/layout_cases.json').readAsStringSync()) as Map<String, dynamic>;
  for (final c in (json['layoutCases'] as List).cast<Map<String, dynamic>>()) {
    test('${c['name']} 책장이 지금 앱과 같다', () {
      final BookMap books = {
        for (final b in (c['books'] as List).cast<Map<String, dynamic>>())
          b['id'] as String: Book(
            id: b['id'] as String,
            title: b['title'] as String,
            dims: BookDims(d(b['dims']['height'])!, d(b['dims']['thickness'])!, d(b['dims']['coverWidth'])!),
          ),
      };
      final l = c['layout'] as Map<String, dynamic>;
      final layout = ShelfLayout(
        [for (final s in (l['shelves'] as List).cast<Map<String, dynamic>>()) Shelf(s['id'] as String, (s['order'] as num).toInt())],
        [
          for (final p in (l['placements'] as List).cast<Map<String, dynamic>>())
            BookPlacement(
              bookId: p['bookId'] as String,
              shelfId: p['shelfId'] as String,
              order: (p['order'] as num).toInt(),
              pose: poseOf(p['pose'] as String),
              tilt: (p['tilt'] as num).toInt(),
              stackId: p['stackId'] as String?,
              stackOrder: (p['stackOrder'] as num?)?.toInt(),
              pos: d(p['pos']),
              leanAngle: d((p['lean'] as Map?)?['angle']),
              leanOn: (p['lean'] as Map?)?['on'] as String?,
              leanSlide: d((p['lean'] as Map?)?['slide']),
              depth: d(p['depth']),
              spin: d(p['spin']),
              pitch: d(p['pitch']),
              stackDx: d(p['stackDx']),
              stackDz: d(p['stackDz']),
              flip: p['flip'] == true,
              overhang: p['overhang'] == true,
              wallLean: p['wallLean'] == true,
            ),
        ],
      );
      final frames = (c['frames'] as Map<String, dynamic>);
      for (final e in frames.entries) {
        final mine = computeShelf(layout, books, e.key);
        final theirs = (e.value as List).cast<Map<String, dynamic>>();
        expect(mine.map((f) => f.bookId).toList(), theirs.map((f) => f['bookId']).toList(), reason: '${e.key} 책 차례');
        for (var i = 0; i < theirs.length; i++) {
          final t = theirs[i], m = mine[i];
          final why = '${c['name']} ${e.key} ${m.bookId}';
          expect(m.pose, poseOf(t['pose'] as String), reason: '$why 자세');
          expect(m.tilt, (t['tilt'] as num).toInt(), reason: '$why 기울기 방향');
          expect(m.stackIndex, (t['stackIndex'] as num).toInt(), reason: '$why 더미 차례');
          expect(m.leanOn, t['leanOn'], reason: '$why 기댄 상대');
          expect(m.leanFailed, t['leanFailed'], reason: '$why 기대기 실패');
          expect(m.fell, (t['fell'] as num?)?.toInt(), reason: '$why 넘어짐');
          expect(m.slide ?? 0, closeTo(d(t['slide']) ?? 0, 1e-6), reason: '$why 미끄러짐');
          final b = t['box'] as Map<String, dynamic>;
          for (final (k, v) in [('x', m.box.x), ('y', m.box.y), ('z', m.box.z), ('angle', m.box.angle)]) {
            expect(v, closeTo(d(b[k])!, 1e-6), reason: '$why 상자 $k');
          }
          expect(m.box.spin ?? 0, closeTo(d(b['spin']) ?? 0, 1e-9), reason: '$why 돌리기');
          expect(m.box.pitch ?? 0, closeTo(d(b['pitch']) ?? 0, 1e-9), reason: '$why 젖힘');
          expect(m.box.flip, b['flip'] == true, reason: '$why 머리 방향');
          final size = b['size'] as Map<String, dynamic>;
          expect(m.box.size.w, closeTo(d(size['w'])!, 1e-9), reason: '$why 폭');
          expect(m.box.size.h, closeTo(d(size['h'])!, 1e-9), reason: '$why 높이');
          expect(m.box.size.d, closeTo(d(size['d'])!, 1e-9), reason: '$why 깊이');
        }
      }
    });
  }
}
