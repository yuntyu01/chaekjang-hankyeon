// 내 서재(판본 · 내 책 · 독서 회차 · 독서 세션 · 갈피 · 장정)와 기간 통계. 지금 앱 domain/library.ts를 옮긴 것.
// toJson은 지금 앱 객체와 같은 모양(빈 선택 값은 키를 만들지 않는다): 지금 앱이 읽은 서재와 그대로 견준다(test/library_matches_app_test.dart)
library;

import 'dart:math' as math;

typedef Json = Map<String, Object?>;

void _put(Json o, String key, Object? v) {
  if (v != null) o[key] = v;
}

enum ReadStatus { want, reading, read, paused }

ReadStatus readStatusOf(String s) => ReadStatus.values.firstWhere((v) => v.name == s, orElse: () => ReadStatus.want);

/// 재장정 계산값(판본에 한 번 계산해 둔 장정)
class BookArtParams {
  const BookArtParams(this.baseColor, this.inkColor, this.accentColor, this.motifId, this.layoutVariant, this.heightClass,
      this.thicknessClass, this.generatedAt, this.version);
  final String baseColor, inkColor, accentColor, motifId, layoutVariant, heightClass, thicknessClass, generatedAt;
  final num version;

  Json toJson() => {
        'baseColor': baseColor,
        'inkColor': inkColor,
        'accentColor': accentColor,
        'motifId': motifId,
        'layoutVariant': layoutVariant,
        'heightClass': heightClass,
        'thicknessClass': thicknessClass,
        'generatedAt': generatedAt,
        'version': version,
      };
}

class Edition {
  Edition({
    required this.id,
    required this.title,
    required this.authors,
    required this.source,
    required this.createdAt,
    required this.updatedAt,
    this.isbn13,
    this.publisher,
    this.publishedAt,
    this.pageCount,
    this.widthMm,
    this.heightMm,
    this.coverUri,
    this.coverSource,
    this.category,
    this.seriesTitle,
    this.sourceName,
    this.productId,
    this.link,
    this.art,
  });
  final String id, title, source, createdAt, updatedAt;
  final List<String> authors;
  final String? isbn13, publisher, publishedAt, coverUri, coverSource, category, seriesTitle, sourceName, productId, link;
  final num? pageCount, widthMm, heightMm;
  final BookArtParams? art;

  Json toJson() {
    final e = <String, Object?>{'id': id, 'title': title, 'authors': authors, 'source': source, 'createdAt': createdAt, 'updatedAt': updatedAt};
    _put(e, 'isbn13', isbn13);
    _put(e, 'publisher', publisher);
    _put(e, 'publishedAt', publishedAt);
    _put(e, 'pageCount', pageCount);
    if (widthMm != null && heightMm != null) e['size'] = {'widthMm': widthMm, 'heightMm': heightMm};
    _put(e, 'coverUri', coverUri);
    _put(e, 'coverSource', coverSource);
    _put(e, 'category', category);
    _put(e, 'seriesTitle', seriesTitle);
    _put(e, 'sourceName', sourceName);
    _put(e, 'productId', productId);
    _put(e, 'link', link);
    if (art != null) e['art'] = art!.toJson();
    return e;
  }
}

class MyBook {
  MyBook({
    required this.id,
    required this.editionId,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.rating,
    this.note,
    this.ribbonColor,
    this.currentPage,
    this.bindingId,
    this.hiddenAt,
  });
  final String id, editionId, createdAt, updatedAt;
  final ReadStatus status;
  final num? rating, currentPage;
  final String? note, ribbonColor, bindingId, hiddenAt;

  Json toJson() {
    final b = <String, Object?>{'id': id, 'editionId': editionId, 'status': status.name, 'createdAt': createdAt, 'updatedAt': updatedAt};
    _put(b, 'rating', rating);
    _put(b, 'note', note);
    _put(b, 'ribbonColor', ribbonColor);
    _put(b, 'currentPage', currentPage);
    _put(b, 'bindingId', bindingId);
    _put(b, 'hiddenAt', hiddenAt);
    return b;
  }
}

class Round {
  Round({required this.id, required this.myBookId, required this.index, required this.createdAt, required this.updatedAt, this.startedAt, this.finishedAt, this.paused = false});
  final String id, myBookId, createdAt, updatedAt;
  final int index;

  /// YYYY-MM-DD. finishedAt이 있으면 이 회차는 완독
  final String? startedAt, finishedAt;
  final bool paused;

  Json toJson() {
    final o = <String, Object?>{'id': id, 'myBookId': myBookId, 'index': index, 'createdAt': createdAt, 'updatedAt': updatedAt};
    _put(o, 'startedAt', startedAt);
    _put(o, 'finishedAt', finishedAt);
    if (paused) o['paused'] = true;
    return o;
  }
}

class Session {
  Session({
    required this.id,
    required this.startedAt,
    required this.endedAt,
    required this.durationMs,
    required this.createdAt,
    required this.updatedAt,
    this.myBookId,
    this.roundId,
    this.startPage,
    this.pagesRead,
    this.memo,
  });
  final String id, startedAt, endedAt, createdAt, updatedAt;
  final num durationMs;
  final String? myBookId, roundId, memo;
  final num? startPage, pagesRead;

  Json toJson() {
    final s = <String, Object?>{'id': id, 'startedAt': startedAt, 'endedAt': endedAt, 'durationMs': durationMs, 'createdAt': createdAt, 'updatedAt': updatedAt};
    _put(s, 'myBookId', myBookId);
    _put(s, 'roundId', roundId);
    _put(s, 'startPage', startPage);
    _put(s, 'pagesRead', pagesRead);
    _put(s, 'memo', memo);
    return s;
  }
}

class Bookmark {
  Bookmark({
    required this.id,
    required this.myBookId,
    required this.text,
    required this.createdAt,
    required this.updatedAt,
    this.page,
    this.memo,
    this.photoUri,
    this.photoRatio,
    this.sessionId,
    this.savedAt,
    this.boardX,
    this.boardY,
    this.boardRot,
    this.boardW,
  });
  final String id, myBookId, text, createdAt, updatedAt;
  final num? page, photoRatio, boardX, boardY, boardRot, boardW;
  final String? memo, photoUri, sessionId, savedAt;

  /// 아껴둔 때를 바꾼 사본(null이면 아껴둔 표시를 뺀다)
  Bookmark withSaved(String? at, String updated) => Bookmark(
        id: id,
        myBookId: myBookId,
        text: text,
        createdAt: createdAt,
        updatedAt: updated,
        page: page,
        memo: memo,
        photoUri: photoUri,
        photoRatio: photoRatio,
        sessionId: sessionId,
        savedAt: at,
        boardX: boardX,
        boardY: boardY,
        boardRot: boardRot,
        boardW: boardW,
      );

  Json toJson() {
    final m = <String, Object?>{'id': id, 'myBookId': myBookId, 'text': text, 'createdAt': createdAt, 'updatedAt': updatedAt};
    _put(m, 'page', page);
    _put(m, 'memo', memo);
    _put(m, 'photoUri', photoUri);
    _put(m, 'photoRatio', photoRatio);
    _put(m, 'sessionId', sessionId);
    _put(m, 'savedAt', savedAt);
    _put(m, 'boardX', boardX);
    _put(m, 'boardY', boardY);
    _put(m, 'boardRot', boardRot);
    _put(m, 'boardW', boardW);
    return m;
  }
}

class Binding {
  Binding({
    required this.id,
    required this.myBookId,
    required this.spineColor,
    required this.motif,
    required this.source,
    required this.status,
    required this.seed,
    required this.createdAt,
    required this.updatedAt,
    this.inkColor,
    this.accentColor,
    this.layout,
    this.material,
    this.coverArtUri,
    this.coverArtId,
    this.spineArtUri,
  });
  final String id, myBookId, spineColor, motif, source, status, createdAt, updatedAt;
  final num seed;
  final String? inkColor, accentColor, layout, material, coverArtUri, coverArtId, spineArtUri;

  Json toJson() {
    final b = <String, Object?>{
      'id': id, 'myBookId': myBookId, 'spineColor': spineColor, 'motif': motif, 'source': source, 'status': status, 'seed': seed,
      'createdAt': createdAt, 'updatedAt': updatedAt, //
    };
    _put(b, 'inkColor', inkColor);
    _put(b, 'accentColor', accentColor);
    _put(b, 'layout', layout);
    _put(b, 'material', material);
    _put(b, 'coverArtUri', coverArtUri);
    _put(b, 'coverArtId', coverArtId);
    _put(b, 'spineArtUri', spineArtUri);
    return b;
  }
}

/// 서재 한 벌(종류마다 id → 항목)
class Library {
  Library({Map<String, Edition>? editions, Map<String, MyBook>? books, Map<String, Round>? rounds, Map<String, Session>? sessions,
      Map<String, Bookmark>? bookmarks, Map<String, Binding>? bindings})
      : editions = editions ?? {},
        books = books ?? {},
        rounds = rounds ?? {},
        sessions = sessions ?? {},
        bookmarks = bookmarks ?? {},
        bindings = bindings ?? {};
  final Map<String, Edition> editions;
  final Map<String, MyBook> books;
  final Map<String, Round> rounds;
  final Map<String, Session> sessions;
  final Map<String, Bookmark> bookmarks;
  final Map<String, Binding> bindings;

  Json toJson() => {
        'editions': {for (final e in editions.entries) e.key: e.value.toJson()},
        'books': {for (final e in books.entries) e.key: e.value.toJson()},
        'rounds': {for (final e in rounds.entries) e.key: e.value.toJson()},
        'sessions': {for (final e in sessions.entries) e.key: e.value.toJson()},
        'bookmarks': {for (final e in bookmarks.entries) e.key: e.value.toJson()},
        'bindings': {for (final e in bindings.entries) e.key: e.value.toJson()},
      };
}

// ---------- 날짜·기간 ----------
String _p2(int n) => n.toString().padLeft(2, '0');

/// 기기 현지 날짜(YYYY-MM-DD)
String today([DateTime? d]) {
  final t = (d ?? DateTime.now()).toLocal();
  return '${t.year}-${_p2(t.month)}-${_p2(t.day)}';
}

/// 기간(YYYY-MM-DD, 양끝 포함)
class Period {
  const Period(this.from, this.to);
  final String from;
  final String to;
}

Period monthPeriod(int y, int m) {
  final last = DateTime(y, m + 1, 0).day;
  return Period('$y-${_p2(m)}-01', '$y-${_p2(m)}-${_p2(last)}');
}

Period yearPeriod(int y) => Period('$y-01-01', '$y-12-31');

bool _inPeriod(String? day, Period p) => day != null && day.compareTo(p.from) >= 0 && day.compareTo(p.to) <= 0;

final _sessionDays = Expando<String>();
final _markDays = Expando<String>();

/// 세션 날짜: 기기 현지 날짜(시작 시각 기준)
String sessionDay(Session s) => _sessionDays[s] ??= today(DateTime.parse(s.startedAt));

/// 갈피 날짜: 만든 시각의 기기 현지 날짜
String bookmarkDay(Bookmark m) => _markDays[m] ??= today(DateTime.parse(m.createdAt));

/// 책의 회차들(1회차부터)
List<Round> roundsOf(Library lib, String myBookId) {
  final list = [for (final r in lib.rounds.values) if (r.myBookId == myBookId) r];
  list.sort((a, b) => a.index.compareTo(b.index));
  return list;
}

Round? currentRound(Library lib, String myBookId) {
  final r = roundsOf(lib, myBookId);
  return r.isEmpty ? null : r.last;
}

class PeriodStats {
  const PeriodStats(this.completedBooks, this.completedRounds, this.rereads, this.readMs, this.sessions, this.bookmarkCount, this.booksRead);
  final List<String> completedBooks;
  int get completedCount => completedBooks.length;
  final int completedRounds;
  final int rereads;
  final num readMs;
  final List<Session> sessions;
  final int bookmarkCount;
  final List<String> booksRead;
}

/// 기간 통계. bookId를 주면 그 책만. 완독 권수(같은 책 여러 번 완독도 1권)·완독 회차 수·재독 횟수를 따로 센다
PeriodStats periodStats(Library lib, Period p, [String? bookId]) {
  bool mine(String? id) => id != null && lib.books.containsKey(id) && (bookId == null || id == bookId);
  final finished = [for (final r in lib.rounds.values) if (_inPeriod(r.finishedAt, p) && mine(r.myBookId)) r];
  final completedBooks = <String>[];
  for (final r in finished) {
    if (!completedBooks.contains(r.myBookId)) completedBooks.add(r.myBookId);
  }
  final rereads = finished.where((r) => r.index > 1).length;
  final sessions = [
    for (final s in lib.sessions.values)
      if (_inPeriod(sessionDay(s), p) && (bookId == null || s.myBookId == bookId)) s,
  ]..sort((a, b) => b.startedAt.compareTo(a.startedAt));
  final readMs = sessions.fold<num>(0, (a, s) => a + s.durationMs);
  final bookmarks = lib.bookmarks.values.where((b) => _inPeriod(bookmarkDay(b), p) && mine(b.myBookId)).length;
  final touched = <String>[...completedBooks];
  void touch(String id) {
    if (!touched.contains(id)) touched.add(id);
  }

  for (final s in sessions) {
    if (mine(s.myBookId)) touch(s.myBookId!);
  }
  for (final r in lib.rounds.values) {
    if (!mine(r.myBookId) || r.startedAt == null) continue;
    final end = r.finishedAt ?? '9999-12-31';
    if (r.startedAt!.compareTo(p.to) <= 0 && end.compareTo(p.from) >= 0) touch(r.myBookId);
  }
  return PeriodStats(completedBooks, finished.length, rereads, readMs, sessions, bookmarks, touched);
}

/// 달력에 있는 날짜인지(YYYY-MM-DD)
bool isDay(String v) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(v);
  if (m == null) return false;
  final y = int.parse(m.group(1)!), mo = int.parse(m.group(2)!), d = int.parse(m.group(3)!);
  final t = DateTime(y, mo, d);
  return t.year == y && t.month == mo && t.day == d;
}

num bookReadMs(Library lib, String myBookId) => lib.sessions.values.fold<num>(0, (a, s) => a + (s.myBookId == myBookId ? s.durationMs : 0));

/// 책의 갈피(최근 것부터)
List<Bookmark> bookmarksOf(Library lib, String myBookId) =>
    [for (final b in lib.bookmarks.values) if (b.myBookId == myBookId) b]..sort((a, b) => b.createdAt.compareTo(a.createdAt));

int completions(Library lib, String myBookId) => roundsOf(lib, myBookId).where((r) => r.finishedAt != null).length;

/// 완독 연도(가장 최근 완독 회차의 연도)
int? finishedYear(Library lib, String myBookId) {
  final f = roundsOf(lib, myBookId).where((r) => r.finishedAt != null).toList();
  return f.isEmpty ? null : int.parse(f.last.finishedAt!.substring(0, 4));
}

/// 초까지: 20초, 1분 20초, 1시간 2분 3초
String formatDurationPrecise(num ms) {
  final t = math.max(0, (ms / 1000 + 0.5).floor());
  final h = t ~/ 3600, m = (t % 3600) ~/ 60, sec = t % 60;
  return [if (h > 0) '$h시간', if (m > 0) '$m분', if (sec > 0 || (h == 0 && m == 0)) '$sec초'].join(' ');
}

String formatDuration(num ms) {
  final m = (ms / 60000).floor();
  final h = m ~/ 60;
  if (h > 0) return '$h시간 ${m % 60}분';
  if (m > 0) return '$m분';
  return ms > 0 ? '1분 미만' : '0분';
}

/// 책 색 표(장정이 없을 때 첫 색)
const spinePalette = ['#3D5F57', '#1D426B', '#BE5D47', '#893E41', '#B5C7D7', '#F8C69F', '#E39E8A', '#4E6B60', '#F7E8D5', '#FAEDDE', '#6B5B7A', '#C9A46A'];

/// 책장 책의 책 색(지금 앱 toShelfBook themeColor): 장정 책등 색 → 판본 장정 바탕색 → 첫 색
String themeColorOf(Library lib, String myBookId) {
  final b = lib.books[myBookId];
  final bd = b?.bindingId == null ? null : lib.bindings[b!.bindingId];
  final e = b == null ? null : lib.editions[b.editionId];
  return bd?.spineColor ?? e?.art?.baseColor ?? spinePalette[0];
}
