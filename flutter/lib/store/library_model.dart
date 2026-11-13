// 서재 한 벌을 화면들이 함께 본다(지금 앱 store/library-store.ts의 읽기·고치기 일부).
// 고치면 화면은 바로 바뀌고, 항목 행과 동기화 대기 기록은 한 트랜잭션으로 차례대로 저장한다(누른 순서대로)
library;

import 'package:flutter/foundation.dart';

import '../db/library_write.dart';
import '../domain/color.dart';
import '../domain/cover_url.dart';
import '../domain/library.dart';
import '../domain/reading.dart';
import 'library_read.dart';
import 'seed.dart';

const Object _keep = Object();

class LibraryModel extends ChangeNotifier {
  LibraryModel._();
  static final instance = LibraryModel._();

  Library lib = Library();
  bool loaded = false;
  Object? error;
  Future<void>? _loading;
  Future<void> _writes = Future.value();

  // 예시 서재(빈 서재에만 넣는다)를 다 넣은 뒤에 읽는다
  Future<void> load() => _loading ??= seedIfEmpty().then((_) => loadFullLibrary()).then((l) {
        lib = l;
        loaded = true;
        notifyListeners();
      });

  /// 다시 읽기(다른 곳에서 DB를 바꾼 뒤)
  Future<void> reload() {
    _loading = null;
    return load();
  }

  Future<void> _commit(Library next, List<LocalChange> changes) {
    lib = next;
    notifyListeners();
    final w = _writes.catchError((_) {}).then((_) => applyLocalChanges(changes));
    _writes = w.then((_) => error = null, onError: (Object e) {
      error = e;
      notifyListeners();
      throw e;
    });
    return _writes;
  }

  Library _withBookmarks(Map<String, Bookmark> bookmarks) =>
      Library(editions: lib.editions, books: lib.books, rounds: lib.rounds, sessions: lib.sessions, bookmarks: bookmarks, bindings: lib.bindings);

  /// 아껴둔 갈피(아껴둔 순서)
  List<String> get savedIds => ([for (final m in lib.bookmarks.values) if (m.savedAt != null) m]..sort((a, b) => a.savedAt!.compareTo(b.savedAt!))).map((m) => m.id).toList();

  /// 바뀐 항목만 골라 저장할 변경으로(지금 앱 commit의 비교와 같다: 같은 객체면 그대로)
  List<LocalChange> _diff(Library next, String at) {
    final out = <LocalChange>[];
    void kind<T extends Object>(LibKind k, Map<String, T> a, Map<String, T> b, String Function(T) updated) {
      for (final e in b.entries) {
        if (!identical(a[e.key], e.value)) out.add(LocalChange.put(k, e.key, e.value, updated(e.value)));
      }
      for (final id in a.keys) {
        if (!b.containsKey(id)) out.add(LocalChange.delete(k, id, at));
      }
    }

    kind<Edition>(LibKind.editions, lib.editions, next.editions, (x) => x.updatedAt);
    kind<MyBook>(LibKind.books, lib.books, next.books, (x) => x.updatedAt);
    kind<Round>(LibKind.rounds, lib.rounds, next.rounds, (x) => x.updatedAt);
    kind<Session>(LibKind.sessions, lib.sessions, next.sessions, (x) => x.updatedAt);
    kind<Bookmark>(LibKind.bookmarks, lib.bookmarks, next.bookmarks, (x) => x.updatedAt);
    kind<Binding>(LibKind.bindings, lib.bindings, next.bindings, (x) => x.updatedAt);
    return out;
  }

  /// 새 서재로 바꾸고 바뀐 항목을 저장한다
  Future<void> commitLib(Library next) {
    final changes = _diff(next, nowIso());
    if (changes.isEmpty) return Future.value();
    return _commit(next, changes);
  }

  /// 독서 기록 저장(회차 확보·쪽 옮기기 포함). 같은 id로 다시 저장해도 하나.
  /// 서재를 다 읽은 뒤에 계산한다(읽기 전이면 책이 없는 것으로 보여 책 연결이 빠진다)
  Future<String> addSession(SessionInput input) async {
    await load();
    final r = addSessionTo(lib, input, nowIso());
    await commitLib(r.lib);
    return r.id;
  }

  /// 책 고치기(별점·한 줄 감상·현재 쪽·갈피 색). null을 주면 비운다
  Future<void> updateBook(String id, {Object? rating = _keep, Object? note = _keep, Object? currentPage = _keep, Object? ribbonColor = _keep}) {
    final b = lib.books[id];
    if (b == null) return Future.value();
    final next = b.patch(rating: rating, note: note, currentPage: currentPage, ribbonColor: ribbonColor, updatedAt: nowIso());
    return commitLib(lib.copy(books: {...lib.books, id: next}));
  }

  /// 읽기 상태 바꾸기(같은 상태면 그대로)
  Future<void> setStatus(String id, ReadStatus status) => commitLib(applyStatus(lib, id, status, nowIso()));

  /// 다시 읽기: 지난 회차는 그대로 두고 새 회차(진도 0쪽부터)
  Future<void> reread(String id) => commitLib(rereadRound(lib, id, nowIso()));

  /// 회차 날짜 고치기(null을 주면 비운다)
  Future<void> updateRound(String roundId, {Object? startedAt = _keep, Object? finishedAt = _keep}) {
    final r = lib.rounds[roundId];
    if (r == null) return Future.value();
    return commitLib(lib.copy(rounds: {...lib.rounds, roundId: r.copyWith(startedAt: startedAt, finishedAt: finishedAt, updatedAt: nowIso())}));
  }

  /// 갈피 고치기
  Future<void> updateBookmark(String id, {required String text, Object? page = _keep, Object? memo = _keep, Object? photoUri = _keep, Object? photoRatio = _keep}) {
    final m = lib.bookmarks[id];
    if (m == null) return Future.value();
    final next = m.edit(text: text, page: page, memo: memo, photoUri: photoUri, photoRatio: photoRatio, updated: nowIso());
    return commitLib(lib.copy(bookmarks: {...lib.bookmarks, id: next}));
  }

  /// 갈피 지우기
  Future<void> deleteBookmark(String id) {
    if (!lib.bookmarks.containsKey(id)) return Future.value();
    return commitLib(lib.copy(bookmarks: {...lib.bookmarks}..remove(id)));
  }

  /// 갈피 아껴두기 켜고 끄기
  Future<void> toggleSaved(String id) {
    final m = lib.bookmarks[id];
    if (m == null) return Future.value();
    final t = nowIso();
    final next = m.withSaved(m.savedAt != null ? null : t, t);
    return _commit(_withBookmarks({...lib.bookmarks, id: next}), [LocalChange.put(LibKind.bookmarks, id, next, t)]);
  }
}

/// 책장 책의 갈피 색(지금 앱 toShelfBook art.ribbon): 고른 색 → 표지에서 뽑은 색 → 무채색이 아닌 책 색
String? ribbonOf(Library lib, String myBookId) {
  final b = lib.books[myBookId];
  if (b == null) return null;
  final picked = b.ribbonColor;
  if (picked != null && picked.isNotEmpty) return picked;
  final accent = coverAccentOf(lib.editions[b.editionId]?.coverUri);
  if (accent != null && accent.isNotEmpty) return accent;
  final theme = themeColorOf(lib, myBookId);
  return isNeutralColor(theme) ? null : theme;
}
