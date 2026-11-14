// 전체 책 목록(지금 앱 features/book/all-books.ts): 등록한 모든 책(책장에 놓인 책 + 책장에 없는 책)을 검색·읽기 상태·책장에 없는 책·완독한 해로
// 거르고 정렬한다. 책 정보는 서재 한 곳에만 있고, 책장 배치는 같은 책 ID로 따로 본다. 숨긴 책(연도 책장에 남긴 책)은 목록에 없다
library;

import '../../domain/layout.dart';
import '../../domain/layout_engine.dart' show BookMap;
import '../../domain/library.dart';
import '../../domain/types.dart';

enum AllBooksSort { recent, title }

const sortLabel = {AllBooksSort.recent: '최근순', AllBooksSort.title: '제목순'};

typedef AllBooksRow = ({Book book, bool onShelf});

/// 화면에 보이는 책(숨긴 책 빼고)
Iterable<MyBook> shownBooks(Library lib) => lib.books.values.where((b) => b.hiddenAt == null);

List<AllBooksRow> listAllBooks(Library lib, BookMap books, ShelfLayout layout,
    {String q = '', ReadStatus? status, bool offShelfOnly = false, AllBooksSort sort = AllBooksSort.recent, int? year}) {
  final t = q.trim().toLowerCase();
  final rows = <AllBooksRow>[];
  for (final b in shownBooks(lib)) {
    final book = books[b.id];
    if (book == null) continue;
    final onShelf = placementOf(layout, b.id) != null;
    if (offShelfOnly && onShelf) continue;
    if (status != null && b.status != status) continue;
    if (year != null && finishedYear(lib, b.id) != year) continue;
    if (t.isNotEmpty && !'${book.title} ${book.author ?? ''}'.toLowerCase().contains(t)) continue;
    rows.add((book: book, onShelf: onShelf));
  }
  if (sort == AllBooksSort.title) {
    rows.sort((a, b) => a.book.title.compareTo(b.book.title));
  } else {
    rows.sort((a, b) {
      final c = lib.books[b.book.id]!.createdAt.compareTo(lib.books[a.book.id]!.createdAt);
      return c != 0 ? c : a.book.title.compareTo(b.book.title);
    });
  }
  return rows;
}

/// 책마다 남긴 메모(독서 기록·갈피의 메모, 최근 순)
typedef BookMemo = ({String id, String text, String at, bool bookmark});

Map<String, List<BookMemo>> memosByBook(Library lib) {
  final out = <String, List<BookMemo>>{};
  void add(String? bookId, BookMemo m) {
    if (bookId == null || m.text.isEmpty) return;
    (out[bookId] ??= []).add(m);
  }

  for (final s in lib.sessions.values) {
    add(s.myBookId, (id: s.id, text: s.memo?.trim() ?? '', at: sessionDay(s), bookmark: false));
  }
  for (final m in lib.bookmarks.values) {
    add(m.myBookId, (id: m.id, text: m.memo?.trim() ?? '', at: m.createdAt, bookmark: true));
  }
  for (final list in out.values) {
    list.sort((a, b) => b.at.compareTo(a.at));
  }
  return out;
}

/// 책을 지우면 함께 지워지는 것(갈피·읽은 기록)과 남는 것(독서 시간)
({int rounds, int marks, int sessions}) deleteSummary(Library lib, Iterable<String> ids) {
  final set = ids.toSet();
  return (
    rounds: set.fold(0, (a, id) => a + roundsOf(lib, id).length),
    marks: set.fold(0, (a, id) => a + bookmarksOf(lib, id).length),
    sessions: lib.sessions.values.where((s) => s.myBookId != null && set.contains(s.myBookId)).length,
  );
}

/// 삭제 확인 문구: 한 줄에 한 문장(함께 지워지는 것 → 남는 것 → 되돌릴 수 없음). 0개인 것은 뺀다
String deleteNote(({int rounds, int marks, int sessions}) n) {
  final gone = [if (n.marks > 0) '갈피 ${n.marks}개', if (n.rounds > 0) '읽은 기록 ${n.rounds}회'].join('와 ');
  return [if (gone.isNotEmpty) '$gone도 지워져요.', if (n.sessions > 0) '독서 시간은 통계에 남아요.', '되돌릴 수 없어요.'].join('\n');
}
