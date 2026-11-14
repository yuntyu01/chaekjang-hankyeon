// 책장 편집 연산(옮기기·끼우기·쌓기·기울이기·자세·돌리기·깊이·서랍·바꿔 놓기·표지 젖히기/돌리기/놓기)과 그 뒤 기대기 정리(resolveLeans)가
// 지금 앱과 같은지 본다. test/fixtures/edit_cases.json은 tool/dump_edit.test.ts가 지금 앱으로 무작위로 이어 건 입력·결과다.
// 연산마다 같은 입력(지금 앱의 before)에서 걸어 결과(성공·까닭·배치)를, 기대기 정리는 지금 앱의 after에서 걸어 결과(배치·떨어진 책)를 견준다
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/layout.dart';
import 'package:chaekjang/domain/layout_engine.dart';
import 'package:chaekjang/domain/shelf_scene.dart';
import 'package:chaekjang/domain/types.dart';
import 'package:flutter_test/flutter_test.dart';

Pose poseOf(String s) => switch (s) { 'front' => Pose.front, 'horizontal' => Pose.horizontal, _ => Pose.upright };
String poseName(Pose p) => switch (p) { Pose.front => 'front', Pose.horizontal => 'horizontal', Pose.upright => 'spine' };
double? d(Object? v) => (v as num?)?.toDouble();

ShelfLayout layoutOf(Map<String, dynamic> l) => ShelfLayout(
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
      [for (final id in (l['drawer'] as List? ?? const [])) id as String],
    );

/// 두 배치가 같은지(값은 1e-6 안에서). 다르면 첫 차이를 글로
String? diffLayout(ShelfLayout mine, Map<String, dynamic> theirs) {
  final t = layoutOf(theirs);
  if (mine.shelves.length != t.shelves.length) return '선반 수 ${mine.shelves.length} != ${t.shelves.length}';
  for (var i = 0; i < t.shelves.length; i++) {
    if (mine.shelves[i].id != t.shelves[i].id || mine.shelves[i].position != t.shelves[i].position) return '선반 $i';
  }
  if (mine.drawer.join(',') != t.drawer.join(',')) return '서랍 ${mine.drawer} != ${t.drawer}';
  if (mine.placements.length != t.placements.length) return '자리 수 ${mine.placements.length} != ${t.placements.length}';
  bool num(double? a, double? b) => (a ?? 0) == (b ?? 0) || (a != null && b != null && (a - b).abs() < 1e-6) || ((a ?? 0) - (b ?? 0)).abs() < 1e-6;
  for (var i = 0; i < t.placements.length; i++) {
    final a = mine.placements[i], b = t.placements[i];
    final why = '${b.bookId}';
    if (a.bookId != b.bookId) return '$i번째 책 ${a.bookId} != ${b.bookId}';
    if (a.shelfId != b.shelfId) return '$why 선반 ${a.shelfId} != ${b.shelfId}';
    if (a.order != b.order) return '$why 차례 ${a.order} != ${b.order}';
    if (a.pose != b.pose) return '$why 자세 ${a.pose} != ${b.pose}';
    if (a.tilt != b.tilt) return '$why 기울기 ${a.tilt} != ${b.tilt}';
    if (a.stackId != b.stackId || (a.stackOrder ?? 0) != (b.stackOrder ?? 0)) return '$why 더미 ${a.stackId}/${a.stackOrder} != ${b.stackId}/${b.stackOrder}';
    if ((a.pos == null) != (b.pos == null) || !num(a.pos, b.pos)) return '$why 자리 ${a.pos} != ${b.pos}';
    if (!num(a.leanAngle, b.leanAngle) || a.leanOn != b.leanOn || !num(a.leanSlide, b.leanSlide)) return '$why 기대기 ${a.leanAngle}/${a.leanOn}/${a.leanSlide} != ${b.leanAngle}/${b.leanOn}/${b.leanSlide}';
    if ((a.depth == null) != (b.depth == null) || !num(a.depth, b.depth)) return '$why 깊이 ${a.depth} != ${b.depth}';
    if (!num(a.spin, b.spin)) return '$why 돌림 ${a.spin} != ${b.spin}';
    if (!num(a.pitch, b.pitch)) return '$why 젖힘 ${a.pitch} != ${b.pitch}';
    if (!num(a.stackDx, b.stackDx) || !num(a.stackDz, b.stackDz)) return '$why 어긋남 ${a.stackDx},${a.stackDz} != ${b.stackDx},${b.stackDz}';
    if (a.flip != b.flip || a.overhang != b.overhang || a.wallLean != b.wallLean) return '$why flip/overhang/wallLean';
  }
  return null;
}

void main() {
  final json = jsonDecode(File('test/fixtures/edit_cases.json').readAsStringSync()) as Map<String, dynamic>;
  for (final c in (json['cases'] as List).cast<Map<String, dynamic>>()) {
    final BookMap books = {
      for (final b in (c['books'] as List).cast<Map<String, dynamic>>())
        b['id'] as String: Book(id: b['id'] as String, title: b['title'] as String, dims: BookDims(d(b['dims']['height'])!, d(b['dims']['thickness'])!, d(b['dims']['coverWidth'])!)),
    };
    final steps = (c['steps'] as List).cast<Map<String, dynamic>>();
    for (final (n, s) in steps.indexed) {
      final op = s['op'] as String;
      final args = s['args'] as Map<String, dynamic>;
      test('${c['name']} #$n $op ${jsonEncode(args)}', () {
        final before = layoutOf(s['before'] as Map<String, dynamic>);
        final id = args['id'] as String;
        EditResult? r;
        Object? extra;
        switch (op) {
          case 'move':
            r = moveBook(before, books, id, DropTarget.insert(args['shelfId'] as String, (args['index'] as num).toInt()));
          case 'moveX':
            r = moveBook(before, books, id, DropTarget.insert(args['shelfId'] as String, (args['index'] as num).toInt(), d(args['x'])));
          case 'stack':
            r = moveBook(before, books, id, DropTarget.stack(args['shelfId'] as String, args['itemKey'] as String));
          case 'tilt':
            r = setTilt(before, books, id, (args['tilt'] as num).toInt());
          case 'pose':
            r = setPose(before, books, id, poseOf(args['pose'] as String));
          case 'spin':
            r = setSpin(before, books, id, d(args['deg'])!);
          case 'depth':
            r = setDepth(before, books, id, d(args['z'])!);
          case 'drawer' || 'pullSupport':
            r = moveToDrawer(before, id, books);
          case 'fromDrawer':
            r = placeFromDrawer(before, books, id);
          case 'swap':
            r = swapWith(before, books, id, args['targetKey'] as String);
          case 'swapTarget':
            final t = findSwapTarget(before, books, id, d(args['centerX'])!);
            extra = t;
            final e = s['extra'] as Map<String, dynamic>;
            expect(t.kind, e['kind'], reason: '자리 판정 종류');
            if (e['itemKey'] != null) expect(t.itemKey, e['itemKey'], reason: '자리 판정 대상');
            if (e['x'] != null) expect(t.x, closeTo(d(e['x'])!, 1e-6), reason: '자리 판정 x');
            if (e['index'] != null) expect(t.index, (e['index'] as num).toInt(), reason: '자리 판정 순서');
            if (e['dx'] != null) expect(t.dx, closeTo(d(e['dx'])!, 1e-6), reason: '자리 판정 dx');
            r = applySwapTarget(before, books, id, t);
          case 'dropTarget':
            final det = detach(before, id, books);
            final p = placementOf(before, id)!;
            final t = findDropTarget(det, books, args['shelfId'] as String, d(args['centerX'])!, p.pose, d(args['width'])!);
            extra = t;
            final e = s['extra'] as Map<String, dynamic>;
            expect(t.kind, e['kind'], reason: '놓을 자리 종류');
            if (e['itemKey'] != null) expect(t.itemKey, e['itemKey']);
            if (e['index'] != null) expect(t.index, (e['index'] as num).toInt(), reason: '놓을 순서');
            if (e['x'] != null) expect(t.x, closeTo(d(e['x'])!, 1e-6), reason: '놓을 x');
            r = moveBook(before, books, id, t);
          case 'rotate':
            r = rotateStep(before, books, id, (args['dir'] as num).toInt());
          case 'moveBy':
            r = moveBy(before, books, id, (args['delta'] as num).toInt());
          case 'toShelf':
            r = moveToShelf(before, books, id, args['shelfId'] as String);
          case 'shift':
            r = shiftOnStack(before, books, id, d(args['dx'])!);
          case 'frontTilt' || 'frontSpin' || 'frontRelease':
            final fs = frontStateOf(before, books, id)!;
            if (op == 'frontTilt') {
              final t = frontTilt(before, books, id, fs.state, fs.qx, d(args['pitch'])!);
              r = t != null ? EditResult.ok(t.layout) : const EditResult.fail('null');
              if (t != null && s['extra'] != null) {
                final e = s['extra'] as Map<String, dynamic>;
                expect(t.state.pitch, closeTo(d(e['pitch'])!, 1e-6), reason: '젖힌 각');
                expect(t.state.depth, closeTo(d(e['depth'])!, 1e-6), reason: '젖힌 깊이');
              }
            } else if (op == 'frontSpin') {
              final t = frontSpin(before, books, id, fs.state, fs.qx, d(args['spin'])!);
              r = t != null ? EditResult.ok(t.layout) : const EditResult.fail('null');
              if (t != null && s['extra'] != null) {
                final e = s['extra'] as Map<String, dynamic>;
                expect(t.state.spin, closeTo(d(e['spin'])!, 1e-6), reason: '돌린 각');
              }
            } else {
              final t = frontTilt(before, books, id, fs.state, fs.qx, d(args['pitch'])!)!;
              final out = frontRelease(t.layout, books, id, t.state, fs.qx);
              r = out != null ? EditResult.ok(out) : const EditResult.fail('null');
            }
        }
        expect(r, isNotNull, reason: '모르는 연산 $op');
        expect(r!.ok, s['ok'], reason: '성공 여부(지금 앱 까닭 ${s['reason']}, Flutter ${r.reason})');
        if (!r.ok) {
          expect(r.reason, s['reason'], reason: '실패 까닭');
          return;
        }
        final diff = diffLayout(r.layout!, s['after'] as Map<String, dynamic>);
        expect(diff, isNull, reason: '편집 결과 배치');
        // 기대기 정리(받침 잃은 책 눕히기·서랍)는 지금 앱의 결과 배치에서 걸어 견준다
        final lean = resolveLeans(layoutOf(s['after'] as Map<String, dynamic>), books);
        expect(diffLayout(lean.layout, s['leaned'] as Map<String, dynamic>), isNull, reason: '기대기 정리 뒤 배치');
        final falls = (s['falls'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as num).toInt()));
        expect(lean.falls, falls, reason: '서랍으로 떨어진 책');
        expect(extra == null || extra is SwapTarget || extra is DropTarget, isTrue);
      });
    }
  }
}
