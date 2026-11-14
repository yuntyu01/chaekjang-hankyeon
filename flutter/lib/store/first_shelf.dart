// 처음 켤 때 책장 준비(지금 앱 bootStores의 installReferenceHome): 빈 서재면 시안 예시 책장 자리를 저장한다(예시 책 자체는 저장하지 않는다, domain/reference_home).
// 시험 빌드(--dart-define=QA_SEED_LIB=true)는 대신 지금 앱 QA 비교 서재(store/seed.dart)를 넣는다(두 앱을 같은 데이터로 견줄 때)
library;

import 'dart:convert';

import '../db/kv_store.dart';
import '../db/local_db.dart';
import '../domain/layout.dart';
import '../domain/layout_json.dart';
import '../domain/reference_home.dart';
import 'library_store.dart' show saveLayout;
import 'seed.dart';

const _qaSeedLib = bool.fromEnvironment('QA_SEED_LIB');

Future<void>? _preparing;

/// 한 번만(여러 곳에서 불러도 같은 작업을 기다린다)
Future<void> prepareFirstShelf() => _preparing ??= _prepare();

Future<void> _prepare() async {
  // 보기 책 책등 비율(지금 앱이 잰 실제 두께): 같은 책을 가진 서재도 같은 두께로
  rememberSampleSpineRatios();
  if (_qaSeedLib) return seedIfEmpty();
  await loadReferenceHome();
  final home = referenceHome;
  if (home == null || home.books.isEmpty) return;
  // 지금 앱에서 넘어온 서재·이미 설치한 서재는 그대로
  if (await KvStore.get(referenceHomeKey) != null) return;
  final db = await openLibrary();
  Future<int> count(String table) async => ((await db.rawQuery('SELECT COUNT(*) c FROM $table')).first['c'] as int?) ?? 0;
  // 시안은 새 서재에만: 책·자리·선반이 하나라도 있으면 사용자의 기록이다
  if (await count('my_books') > 0 || await count('shelf_placements') > 0 || await count('shelves') > 0) return;
  final layout = layoutFromJson(home.layoutJson);
  if (layout == null) return;
  await saveLayout(const ShelfLayout([], []), layout);
  await KvStore.set(referenceHomeKey, jsonEncode({'complete': true, 'profile': home.profile}));
}
