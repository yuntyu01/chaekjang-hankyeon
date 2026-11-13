// 서재 쓰기 행 값이 지금 앱이 저장한 행과 같은지: 앱이 저장한 행 → 읽기 → valuesOf가 같은 행을 다시 만든다(tool/dump_schema.test.ts가 뽑은 행)
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/db/library_write.dart';
import 'package:chaekjang/store/library_read.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final d = jsonDecode(File('test/fixtures/library_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final rows = {for (final e in (d['rows'] as Map<String, dynamic>).entries) e.key: (e.value as List).cast<Map<String, dynamic>>()};

  test('항목 → 행 값이 앱이 저장한 행과 같다', () {
    final lib = libraryFromRows(rows);
    final items = <LibKind, Map<String, Object>>{
      LibKind.editions: lib.editions,
      LibKind.books: lib.books,
      LibKind.rounds: lib.rounds,
      LibKind.sessions: lib.sessions,
      LibKind.bookmarks: lib.bookmarks,
      LibKind.bindings: lib.bindings,
    };
    var n = 0;
    for (final kind in LibKind.values) {
      final cols = libColumns[kind]!;
      for (final r in rows[libTable[kind]]!) {
        final v = valuesOf(kind, items[kind]![r['id']]!);
        expect({for (final (i, c) in cols.indexed) c: v[i]}, {for (final c in cols) c: r[c]}, reason: '${kind.name} ${r['id']}');
        n++;
      }
    }
    expect(n, greaterThan(50));
  });
}
