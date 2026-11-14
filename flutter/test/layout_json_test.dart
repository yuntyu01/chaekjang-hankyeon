// 배치·연도 책장 JSON(지금 앱 ShelfLayout v2·서버 전송 형식)
import 'dart:convert';

import 'package:chaekjang/domain/bookcase.dart';
import 'package:chaekjang/domain/layout.dart' show ShelfLayout;
import 'package:chaekjang/domain/layout_json.dart';
import 'package:chaekjang/domain/library.dart' show ReadStatus;
import 'package:chaekjang/domain/types.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const l = ShelfLayout(
    [Shelf('s1', 0), Shelf('s2', 1)],
    [
      BookPlacement(bookId: 'a', shelfId: 's1', order: 0, tilt: 7, leanAngle: 4, leanOn: '#wall-l', leanSlide: 1.5, depth: -3, spin: 12),
      BookPlacement(bookId: 'b', shelfId: 's1', order: 1, pose: Pose.front, pitch: 8, flip: true),
      BookPlacement(bookId: 'c', shelfId: 's2', order: 0, pose: Pose.horizontal, stackId: 'k', stackOrder: 0, stackDx: 2, stackDz: -1, wallLean: true, overhang: true, pos: 30),
    ],
    ['d'],
  );

  test('지금 앱 모양(spine·lean{angle,on,slide}·있는 칸만)으로 쓰고 같은 값으로 읽는다', () {
    final m = jsonDecode(layoutToJson(l)) as Map;
    expect(m['version'], 2);
    expect(m['shelves'], [
      {'id': 's1', 'order': 0},
      {'id': 's2', 'order': 1},
    ]);
    final p0 = (m['placements'] as List)[0] as Map;
    expect(p0['pose'], 'spine');
    expect(p0['lean'], {'angle': 4.0, 'on': '#wall-l', 'slide': 1.5});
    expect(p0.containsKey('flip'), isFalse);
    final back = layoutFromJson(layoutToJson(l))!;
    expect(layoutToJson(back), layoutToJson(l));
    expect(back.drawer, ['d']);
    expect(layoutFromJson('{"version":1}'), isNull);
    expect(layoutFromJson('깨짐'), isNull);
  });

  test('연도 책장 전송 형식으로 오가도 같고, 모르는 상태·빈 id는 버린다', () {
    const c = Bookcase(id: 'bc-2025', year: 2025, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', layout: l, books: [
      BookcaseBook(bookId: 'a', status: ReadStatus.read, bindingId: 'bc-2025-a', rating: 4.5, note: '좋았다'),
      BookcaseBook(bookId: 'b', status: ReadStatus.want),
    ]);
    final wire = jsonDecode(jsonEncode(bookcaseToWire(c))) as Map<String, Object?>;
    final back = bookcaseFromWire(wire)!;
    expect([back.id, back.year, back.books], [c.id, c.year, c.books]);
    expect(layoutToJson(back.layout), layoutToJson(l));
    final bad = {...wire, 'books': [{'bookId': 'x', 'status': 'lost'}, ...(wire['books']! as List)]};
    expect(bookcaseFromWire(bad)!.books, c.books);
    expect(bookcaseFromWire({...wire, 'id': ''}), isNull);
  });
}
