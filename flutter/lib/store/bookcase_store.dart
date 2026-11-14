// 연도 책장 저장소(지금 앱 store/bookcase-store.ts): 남긴 연도 책장 목록과, 해가 바뀌면 그해 책장을 남기는 일(규칙은 domain/bookcase).
// 확인하는 때: 앱 시작, 앱으로 돌아올 때, 앱을 켜 둔 채 새해 자정이 지날 때
library;

import 'dart:async';

import 'package:flutter/widgets.dart';

import '../db/kv_store.dart';
import '../domain/bookcase.dart';
import '../domain/library.dart' show Library;
import 'library_model.dart';
import 'library_store.dart' show layoutChangedAt, loadLayout, readBookcases, writeBookcase;

/// 서버에서 서재 전체를 처음부터 받는 중(services/sync가 쓰고 지운다). 그동안 연도 책장을 남기지 않는다(반쯤 받은 서재로 한 해를 고정하지 않게)
const pullAllKey = 'sync-pulling-all:v1';

// 손대지 않은 지금 앱 예시 책(지금 앱 home-reference checkSampleBooks): 연도 책장에 남기지 않는다
final _sampleId = RegExp(r'^home-reference-b\d{2}(-\d+)?$');
const _sampleSource = '시안 예시';

Set<String> _pureSamples(Library lib) {
  final touched = {for (final r in lib.rounds.values) r.myBookId, for (final s in lib.sessions.values) ?s.myBookId, for (final m in lib.bookmarks.values) m.myBookId};
  final out = <String>{};
  for (final b in lib.books.values) {
    if (!_sampleId.hasMatch(b.id)) continue;
    final e = lib.editions[b.editionId];
    if (e == null || e.sourceName != _sampleSource) continue;
    final bd = b.bindingId == null ? null : lib.bindings[b.bindingId];
    final changed = b.updatedAt != b.createdAt ||
        e.updatedAt != e.createdAt ||
        (bd != null && bd.updatedAt != bd.createdAt) ||
        b.status.name != 'want' ||
        (b.rating != null && b.rating != 0) ||
        (b.note != null && b.note!.isNotEmpty) ||
        (b.currentPage != null && b.currentPage != 0) ||
        touched.contains(b.id) ||
        lib.books.values.any((o) => o.id != b.id && o.editionId == b.editionId);
    if (!changed) out.add(b.id);
  }
  return out;
}

class BookcaseStore extends ChangeNotifier with WidgetsBindingObserver {
  BookcaseStore._();
  static final instance = BookcaseStore._();

  List<Bookcase> bookcases = const [];
  bool loaded = false;

  /// 동기화가 도는 동안은 확인하지 않는다(받는 도중의 서재로 남기지 않게)
  bool syncBusy = false;
  Future<int?>? _checking;
  Timer? _timer;
  bool _watching = false;

  Future<void> load() async {
    bookcases = await readBookcases();
    loaded = true;
    notifyListeners();
  }

  /// 해가 바뀌었으면 그해 책장을 남긴다. 남긴 해(없으면 null). 동시에 부르면 한 번만 한다
  Future<int?> checkYear([DateTime? now]) => _checking ??= _check(now ?? DateTime.now()).whenComplete(() => _checking = null);

  Future<int?> _check(DateTime now) async {
    if (syncBusy || await KvStore.get(pullAllKey) != null) return null;
    final model = LibraryModel.instance;
    await model.load();
    if (!loaded) await load();
    final year = yearToArchive(model.lib, await layoutChangedAt(), [for (final c in bookcases) c.year], now);
    return year == null ? null : _keep(year, now);
  }

  /// 지금 서재·배치를 그해 책장으로 남긴다. 장정 복사본은 서재 항목으로 저장한다(동기화로 올라간다)
  Future<int?> _keep(int year, DateTime now) async {
    final model = LibraryModel.instance;
    final full = model.lib;
    final r = snapshotBookcase(full, await loadLayout(), year, now.toUtc().toIso8601String(), _pureSamples(full));
    if (r.bookcase.books.isEmpty) return null;
    await model.commitLib(full.copy(bindings: {...full.bindings, for (final b in r.bindings) b.id: b}));
    await writeBookcase(r.bookcase);
    bookcases = [...bookcases.where((c) => c.year != year), r.bookcase]..sort((a, b) => a.year - b.year);
    notifyListeners();
    // ignore: avoid_print
    print('[bookcase] $year년 책장을 남겼어요(${r.bookcase.books.length}권, 선반 ${r.bookcase.layout.shelves.length})');
    return year;
  }

  /// 시험용(QA_SEED_YEAR로 빌드했을 때만): 지금 책장을 지난 해 책장으로 남긴다. 그해 책장이 있으면 그대로 둔다
  Future<int?> seedYear(int year) async {
    await LibraryModel.instance.load();
    if (!loaded) await load();
    if (bookcases.any((c) => c.year == year)) return null;
    return _keep(year, DateTime.now());
  }

  /// 앱으로 돌아올 때와 새해 자정에 확인한다
  void watch() {
    if (_watching) return;
    _watching = true;
    WidgetsBinding.instance.addObserver(this);
    _arm();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    checkYear().catchError((Object e) {
      // ignore: avoid_print
      print('연도 책장 확인 실패 $e');
      return null;
    });
    _arm();
  }

  // 앱을 켜 둔 채 새해가 되면 자정 직후에 한 번 확인한다(하루 안으로 남았을 때만 예약)
  void _arm() {
    _timer?.cancel();
    _timer = null;
    final now = DateTime.now();
    final left = DateTime(now.year + 1).difference(now);
    if (left > const Duration(hours: 24)) return;
    _timer = Timer(left + const Duration(seconds: 5), () {
      _timer = null;
      checkYear().catchError((_) => null).whenComplete(_arm);
    });
  }
}
