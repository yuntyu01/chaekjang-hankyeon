// 서재가 비어 있으면 보기 책을 넣는다(이식 중 화면을 보려고. 지금 앱의 예시 책장과 같은 성격이다).
// 지금 앱 DB를 그대로 읽게 되면 이 파일은 지운다
library;

import '../db/local_db.dart';

const _titles = [
  ('느린 계절', '김해나', 320, 128, 188),
  ('여름의 숲', '이도현', 268, 152, 210),
  ('어린 왕자', '생텍쥐페리', 144, 120, 180),
  ('문장 수집', '박서윤', 412, 130, 190),
  ('아주 보통의 하루', '최민서', 288, 128, 188),
  ('좋은 문장은 이렇게 온다', '정유안', 356, 148, 205),
  ('찰나의 마음', '한지우', 232, 125, 182),
  ('고요한 우연', '임세진', 304, 130, 188),
  ('아무튼, 독서', '서지현', 180, 120, 178),
  ('너라는 계절', '오하늘', 260, 135, 195),
  ('빛의 속도로 갈 수 없다면', '김초희', 440, 140, 200),
  ('아침의 문장', '배수아', 210, 125, 185),
];

const _colors = ['#2F4B7C', '#B4472F', '#6B8E5A', '#8F6E55', '#4A5D7E', '#C4785A'];

/// 줄 수와 줄마다 책 수
const _layout = [0, 5, 4, 4, 7, 4];

Future<void> seedIfEmpty() async {
  final db = await openLibrary();
  final n = (await db.rawQuery('SELECT COUNT(*) c FROM my_books')).first['c'] as int? ?? 0;
  if (n > 0) return;
  final now = DateTime.now().toIso8601String();
  await db.transaction((t) async {
    var book = 0;
    for (var s = 0; s < _layout.length; s++) {
      final shelfId = 'shelf-$s';
      await t.insert('shelves', {'id': shelfId, 'position': s});
      for (var i = 0; i < _layout[s]; i++) {
        final (title, author, pages, wmm, hmm) = _titles[book % _titles.length];
        final eid = 'e$book';
        final bid = 'b$book';
        final gid = 'g$book';
        await t.insert('editions', {
          'id': eid, 'title': title, 'page_count': pages, 'width_mm': wmm, 'height_mm': hmm,
          'source': 'seed', 'created_at': now, 'updated_at': now,
        });
        await t.insert('edition_authors', {'edition_id': eid, 'position': 0, 'name': author});
        await t.insert('bindings', {
          'id': gid, 'my_book_id': bid, 'spine_color': _colors[book % _colors.length], 'motif': 'plain',
          'source': 'seed', 'status': 'ready', 'seed': book, 'created_at': now, 'updated_at': now,
        });
        await t.insert('my_books', {
          'id': bid, 'edition_id': eid, 'status': 'owned', 'binding_id': gid,
          'created_at': now, 'updated_at': now,
        });
        await t.insert('shelf_placements', {
          'book_id': bid, 'shelf_id': shelfId, 'position': i, 'pose': 'upright',
          // 줄마다 마지막 책은 기대어 둔다
          'lean_angle': i == _layout[s] - 1 ? -8 : null,
        });
        book++;
      }
    }
  });
}
