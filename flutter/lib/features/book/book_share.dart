// 책 공유 카드의 내용(지금 앱 features/book/book-share.ts, 그리기와 따로 시험한다): 제목·저자·한 줄 감상·별점·독서 시간·읽은 기간
// (읽기 상태는 2026-11-10 시안부터 카드에 넣지 않는다)
library;

import '../../domain/library.dart';
import '../../domain/types.dart';
import '../share/share_scene.dart' show ShareSceneInput;

typedef ShareParts = ({bool note, bool rating, bool time, bool period});

/// 처음 고른 것(2026-11-10 시안: 한 줄 감상과 별점만). 독서 시간·읽은 기간은 칩으로 더한다
const defaultParts = (note: true, rating: true, time: false, period: false);

class BookShareData {
  const BookShareData({required this.id, required this.book, required this.title, this.author, this.note, this.rating, this.readTime, this.period});
  final String id, title;
  final Book book;
  final String? author, note, readTime, period;
  final num? rating;

  BookShareData withNote(String? n) => BookShareData(id: id, book: book, title: title, author: author, note: n, rating: rating, readTime: readTime, period: period);
}

String _dot(String d) => d.substring(0, 10).replaceAll('-', '.');

/// 읽은 기간: 첫 회차 시작 — 마지막 완독(같은 해면 끝은 월.일만). 읽는 중이면 '부터', 시작일 없이 완독만 있으면 완독일
String? readPeriod([String? start, String? end, bool reading = false]) {
  if (start != null && end != null) return '${_dot(start)} — ${end.substring(0, 4) == start.substring(0, 4) ? _dot(end).substring(5) : _dot(end)}';
  if (start != null) return reading ? '${_dot(start)}부터' : _dot(start);
  if (end != null) return '${_dot(end)} 완독';
  return null;
}

/// 책장에 놓인 모습(book)으로 그린다
BookShareData? bookShareData(Library lib, String id, Book? book) {
  final b = lib.books[id];
  final e = b == null ? null : lib.editions[b.editionId];
  if (b == null || e == null || book == null) return null;
  final rounds = roundsOf(lib, id);
  final start = rounds.where((r) => r.startedAt != null).firstOrNull?.startedAt;
  final end = rounds.reversed.where((r) => r.finishedAt != null).firstOrNull?.finishedAt;
  final ms = bookReadMs(lib, id);
  final note = b.note?.trim();
  return BookShareData(
    id: id,
    book: book,
    title: e.title,
    author: e.authors.isEmpty ? null : e.authors.join(', '),
    note: note == null || note.isEmpty ? null : note,
    rating: b.rating,
    readTime: ms >= 60000 ? formatDuration(ms) : null,
    period: readPeriod(start, b.status == ReadStatus.read ? end : null, b.status == ReadStatus.reading) ?? (end != null ? readPeriod(null, end) : null),
  );
}

/// 카드에 넣을 내용(고른 것만). 표지 비율·두께는 책장에 그리는 책과 같은 값
ShareSceneInput shareInputOf(BookShareData d, ShareParts parts) {
  final b = d.book;
  final h = b.dims?.height;
  return ShareSceneInput(
    title: d.title,
    author: d.author,
    note: parts.note ? d.note : null,
    rating: parts.rating && d.rating != null && d.rating != 0 ? d.rating : null,
    extra: [if (parts.time && d.readTime != null) d.readTime!, if (parts.period && d.period != null) d.period!],
    coverAspect: b.coverAspectRatio > 0 ? b.coverAspectRatio : (b.dims != null && h! > 0 ? b.dims!.coverWidth / h : 0.68),
    thicknessRatio: b.dims != null && h! > 0 ? b.dims!.thickness / h : null,
    coverColor: b.themeColor,
  );
}
