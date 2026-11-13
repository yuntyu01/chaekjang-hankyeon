// 서재가 비어 있으면 지금 앱 QA 비교 서재(실제 책·독서 기록·갈피·비교 책장 자리)를 넣는다.
// 지금 앱과 나란히 놓고 견주려고 쓴다(비교는 실사 책으로). 표지는 YES24에서 받는다. 지금 앱 DB를 그대로 읽게 되면 이 파일은 지운다
library;

import 'dart:convert';

import 'package:flutter/services.dart';

import '../db/local_db.dart';
import '../domain/cover_url.dart';
import '../gen/real_sample.g.dart';

String _coverOf(int goods) => 'https://image.yes24.com/goods/$goods/L';

/// 보기 책들의 책등 비율(지금 앱이 잰 실제 두께). 서재를 다시 열 때도 같은 크기로 그리게 늘 등록한다
void rememberSampleSpineRatios() {
  for (final b in realSampleBooks) {
    rememberSpineRatio(_coverOf(b.goods), b.spineRatio);
  }
}

/// 한 번만 넣는다(여러 곳에서 불러도 같은 작업을 기다린다)
Future<void>? _seeding;
Future<void> seedIfEmpty() => _seeding ??= _seed();

Future<void> _seed() async {
  rememberSampleSpineRatios();
  final db = await openLibrary();
  final n = (await db.rawQuery('SELECT COUNT(*) c FROM my_books')).first['c'] as int? ?? 0;
  if (n > 0) return;
  // 지금 앱 QA 비교 서재(?seedlib=1 → ?seedshelf=1)를 지금 앱 저장 경로로 만든 행 그대로(tool/dump_qa_seed.test.ts)
  final raw = jsonDecode(await rootBundle.loadString('assets/qa_seed.json')) as Map<String, dynamic>;
  final rows = (raw['rows'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as List).cast<Map<String, dynamic>>()));
  await db.transaction((t) async {
    await t.execute('PRAGMA defer_foreign_keys = ON');
    for (final table in _seedTables) {
      for (final r in rows[table] ?? const <Map<String, dynamic>>[]) {
        await t.insert(table, r);
      }
    }
  });
}

const _seedTables = ['editions', 'edition_authors', 'bindings', 'my_books', 'rounds', 'sessions', 'bookmarks', 'shelves', 'shelf_placements'];
