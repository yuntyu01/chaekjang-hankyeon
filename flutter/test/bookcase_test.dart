// 지금 앱 domain/__tests__/bookcase.test.ts와 같은 시험(전송 형식은 동기화를 옮길 때)
import 'package:chaekjang/domain/bookcase.dart';
import 'package:chaekjang/domain/layout.dart' show ShelfLayout;
import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/domain/types.dart';
import 'package:flutter_test/flutter_test.dart';

// 기기 현지 시각으로 센다: 시험도 현지 시각으로 만든다
String local(int y, int m, int d, [int h = 12]) => DateTime(y, m, d, h).toUtc().toIso8601String();

MyBook book(String id, {num? rating, String? note, String? ribbonColor, num? currentPage, String? updatedAt, String? hiddenAt}) => MyBook(
      id: id,
      editionId: 'ed-$id',
      status: ReadStatus.read,
      bindingId: 'bd-$id',
      createdAt: local(2026, 3, 1),
      updatedAt: updatedAt ?? local(2026, 3, 1),
      rating: rating,
      note: note,
      ribbonColor: ribbonColor,
      currentPage: currentPage,
      hiddenAt: hiddenAt,
    );

Binding binding(String id, String bookId, String color, [String? at]) =>
    Binding(id: id, myBookId: bookId, spineColor: color, motif: 'none', source: 'default', status: 'ready', seed: 0, createdAt: at ?? local(2026, 3, 1), updatedAt: at ?? local(2026, 3, 1));

Library library() {
  final lib = Library();
  for (final id in ['a', 'b', 'c']) {
    lib.books[id] = book(id);
    lib.editions['ed-$id'] = Edition(id: 'ed-$id', title: id, authors: const [], source: 'manual', createdAt: local(2026, 3, 1), updatedAt: local(2026, 3, 1));
    lib.bindings['bd-$id'] = binding('bd-$id', id, '#111111');
  }
  lib.books['a'] = book('a', rating: 5, note: '한 줄 감상', ribbonColor: '#7B4497', currentPage: 120, updatedAt: local(2026, 12, 30));
  return lib;
}

const layout = ShelfLayout(
  [Shelf('s1', 0), Shelf('s2', 1)],
  [
    BookPlacement(bookId: 'a', shelfId: 's1', order: 0, tilt: 7, leanAngle: 4, leanOn: '#wall-l'),
    BookPlacement(bookId: 'sample', shelfId: 's1', order: 1, pose: Pose.front), // 서재에 없는 표시 전용 책
    BookPlacement(bookId: 'b', shelfId: 'gone', order: 0), // 없는 선반
    BookPlacement(bookId: 'a', shelfId: 's2', order: 0), // 두 번
  ],
  ['c', 'b', 'sample'],
);

void main() {
  group('언제 남기나', () {
    test('마지막으로 손댄 해가 올해보다 앞이고 그해 책장이 없으면 그해', () {
      final lib = library();
      expect(lastActiveYear(lib, local(2026, 12, 31, 23), DateTime(2027, 1, 1, 0, 1)), 2026);
      expect(yearToArchive(lib, local(2026, 12, 31, 23), const [], DateTime(2027, 1, 1, 0, 1)), 2026);
      // 1월 중순에 처음 켜도, 몇 해를 건너뛰어도 마지막으로 쓴 해
      expect(yearToArchive(lib, null, const [], DateTime(2027, 1, 15)), 2026);
      expect(yearToArchive(lib, null, const [], DateTime(2028, 6, 1)), 2026);
    });
    test('이미 있거나, 올해 손댔거나, 책이 없으면 남기지 않는다', () {
      final lib = library();
      expect(yearToArchive(lib, null, const [2026], DateTime(2027, 1, 2)), isNull);
      expect(yearToArchive(lib, local(2027, 1, 1, 1), const [], DateTime(2027, 1, 2)), isNull);
      expect(yearToArchive(lib, null, const [], DateTime(2026, 12, 31, 23)), isNull); // 아직 그해
      expect(yearToArchive(Library(), local(2026, 6, 1), const [], DateTime(2027, 1, 2)), isNull);
      final onlyHidden = library();
      for (final id in onlyHidden.books.keys.toList()) {
        onlyHidden.books[id] = book(id, hiddenAt: local(2026, 5, 1));
      }
      expect(yearToArchive(onlyHidden, null, const [], DateTime(2027, 1, 2)), isNull);
    });
    test('미래 시각(틀린 기기 시계로 남은 기록)은 마지막 시각으로 세지 않는다', () {
      final lib = library();
      final at = local(2030, 1, 1);
      lib.sessions['s'] = Session(id: 's', startedAt: at, endedAt: at, durationMs: 1, createdAt: at, updatedAt: at);
      expect(yearToArchive(lib, null, const [], DateTime(2027, 1, 2)), 2026);
    });
  });

  group('무엇을 남기나', () {
    test('책마다 덮어쓰는 값과 그때 장정(복사본), 배치 구조를 남긴다', () {
      final lib = library();
      lib.books['c'] = book('c', hiddenAt: local(2026, 8, 1)); // 이미 숨긴 책은 넣지 않는다
      final r = snapshotBookcase(lib, layout, 2026, local(2027, 1, 1, 0));
      expect(r.bookcase.id, 'bc-2026');
      expect(r.bookcase.books, [
        const BookcaseBook(bookId: 'a', bindingId: 'bc-2026-a', status: ReadStatus.read, rating: 5, note: '한 줄 감상', ribbonColor: '#7B4497', currentPage: 120),
        const BookcaseBook(bookId: 'b', bindingId: 'bc-2026-b', status: ReadStatus.read),
      ]);
      // 복사본: 새 id, 같은 책, 같은 모습, 원래 시각
      expect([for (final b in r.bindings) (b.id, b.myBookId, b.spineColor, b.updatedAt)], [('bc-2026-a', 'a', '#111111', local(2026, 3, 1)), ('bc-2026-b', 'b', '#111111', local(2026, 3, 1))]);
      // 서재에 없는 책·없는 선반·두 번 나온 자리는 빼고, 선반은 그대로
      final l = r.bookcase.layout;
      expect([for (final s in l.shelves) (s.id, s.position)], [('s1', 0), ('s2', 1)]);
      expect([for (final p in l.placements) (p.bookId, p.shelfId, p.order, p.tilt, p.leanAngle, p.leanOn)], [('a', 's1', 0, 7, 4.0, '#wall-l')]);
      expect(l.drawer, ['b']);
    });
    test('남기지 않을 책(손대지 않은 예시 책)은 뺀다', () {
      final r = snapshotBookcase(library(), layout, 2026, local(2027, 1, 1, 0), {'b'});
      expect([for (final b in r.bookcase.books) b.bookId], ['a', 'c']);
      expect(r.bookcase.layout.drawer, ['c']);
    });
  });

  test('연도 책장으로 볼 서재: 나중에 바꾼 한 줄 감상·장정은 그때 값으로, 갈피·기록은 그해 것만', () {
    final lib = library();
    final r = snapshotBookcase(lib, layout, 2026, local(2027, 1, 1, 0));
    for (final b in r.bindings) {
      lib.bindings[b.id] = b;
    }
    // 2027년: 감상을 고치고 장정을 바꾸고 지운(숨긴) 책
    lib.books['a'] = MyBook(id: 'a', editionId: 'ed-a', status: ReadStatus.reading, bindingId: 'bd-a', createdAt: local(2026, 3, 1), updatedAt: local(2027, 2, 1), rating: 3, note: '다시 읽고 바꾼 감상');
    lib.bindings['bd-a'] = binding('bd-a', 'a', '#FF0000', local(2027, 2, 1));
    lib.books['b'] = book('b', hiddenAt: local(2027, 2, 2));
    Bookmark mark(String id, String at) => Bookmark(id: id, myBookId: 'a', text: id, createdAt: at, updatedAt: at);
    lib.bookmarks['m1'] = mark('m1', local(2026, 12, 31, 23));
    lib.bookmarks['m2'] = mark('m2', local(2027, 1, 1, 0));
    Session session(String id, String at) => Session(id: id, myBookId: 'a', startedAt: at, endedAt: at, durationMs: 60000, memo: id, createdAt: at, updatedAt: at);
    lib.sessions['s1'] = session('s1', local(2026, 6, 1));
    lib.sessions['s2'] = session('s2', local(2027, 3, 1));
    Round round(String id, String created, [String? finishedAt]) =>
        Round(id: id, myBookId: 'a', index: 1, startedAt: created.substring(0, 10), finishedAt: finishedAt, createdAt: created, updatedAt: created);
    lib.rounds['r1'] = round('r1', local(2026, 5, 1), '2027-01-03');
    lib.rounds['r2'] = round('r2', local(2027, 1, 5));

    final view = bookcaseLibrary(lib, r.bookcase);
    final a = view.books['a']!;
    expect([a.note, a.rating, a.status, a.bindingId], ['한 줄 감상', 5, ReadStatus.read, 'bc-2026-a']);
    expect(view.bindings[a.bindingId]!.spineColor, '#111111');
    expect(view.books['b'], isNotNull);
    expect(view.books['b']!.hiddenAt, isNull);
    expect(view.bookmarks.keys.toList(), ['m1']);
    expect(view.sessions.keys.toList(), ['s1']);
    expect(view.rounds.keys.toList(), ['r1']);
    expect(view.rounds['r1']!.finishedAt, isNull); // 그해에는 아직 읽는 중이었다
  });
}
