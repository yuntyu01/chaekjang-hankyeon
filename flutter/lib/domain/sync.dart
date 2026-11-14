// 서버 동기화의 순수 규칙(지금 앱 domain/sync.ts, 네트워크·저장소와 무관). 앱 서재 항목 ↔ 서버 전송 형식, 받은 변경 병합.
// - 충돌: updatedAt이 더 새로운 쪽이 이긴다(같으면 이 기기 것을 유지). 서버도 같은 규칙이다.
// - 삭제: 지우면 삭제 표시(tombstone)를 올려 다른 기기에서도 지운다.
// - 사진: 파일 이름(앱 보관 폴더 안)을 그대로 파일 id로 쓴다 → 다른 기기에서 받으면 같은 이름으로 저장된다.
// 전송 형식은 JSON 그대로(Map). 지금 앱 JSON.stringify처럼 값이 없는 칸은 보내지 않는다
library;

import '../db/library_write.dart' show LibKind;
import '../store/library_read.dart' show bindingMaterialOf;
import 'cover_artworks.dart' show isCoverArtworkId;
import 'library.dart';
import 'rebinding.dart' show heightClassOf, thicknessClassOf;

typedef Wire = Map<String, Object?>;

/// 올릴 변경(키: "kind:id")
typedef Dirty = Map<String, ({bool deleted, String at})>;

String dirtyKey(LibKind kind, String id) => '${kind.name}:$id';

// 시각 비교는 문자열이 아니라 시각으로(서버는 ...:00Z, 앱은 ...:00.000Z로 같은 시각을 달리 적을 수 있다)
int _ms(Object? s) => s is String ? (DateTime.tryParse(s)?.millisecondsSinceEpoch ?? 0) : 0;

/// 빈 값(null·'')은 없는 것으로
T? _nz<T>(Object? v) => v == null || v == '' ? null : v as T;

String? _str(Object? v) => _nz<String>(v);
num? _num(Object? v) => _nz<num>(v);

Wire _clean(Wire w) => {
      for (final e in w.entries)
        if (e.value != null) e.key: e.value,
    };

/// 앱 보관 폴더(images/) 안의 파일이면 파일 이름이 곧 파일 id
String? fileIdOf(String? uri, String imageDir) {
  if (uri == null || !uri.startsWith(imageDir)) return null;
  final name = uri.substring(imageDir.length);
  return RegExp(r'^[A-Za-z0-9_.-]{1,80}$').hasMatch(name) ? name : null;
}

// ---------- 앱 → 서버 ----------
Wire editionToWire(Edition e, String imageDir) {
  final photo = e.coverSource == 'photo' ? fileIdOf(e.coverUri, imageDir) : null;
  final a = e.art;
  return _clean({
    'id': e.id,
    'isbn13': e.isbn13,
    'title': e.title,
    'authors': e.authors,
    'publisher': e.publisher,
    'publishedAt': e.publishedAt,
    'pageCount': e.pageCount,
    'widthMm': e.widthMm != null && e.heightMm != null ? e.widthMm : null,
    'heightMm': e.widthMm != null && e.heightMm != null ? e.heightMm : null,
    'category': e.category,
    'seriesTitle': e.seriesTitle,
    'coverUrl': e.coverSource == 'api' ? e.coverUri : null,
    'coverFileId': photo,
    'coverSource': photo != null || e.coverSource == 'api' ? e.coverSource : null,
    'source': e.source,
    'sourceName': e.sourceName,
    'productId': e.productId,
    'link': e.link,
    'art': a == null
        ? null
        : _clean({
            'baseColor': a.baseColor,
            'inkColor': a.inkColor,
            'accentColor': a.accentColor,
            'motifId': a.motifId,
            'layoutVariant': a.layoutVariant,
            'version': a.version,
            'generatedAt': a.generatedAt.isEmpty ? null : a.generatedAt,
          }),
    'createdAt': e.createdAt,
    'updatedAt': e.updatedAt,
  });
}

Wire bookToWire(MyBook b) => _clean({
      'id': b.id,
      'editionId': b.editionId,
      'status': b.status.name,
      'rating': b.rating,
      'note': b.note,
      'ribbonColor': b.ribbonColor,
      'currentPage': b.currentPage,
      'bindingId': b.bindingId,
      'hiddenAt': b.hiddenAt,
      'createdAt': b.createdAt,
      'updatedAt': b.updatedAt,
    });

Wire bindingToWire(Binding b, String imageDir) => _clean({
      'id': b.id,
      'myBookId': b.myBookId,
      'spineColor': b.spineColor,
      'inkColor': b.inkColor,
      'accentColor': b.accentColor,
      'motif': b.motif,
      'layout': b.layout,
      'material': b.material,
      'coverArtId': b.coverArtId,
      'source': b.source,
      'status': b.status,
      'seed': b.seed,
      'coverArtFileId': fileIdOf(b.coverArtUri, imageDir),
      'spineArtFileId': fileIdOf(b.spineArtUri, imageDir),
      'createdAt': b.createdAt,
      'updatedAt': b.updatedAt,
    });

Wire roundToWire(Round r) => _clean({
      'id': r.id,
      'myBookId': r.myBookId,
      'index': r.index,
      'startedAt': r.startedAt,
      'finishedAt': r.finishedAt,
      'paused': r.paused,
      'createdAt': r.createdAt,
      'updatedAt': r.updatedAt,
    });

Wire sessionToWire(Session s) => _clean({
      'id': s.id,
      'myBookId': s.myBookId,
      'roundId': s.roundId,
      'startedAt': s.startedAt,
      'endedAt': s.endedAt,
      'durationMs': s.durationMs,
      'startPage': s.startPage,
      'pagesRead': s.pagesRead,
      'memo': s.memo,
      'createdAt': s.createdAt,
      'updatedAt': s.updatedAt,
    });

Wire bookmarkToWire(Bookmark m, String imageDir) => _clean({
      'id': m.id,
      'myBookId': m.myBookId,
      'text': m.text,
      'page': m.page,
      'memo': m.memo,
      'photoFileId': fileIdOf(m.photoUri, imageDir),
      'photoRatio': m.photoRatio,
      'sessionId': m.sessionId,
      'savedAt': m.savedAt,
      'boardX': m.boardX,
      'boardY': m.boardY,
      'boardRot': m.boardRot,
      'boardW': m.boardW,
      'createdAt': m.createdAt,
      'updatedAt': m.updatedAt,
    });

/// 올릴 변경 묶음: 바뀐 항목(현재 값)과 삭제 표시. 이미 사라진 항목이 삭제도 아니면 건너뛴다. 종류 이름 → 목록
({Map<String, List<Wire>> body, int count}) buildPush(Library lib, Dirty dirty, String imageDir) {
  final body = {for (final k in LibKind.values) k.name: <Wire>[]};
  var count = 0;
  for (final e in dirty.entries) {
    final i = e.key.indexOf(':');
    final kind = LibKind.values.where((k) => k.name == e.key.substring(0, i)).firstOrNull;
    if (kind == null) continue;
    final id = e.key.substring(i + 1);
    if (e.value.deleted) {
      body[kind.name]!.add({'id': id, 'deleted': true, 'updatedAt': e.value.at});
      count++;
      continue;
    }
    final Wire? w = switch (kind) {
      LibKind.editions => lib.editions[id] == null ? null : editionToWire(lib.editions[id]!, imageDir),
      LibKind.books => lib.books[id] == null ? null : bookToWire(lib.books[id]!),
      LibKind.bindings => lib.bindings[id] == null ? null : bindingToWire(lib.bindings[id]!, imageDir),
      LibKind.rounds => lib.rounds[id] == null ? null : roundToWire(lib.rounds[id]!),
      LibKind.sessions => lib.sessions[id] == null ? null : sessionToWire(lib.sessions[id]!),
      LibKind.bookmarks => lib.bookmarks[id] == null ? null : bookmarkToWire(lib.bookmarks[id]!, imageDir),
    };
    if (w == null) continue;
    body[kind.name]!.add(w);
    count++;
  }
  return (body: body, count: count);
}

/// 서재 전체를 올릴 묶음(처음 연결하거나 참조 오류로 다시 올릴 때)
Dirty fullDirty(Library lib) => {
      for (final x in lib.editions.values) dirtyKey(LibKind.editions, x.id): (deleted: false, at: x.updatedAt),
      for (final x in lib.books.values) dirtyKey(LibKind.books, x.id): (deleted: false, at: x.updatedAt),
      for (final x in lib.rounds.values) dirtyKey(LibKind.rounds, x.id): (deleted: false, at: x.updatedAt),
      for (final x in lib.sessions.values) dirtyKey(LibKind.sessions, x.id): (deleted: false, at: x.updatedAt),
      for (final x in lib.bookmarks.values) dirtyKey(LibKind.bookmarks, x.id): (deleted: false, at: x.updatedAt),
      for (final x in lib.bindings.values) dirtyKey(LibKind.bindings, x.id): (deleted: false, at: x.updatedAt),
    };

// ---------- 서버 → 앱 ----------
String _created(Wire w) => _str(w['createdAt']) ?? w['updatedAt']! as String;

Edition editionFromWire(Wire w, String imageDir) {
  final a = w['art'] is Map ? (w['art']! as Map).cast<String, Object?>() : null;
  final width = _num(w['widthMm']), height = _num(w['heightMm']);
  final hasSize = width != null && height != null && width != 0 && height != 0;
  final coverFile = _str(w['coverFileId']);
  return Edition(
    id: w['id']! as String,
    isbn13: _str(w['isbn13']),
    title: (w['title'] as String?) ?? '',
    authors: [for (final x in (w['authors'] as List?) ?? const []) '$x'],
    publisher: _str(w['publisher']),
    publishedAt: _str(w['publishedAt']),
    pageCount: _num(w['pageCount']),
    widthMm: hasSize ? width : null,
    heightMm: hasSize ? height : null,
    category: _str(w['category']),
    seriesTitle: _str(w['seriesTitle']),
    coverUri: coverFile != null ? '$imageDir$coverFile' : _str(w['coverUrl']),
    coverSource: _str(w['coverSource']),
    source: (w['source'] as String?) ?? 'manual',
    sourceName: _str(w['sourceName']),
    productId: _str(w['productId']),
    link: _str(w['link']),
    art: a != null && _str(a['baseColor']) != null
        ? BookArtParams(
            a['baseColor']! as String,
            (a['inkColor'] as String?) ?? '#2F3944',
            (a['accentColor'] as String?) ?? a['baseColor']! as String,
            (a['motifId'] as String?) ?? 'leaf',
            (a['layoutVariant'] as String?) ?? 'spine_a',
            heightClassOf(height ?? 188),
            thicknessClassOf(_num(w['pageCount']) ?? 250),
            (a['generatedAt'] as String?) ?? '',
            (a['version'] as num?) ?? 1,
          )
        : null,
    createdAt: _created(w),
    updatedAt: w['updatedAt']! as String,
  );
}

MyBook bookFromWire(Wire w) => MyBook(
      id: w['id']! as String,
      editionId: (w['editionId'] as String?) ?? '',
      status: readStatusOf((w['status'] as String?) ?? 'want'),
      rating: _num(w['rating']),
      note: _str(w['note']),
      ribbonColor: _str(w['ribbonColor']),
      currentPage: _num(w['currentPage']),
      bindingId: _str(w['bindingId']),
      hiddenAt: _str(w['hiddenAt']),
      createdAt: _created(w),
      updatedAt: w['updatedAt']! as String,
    );

Binding bindingFromWire(Wire w, String imageDir) {
  final art = _str(w['coverArtFileId']), spine = _str(w['spineArtFileId']);
  final artId = w['coverArtId'] as String?;
  return Binding(
    id: w['id']! as String,
    myBookId: (w['myBookId'] as String?) ?? '',
    spineColor: (w['spineColor'] as String?) ?? '#8A8378',
    inkColor: _str(w['inkColor']),
    accentColor: _str(w['accentColor']),
    motif: (w['motif'] as String?) ?? 'none',
    layout: _str(w['layout']),
    material: bindingMaterialOf(w['material']),
    coverArtId: isCoverArtworkId(artId) ? artId : null,
    coverArtUri: art != null ? '$imageDir$art' : null,
    spineArtUri: spine != null ? '$imageDir$spine' : null,
    source: (w['source'] as String?) ?? 'default',
    status: (w['status'] as String?) ?? 'ready',
    seed: (w['seed'] as num?) ?? 0,
    createdAt: _created(w),
    updatedAt: w['updatedAt']! as String,
  );
}

Round roundFromWire(Wire w) => Round(
      id: w['id']! as String,
      myBookId: (w['myBookId'] as String?) ?? '',
      index: ((w['index'] as num?) ?? 1).toInt(),
      startedAt: _str(w['startedAt']),
      finishedAt: _str(w['finishedAt']),
      paused: w['paused'] == true,
      createdAt: _created(w),
      updatedAt: w['updatedAt']! as String,
    );

Session sessionFromWire(Wire w) => Session(
      id: w['id']! as String,
      myBookId: _str(w['myBookId']),
      roundId: _str(w['roundId']),
      startedAt: (w['startedAt'] as String?) ?? w['updatedAt']! as String,
      endedAt: (w['endedAt'] as String?) ?? w['updatedAt']! as String,
      durationMs: (w['durationMs'] as num?) ?? 0,
      startPage: _num(w['startPage']),
      pagesRead: _num(w['pagesRead']),
      memo: _str(w['memo']),
      createdAt: _created(w),
      updatedAt: w['updatedAt']! as String,
    );

Bookmark bookmarkFromWire(Wire w, String imageDir, [Bookmark? local]) {
  final photo = _str(w['photoFileId']);
  // 보드 자리를 모르는 옛 서버(재배포 전)의 응답은 그 칸이 아예 없다: 기기의 자리를 지운 것으로 읽지 않는다
  final keepSpot = local != null && !w.containsKey('boardX');
  final keepW = local != null && !w.containsKey('boardW');
  return Bookmark(
    id: w['id']! as String,
    myBookId: (w['myBookId'] as String?) ?? '',
    text: (w['text'] as String?) ?? '',
    page: _num(w['page']),
    memo: _str(w['memo']),
    photoUri: photo != null ? '$imageDir$photo' : null,
    photoRatio: _num(w['photoRatio']),
    sessionId: _str(w['sessionId']),
    savedAt: _str(w['savedAt']),
    boardX: keepSpot ? local.boardX : _num(w['boardX']),
    boardY: keepSpot ? local.boardY : _num(w['boardY']),
    boardRot: keepSpot ? local.boardRot : _num(w['boardRot']),
    boardW: keepW ? local.boardW : _num(w['boardW']),
    createdAt: _created(w),
    updatedAt: w['updatedAt']! as String,
  );
}

typedef Merge = ({Library lib, List<({LibKind kind, Object item, String id})> writes, List<({LibKind kind, String id})> erases, List<String> files});

/// 받은 변경을 서재에 합친다. 더 새로운 쪽이 이긴다. 받아 와야 할 사진 파일 id도 돌려준다
Merge mergeRemote(Library lib, Map<String, Object?> pull, String imageDir, [Dirty dirty = const {}]) {
  final next = Library(
    editions: {...lib.editions},
    books: {...lib.books},
    rounds: {...lib.rounds},
    sessions: {...lib.sessions},
    bookmarks: {...lib.bookmarks},
    bindings: {...lib.bindings},
  );
  final writes = <({LibKind kind, Object item, String id})>[];
  final erases = <({LibKind kind, String id})>[];
  void apply<T extends Object>(LibKind kind, Map<String, T> table, T Function(Wire w) convert, String Function(T) updatedOf) {
    for (final raw in (pull[kind.name] as List?) ?? const []) {
      final w = (raw as Map).cast<String, Object?>();
      final id = w['id']! as String;
      final pending = dirty[dirtyKey(kind, id)];
      // 로컬에서 삭제했지만 아직 올리지 않은 기록을 오래된 서버 값으로 되살리지 않는다
      if (pending != null && pending.deleted && _ms(pending.at) >= _ms(w['updatedAt'])) continue;
      final local = table[id];
      if (w['deleted'] == true) {
        if (local != null && _ms(updatedOf(local)) <= _ms(w['updatedAt'])) {
          table.remove(id);
          erases.add((kind: kind, id: id));
        }
        continue;
      }
      if (local != null && _ms(updatedOf(local)) >= _ms(w['updatedAt'])) continue;
      final item = convert(w);
      table[id] = item;
      writes.add((kind: kind, item: item, id: id));
    }
  }

  apply<Edition>(LibKind.editions, next.editions, (w) => editionFromWire(w, imageDir), (x) => x.updatedAt);
  apply<MyBook>(LibKind.books, next.books, bookFromWire, (x) => x.updatedAt);
  apply<Binding>(LibKind.bindings, next.bindings, (w) => bindingFromWire(w, imageDir), (x) => x.updatedAt);
  apply<Round>(LibKind.rounds, next.rounds, roundFromWire, (x) => x.updatedAt);
  apply<Session>(LibKind.sessions, next.sessions, sessionFromWire, (x) => x.updatedAt);
  apply<Bookmark>(LibKind.bookmarks, next.bookmarks, (w) => bookmarkFromWire(w, imageDir, lib.bookmarks[w['id']]), (x) => x.updatedAt);
  final files = <String>{};
  for (final w in writes) {
    final it = w.item;
    final uris = switch (it) {
      Bookmark m => [m.photoUri],
      Edition e => [e.coverUri],
      Binding b => [b.coverArtUri, b.spineArtUri],
      _ => const <String?>[],
    };
    for (final u in uris) {
      final id = fileIdOf(u, imageDir);
      if (id != null) files.add(id);
    }
  }
  return (lib: next, writes: writes, erases: erases, files: files.toList());
}
