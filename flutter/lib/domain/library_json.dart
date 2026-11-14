// 서재 JSON(지금 앱 Library 모양 그대로: 백업 파일이 쓴다). 쓰기는 항목마다의 toJson, 읽기는 여기.
// { editions: {id: Edition}, books: {...}, rounds, sessions, bookmarks, bindings }
library;

import 'library.dart';

typedef Json = Map<String, Object?>;

String? _s(Object? v) => v is String ? v : null;
num? _n(Object? v) => v is num ? v : null;
Json _m(Object? v) => v is Map ? v.cast<String, Object?>() : const {};

Edition editionFromJson(Json j) {
  final size = _m(j['size']);
  final a = j['art'] is Map ? _m(j['art']) : null;
  return Edition(
    id: j['id']! as String,
    title: (j['title'] as String?) ?? '',
    authors: [for (final x in (j['authors'] as List?) ?? const []) '$x'],
    source: (j['source'] as String?) ?? 'manual',
    createdAt: (j['createdAt'] as String?) ?? (j['updatedAt'] as String?) ?? '',
    updatedAt: (j['updatedAt'] as String?) ?? '',
    isbn13: _s(j['isbn13']),
    publisher: _s(j['publisher']),
    publishedAt: _s(j['publishedAt']),
    pageCount: _n(j['pageCount']),
    widthMm: _n(size['widthMm']),
    heightMm: _n(size['heightMm']),
    coverUri: _s(j['coverUri']),
    coverSource: _s(j['coverSource']),
    category: _s(j['category']),
    seriesTitle: _s(j['seriesTitle']),
    sourceName: _s(j['sourceName']),
    productId: _s(j['productId']),
    link: _s(j['link']),
    art: a == null || _s(a['baseColor']) == null
        ? null
        : BookArtParams(
            a['baseColor']! as String,
            _s(a['inkColor']) ?? '#2F3944',
            _s(a['accentColor']) ?? a['baseColor']! as String,
            _s(a['motifId']) ?? 'leaf',
            _s(a['layoutVariant']) ?? 'spine_a',
            _s(a['heightClass']) ?? 'medium',
            _s(a['thicknessClass']) ?? 'medium',
            _s(a['generatedAt']) ?? '',
            _n(a['version']) ?? 1,
          ),
  );
}

MyBook bookFromJson(Json j) => MyBook(
      id: j['id']! as String,
      editionId: (j['editionId'] as String?) ?? '',
      status: readStatusOf((j['status'] as String?) ?? 'want'),
      createdAt: (j['createdAt'] as String?) ?? '',
      updatedAt: (j['updatedAt'] as String?) ?? '',
      rating: _n(j['rating']),
      note: _s(j['note']),
      ribbonColor: _s(j['ribbonColor']),
      currentPage: _n(j['currentPage']),
      bindingId: _s(j['bindingId']),
      hiddenAt: _s(j['hiddenAt']),
    );

Round roundFromJson(Json j) => Round(
      id: j['id']! as String,
      myBookId: (j['myBookId'] as String?) ?? '',
      index: ((j['index'] as num?) ?? 1).toInt(),
      createdAt: (j['createdAt'] as String?) ?? '',
      updatedAt: (j['updatedAt'] as String?) ?? '',
      startedAt: _s(j['startedAt']),
      finishedAt: _s(j['finishedAt']),
      paused: j['paused'] == true,
    );

Session sessionFromJson(Json j) => Session(
      id: j['id']! as String,
      startedAt: (j['startedAt'] as String?) ?? '',
      endedAt: (j['endedAt'] as String?) ?? '',
      durationMs: (j['durationMs'] as num?) ?? 0,
      createdAt: (j['createdAt'] as String?) ?? '',
      updatedAt: (j['updatedAt'] as String?) ?? '',
      myBookId: _s(j['myBookId']),
      roundId: _s(j['roundId']),
      startPage: _n(j['startPage']),
      pagesRead: _n(j['pagesRead']),
      memo: _s(j['memo']),
    );

Bookmark bookmarkFromJson(Json j) => Bookmark(
      id: j['id']! as String,
      myBookId: (j['myBookId'] as String?) ?? '',
      text: (j['text'] as String?) ?? '',
      createdAt: (j['createdAt'] as String?) ?? '',
      updatedAt: (j['updatedAt'] as String?) ?? '',
      page: _n(j['page']),
      memo: _s(j['memo']),
      photoUri: _s(j['photoUri']),
      photoRatio: _n(j['photoRatio']),
      sessionId: _s(j['sessionId']),
      savedAt: _s(j['savedAt']),
      boardX: _n(j['boardX']),
      boardY: _n(j['boardY']),
      boardRot: _n(j['boardRot']),
      boardW: _n(j['boardW']),
    );

Binding bindingFromJson(Json j) => Binding(
      id: j['id']! as String,
      myBookId: (j['myBookId'] as String?) ?? '',
      spineColor: (j['spineColor'] as String?) ?? '#8A8378',
      motif: (j['motif'] as String?) ?? 'none',
      source: (j['source'] as String?) ?? 'default',
      status: (j['status'] as String?) ?? 'ready',
      seed: (j['seed'] as num?) ?? 0,
      createdAt: (j['createdAt'] as String?) ?? '',
      updatedAt: (j['updatedAt'] as String?) ?? '',
      inkColor: _s(j['inkColor']),
      accentColor: _s(j['accentColor']),
      layout: _s(j['layout']),
      material: _s(j['material']),
      coverArtUri: _s(j['coverArtUri']),
      coverArtId: _s(j['coverArtId']),
      spineArtUri: _s(j['spineArtUri']),
    );

Json libraryToJson(Library lib) => {
      'editions': {for (final e in lib.editions.entries) e.key: e.value.toJson()},
      'books': {for (final e in lib.books.entries) e.key: e.value.toJson()},
      'rounds': {for (final e in lib.rounds.entries) e.key: e.value.toJson()},
      'sessions': {for (final e in lib.sessions.entries) e.key: e.value.toJson()},
      'bookmarks': {for (final e in lib.bookmarks.entries) e.key: e.value.toJson()},
      'bindings': {for (final e in lib.bindings.entries) e.key: e.value.toJson()},
    };

/// 초기 백업에는 나중에 생긴 기록 종류가 없을 수 있다
Library libraryFromJson(Json j) {
  Map<String, T> kind<T>(String name, T Function(Json) of) => {for (final e in _m(j[name]).entries) e.key: of(_m(e.value))};
  return Library(
    editions: kind('editions', editionFromJson),
    books: kind('books', bookFromJson),
    rounds: kind('rounds', roundFromJson),
    sessions: kind('sessions', sessionFromJson),
    bookmarks: kind('bookmarks', bookmarkFromJson),
    bindings: kind('bindings', bindingFromJson),
  );
}

/// 사진 주소만 바꾼 서재 JSON(백업: 앱 폴더 사진 → 'img:이름', 복원: 그 반대). 다른 값은 그대로
Json mapImagesJson(Json lib, String? Function(String? uri) f) {
  Json each(Object? table, List<String> keys) => {
        for (final e in _m(table).entries)
          e.key: () {
            final item = {..._m(e.value)};
            for (final k in keys) {
              final v = f(item[k] as String?);
              if (v == null) {
                item.remove(k);
              } else {
                item[k] = v;
              }
            }
            return item;
          }(),
      };
  return {
    ...lib,
    'editions': each(lib['editions'], ['coverUri']),
    'bookmarks': each(lib['bookmarks'], ['photoUri']),
    'bindings': each(lib['bindings'], ['coverArtUri', 'spineArtUri']),
  };
}
