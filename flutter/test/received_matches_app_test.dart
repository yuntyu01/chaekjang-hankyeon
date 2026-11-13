// 책 면이 받는 창빛 그림자(3D 단계)가 지금 앱 receivedShadow3 결과와 같은지 본다: 실사 책장(real·real-side) 줄마다 책마다
// 받는 면·빛 길이 구간·가리개 조각 꼭짓점·흐림·가리는 몫. test/fixtures/received_cases.json 은 tool/gen_shaders.sh 가 뽑는다
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/book3.dart';
import 'package:chaekjang/domain/book3_physics.dart';
import 'package:chaekjang/domain/layout.dart';
import 'package:chaekjang/domain/received3.dart';
import 'package:chaekjang/domain/shelf_scene.dart';
import 'package:chaekjang/domain/types.dart';
import 'package:flutter_test/flutter_test.dart';

import 'layout_matches_app_test.dart' show poseOf, d;

void main() {
  final recv = jsonDecode(File('test/fixtures/received_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final layouts = jsonDecode(File('test/fixtures/layout_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final ceil = (recv['ceil'] as num).toDouble();

  test('받는 그림자가 지금 앱과 같다', () {
    final byLayout = <String, Map<String, List<Book3>>>{};
    for (final c in (layouts['layoutCases'] as List).cast<Map<String, dynamic>>()) {
      final books = {
        for (final b in (c['books'] as List).cast<Map<String, dynamic>>())
          b['id'] as String: Book(id: b['id'] as String, title: '', dims: BookDims(d(b['dims']['height'])!, d(b['dims']['thickness'])!, d(b['dims']['coverWidth'])!)),
      };
      final l = c['layout'] as Map<String, dynamic>;
      final layout = ShelfLayout(
        [for (final s in (l['shelves'] as List).cast<Map<String, dynamic>>()) Shelf(s['id'] as String, (s['order'] as num).toInt())],
        [
          for (final p in (l['placements'] as List).cast<Map<String, dynamic>>())
            BookPlacement(
              bookId: p['bookId'] as String, shelfId: p['shelfId'] as String, order: (p['order'] as num).toInt(),
              pose: poseOf(p['pose'] as String), tilt: (p['tilt'] as num).toInt(), stackId: p['stackId'] as String?,
              stackOrder: (p['stackOrder'] as num?)?.toInt(), pos: d(p['pos']), depth: d(p['depth']), spin: d(p['spin']), pitch: d(p['pitch']),
              leanAngle: d((p['lean'] as Map?)?['angle']), leanOn: (p['lean'] as Map?)?['on'] as String?, leanSlide: d((p['lean'] as Map?)?['slide']),
            ),
        ],
      );
      byLayout[c['name'] as String] = {
        for (final s in sortedShelves(layout)) s.id: [for (final f in computeShelf(layout, books, s.id)) fromPlaced(f.box)],
      };
    }
    var faces = 0, layers = 0;
    for (final r in (recv['recvCases'] as List).cast<Map<String, dynamic>>()) {
      final row = byLayout[r['layout']]![r['shelfId']]!;
      final b = row.firstWhere((x) => x.id == r['bookId']);
      final mine = receivedShadow3(b, occludersIn(row, b, ceil), 2);
      final theirs = (r['faces'] as List).cast<Map<String, dynamic>>();
      final why = '${r['layout']} ${r['bookId']}';
      expect(mine.map((f) => f.f.name).toList(), theirs.map((f) => f['f']).toList(), reason: '$why 받는 면');
      for (var i = 0; i < theirs.length; i++) {
        final tb = (theirs[i]['bands'] as List);
        expect(mine[i].bands.length, tb.length, reason: '$why 구간 수');
        for (var k = 0; k < tb.length; k++) {
          final tl = (tb[k] as List).cast<Map<String, dynamic>>();
          expect(mine[i].bands[k].length, tl.length, reason: '$why ${mine[i].f.name} 구간 $k 조각 수');
          for (var j = 0; j < tl.length; j++) {
            final m = mine[i].bands[k][j], t = tl[j];
            expect(m.sigma, closeTo(d(t['sigma'])!, 1e-9), reason: '$why 흐림');
            expect(m.w, closeTo(d(t['w'])!, 1e-9), reason: '$why 가리는 몫');
            final tp = (t['poly'] as List).cast<List>();
            expect(m.poly.length, tp.length, reason: '$why 꼭짓점 수');
            for (var q = 0; q < tp.length; q++) {
              expect(m.poly[q].x, closeTo(d(tp[q][0])!, 1e-6));
              expect(m.poly[q].y, closeTo(d(tp[q][1])!, 1e-6));
              expect(m.poly[q].z, closeTo(d(tp[q][2])!, 1e-6));
            }
            layers++;
          }
        }
        faces++;
      }
    }
    expect(faces, greaterThan(10));
    expect(layers, greaterThan(50));
  });
}
