// 연도 책장(지금 앱 domain/bookcase.ts): 해가 바뀔 때 그해 책장을 한 벌 남긴다(2026-11-06 사용자 계획: 2026 → 2027이 되면 2026 책장을 고정).
// 남기는 것: 책장 구조(선반 순서, 책 자리·자세 그대로), 책마다 덮어쓰는 값(상태·별점·한 줄 감상·갈피 색·읽은 쪽)과 그때 장정(줄을 복사해 새 id로).
// 남기지 않는 것: 판본·회차·독서 기록·갈피. 원래 표에서 그해 날짜로 고른다(bookcaseLibrary). 연도 책장에 있는 책을 지우면 숨긴다.
// 언제: 서재를 마지막으로 손댄 해가 올해보다 앞이고 그해 책장이 아직 없을 때(yearToArchive). 연도는 기기 현지 시각으로 센다.
// 한 사용자에 한 해 한 벌: id는 해로 정한다(bookcaseIdOf)
library;

import 'library.dart';
import 'layout.dart' show ShelfLayout;
import 'types.dart';

class BookcaseBook {
  const BookcaseBook({required this.bookId, required this.status, this.bindingId, this.rating, this.note, this.ribbonColor, this.currentPage});
  final String bookId;
  final String? bindingId; // 그해 장정(복사본) id
  final ReadStatus status;
  final num? rating, currentPage;
  final String? note, ribbonColor;

  @override
  bool operator ==(Object other) =>
      other is BookcaseBook &&
      other.bookId == bookId &&
      other.bindingId == bindingId &&
      other.status == status &&
      other.rating == rating &&
      other.note == note &&
      other.ribbonColor == ribbonColor &&
      other.currentPage == currentPage;

  @override
  int get hashCode => Object.hash(bookId, bindingId, status, rating, note, ribbonColor, currentPage);

  @override
  String toString() => 'BookcaseBook($bookId, $bindingId, ${status.name}, $rating, $note, $ribbonColor, $currentPage)';
}

class Bookcase {
  const Bookcase({required this.id, required this.year, required this.createdAt, required this.updatedAt, required this.layout, required this.books});
  final String id;
  final int year;
  final String createdAt, updatedAt;
  final ShelfLayout layout;
  final List<BookcaseBook> books; // 그때 서재에 있던 책(선반·서랍 모두)
}

String bookcaseIdOf(int year) => 'bc-$year';

/// 그해 장정 복사본 id: 해와 책으로 정한다(두 기기가 같은 해를 남겨도 줄이 늘지 않는다)
String archivedBindingId(String bookcaseId, String bookId) => '$bookcaseId-$bookId';

/// 서재를 마지막으로 손댄 해(기기 현지): 서재 항목과 배치의 마지막 시각 중 가장 늦은 것. 없으면 null.
/// 미래 시각(기기 시계가 틀렸던 기록)은 세지 않는다
int? lastActiveYear(Library lib, String? layoutAt, DateTime now) {
  DateTime? latest;
  void see(String? iso) {
    final t = iso == null ? null : DateTime.tryParse(iso);
    if (t == null || t.isAfter(now)) return;
    if (latest == null || t.isAfter(latest!)) latest = t;
  }

  see(layoutAt);
  for (final e in lib.editions.values) {
    see(e.updatedAt);
  }
  for (final b in lib.books.values) {
    see(b.updatedAt);
  }
  for (final r in lib.rounds.values) {
    see(r.updatedAt);
  }
  for (final s in lib.sessions.values) {
    see(s.updatedAt);
  }
  for (final m in lib.bookmarks.values) {
    see(m.updatedAt);
  }
  for (final b in lib.bindings.values) {
    see(b.updatedAt);
  }
  return latest?.toLocal().year;
}

/// 지금 남겨야 할 해. 마지막으로 손댄 해가 올해보다 앞이고, 그해 책장이 없고, 남길 책이 있을 때만
int? yearToArchive(Library lib, String? layoutAt, List<int> existingYears, DateTime now) {
  final year = lastActiveYear(lib, layoutAt, now);
  if (year == null || year >= now.year || existingYears.contains(year)) return null;
  return lib.books.values.any((b) => b.hiddenAt == null) ? year : null;
}

/// 지금 서재·배치로 그해 책장을 만든다. skip: 남기지 않을 책(손대지 않은 예시 책 등). 숨긴 책은 넣지 않는다.
/// 배치에서 서재에 없는 책(표시 전용 예시)과 없는 선반의 자리는 뺀다. 장정 복사본의 시각은 원래 장정 시각 그대로
({Bookcase bookcase, List<Binding> bindings}) snapshotBookcase(Library lib, ShelfLayout layout, int year, String now, [Set<String> skip = const {}]) {
  final id = bookcaseIdOf(year);
  final mine = [for (final b in lib.books.values) if (b.hiddenAt == null && !skip.contains(b.id)) b]..sort((a, b) {
      final c = a.createdAt.compareTo(b.createdAt);
      return c != 0 ? c : a.id.compareTo(b.id);
    });
  final bindings = <Binding>[];
  final books = <BookcaseBook>[];
  for (final b in mine) {
    final bd = b.bindingId == null ? null : lib.bindings[b.bindingId];
    String? bindingId;
    if (bd != null) {
      bindingId = archivedBindingId(id, b.id);
      bindings.add(bd.copyAs(bindingId, b.id));
    }
    final note = b.note;
    final ribbon = b.ribbonColor;
    books.add(BookcaseBook(
      bookId: b.id,
      status: b.status,
      bindingId: bindingId,
      rating: b.rating,
      note: note == null || note.isEmpty ? null : note,
      ribbonColor: ribbon == null || ribbon.isEmpty ? null : ribbon,
      currentPage: b.currentPage,
    ));
  }
  final known = {for (final b in books) b.bookId};
  final shelves = {for (final s in layout.shelves) s.id};
  final placed = <String>{};
  final placements = <BookPlacement>[];
  for (final p in layout.placements) {
    if (!known.contains(p.bookId) || !shelves.contains(p.shelfId) || placed.contains(p.bookId)) continue;
    placed.add(p.bookId);
    placements.add(p);
  }
  final drawer = <String>[];
  for (final b in layout.drawer) {
    if (known.contains(b) && placed.add(b)) drawer.add(b);
  }
  return (
    bookcase: Bookcase(id: id, year: year, createdAt: now, updatedAt: now, layout: ShelfLayout([for (final s in layout.shelves) Shelf(s.id, s.position)], placements, drawer), books: books),
    bindings: bindings,
  );
}

/// 그 책이 들어 있는 연도 책장의 해(오래된 순)
List<int> archivedYearsOf(List<Bookcase> bookcases, String bookId) =>
    [for (final c in bookcases) if (c.books.any((b) => b.bookId == bookId)) c.year]..sort();

/// 연도 책장을 볼 서재. full은 숨긴 책까지 든 서재.
/// 책은 그때 값(상태·별점·한 줄 감상·갈피 색·쪽·장정), 판본·장정 줄은 지금 서재에서, 회차·독서 기록·갈피는 그해가 끝나기 전에 만든 것만.
/// 그해 뒤에 끝낸 회차는 끝나지 않은 것으로 본다(그때 상태와 맞게)
Library bookcaseLibrary(Library full, Bookcase c) {
  final end = DateTime(c.year + 1);
  final lastDay = '${c.year}-12-31';
  bool before(String? iso) {
    final t = iso == null ? null : DateTime.tryParse(iso);
    return t != null && t.isBefore(end);
  }

  final lib = Library();
  for (final e in c.books) {
    final base = full.books[e.bookId];
    if (base == null) continue;
    final b = base.asOf(status: e.status, rating: e.rating, note: e.note, ribbonColor: e.ribbonColor, currentPage: e.currentPage, bindingId: e.bindingId);
    lib.books[b.id] = b;
    final ed = full.editions[b.editionId];
    if (ed != null) lib.editions[ed.id] = ed;
    final bd = e.bindingId == null ? null : full.bindings[e.bindingId];
    if (bd != null) lib.bindings[bd.id] = bd;
  }
  for (final r in full.rounds.values) {
    if (!lib.books.containsKey(r.myBookId) || !before(r.createdAt)) continue;
    final f = r.finishedAt;
    lib.rounds[r.id] = f != null && f.compareTo(lastDay) > 0 ? r.copyWith(finishedAt: null, updatedAt: r.updatedAt) : r;
  }
  for (final s in full.sessions.values) {
    if (s.myBookId != null && lib.books.containsKey(s.myBookId) && before(s.startedAt)) lib.sessions[s.id] = s;
  }
  for (final m in full.bookmarks.values) {
    if (lib.books.containsKey(m.myBookId) && before(m.createdAt)) lib.bookmarks[m.id] = m;
  }
  return lib;
}
