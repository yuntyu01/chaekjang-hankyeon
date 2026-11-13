// 서재 한 벌을 화면들이 함께 본다(지금 앱 store/library-store.ts의 읽기·고치기 일부).
// 고치면 화면은 바로 바뀌고, 항목 행과 동기화 대기 기록은 한 트랜잭션으로 차례대로 저장한다(누른 순서대로)
library;

import 'package:flutter/foundation.dart';

import '../db/library_write.dart';
import '../domain/color.dart';
import '../domain/library.dart';
import 'library_read.dart';

class LibraryModel extends ChangeNotifier {
  LibraryModel._();
  static final instance = LibraryModel._();

  Library lib = Library();
  bool loaded = false;
  Object? error;
  Future<void>? _loading;
  Future<void> _writes = Future.value();

  Future<void> load() => _loading ??= loadFullLibrary().then((l) {
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
/// 표지에서 뽑은 색(cover-accent)은 책 추가 단계에서 옮긴다: 지금은 고른 색과 책 색만
String? ribbonOf(Library lib, String myBookId) {
  final b = lib.books[myBookId];
  if (b == null) return null;
  final picked = b.ribbonColor;
  if (picked != null && picked.isNotEmpty) return picked;
  final theme = themeColorOf(lib, myBookId);
  return isNeutralColor(theme) ? null : theme;
}
