// 책장 배치 저장소(지금 앱 store/placement-store.ts의 확정·되돌리기): 편집 엔진(domain/layout_engine)이 만든 배치를 받아
// 기대기 정리(받침 잃은 책은 기대거나 눕거나 다시 선다. 옆 벽이 있어 선반 밖으로 떨어지지 않는다) → 구조·공간 검증 → 저장(바뀐 행만) → 책장 다시 굽기.
// 되돌리기는 바로 앞 한 번. 배치는 홈이 책장을 그리려고 읽은 서재를 그대로 받는다(adopt: 따로 DB를 다시 읽지 않는다)
library;

import 'package:flutter/foundation.dart';

import '../domain/layout.dart';
import '../domain/layout_engine.dart';
import '../domain/shelf_scene.dart';
import '../services/cover_colors.dart' show shelfRefresh;
import 'library_store.dart';

class PlacementStore {
  PlacementStore._();
  static final instance = PlacementStore._();

  ShelfLayout? layout;
  BookMap books = {};
  ShelfLayout? _undo;

  bool get canUndo => _undo != null;

  /// 홈이 읽은 서재(책 크기·배치)를 받는다
  void adopt(Library lib) {
    books = {for (final b in lib.books) b.id: b};
    layout = lib.layout;
  }

  /// 아직 받은 게 없을 때만 읽는다
  Future<void> ensure() async {
    if (layout == null) adopt(await loadLibrary());
  }

  /// 배치에 없는 책은 서랍 끝에(지금 앱 commit과 같다)
  ShelfLayout _withMissing(ShelfLayout l) {
    final placed = {for (final p in l.placements) p.bookId, ...l.drawer};
    final missing = [for (final id in books.keys) if (!placed.contains(id)) id];
    return missing.isEmpty ? l : ShelfLayout(l.shelves, l.placements, [...l.drawer, ...missing]);
  }

  Future<void> _write(ShelfLayout next) async {
    final prev = layout!;
    layout = next;
    await saveLayout(prev, next);
    shelfRefresh.value++;
  }

  /// 확정: 기대기 결과(최종 각·상대)와 넘어진 책까지 풀어 검증한 뒤 저장. 안 되면 false
  Future<bool> commit(ShelfLayout input) async {
    final cur = layout;
    if (cur == null) return false;
    final next = resolveLeans(ensureShelves(_withMissing(input)), books);
    final errors = validateLayout(next, books, books.keys.toList());
    if (errors.isNotEmpty) {
      debugPrint('[layout] 확정 거절 $errors');
      return false;
    }
    _undo = cur;
    await _write(next);
    return true;
  }

  Future<bool> undo() async {
    final prev = _undo;
    if (prev == null || layout == null) return false;
    _undo = null;
    await _write(_withMissing(prev));
    return true;
  }
}

/// 편집 실패 까닭 → 알림 글(지금 앱 ko.fail)
const editFailText = {
  'no-space': '공간이 부족해요. 다른 자리로 옮겨 주세요.',
  'unsupported': '아래 책 위에 다 올라가지 않아요. 더 큰 책 위에 쌓아 주세요.',
  'spin-only-lying': '눕힌 책만 돌릴 수 있어요.',
  'stack-full': '쌓기는 3권까지예요.',
  'not-stackable': '눕힌 책끼리만 쌓을 수 있어요.',
  'tilt-only-spine': '세운 책만 기울일 수 있어요.',
  'cannot-lean': '이 책은 두꺼워서 기울여 기댈 수 없어요.',
  'shelf-not-empty': '책이 있는 선반은 지울 수 없어요.',
  'outside': '책장 안에 놓아 주세요.',
};
