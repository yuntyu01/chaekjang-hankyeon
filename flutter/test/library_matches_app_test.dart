// 서재 읽기(표 행 → 서재)·기간 통계·시간 글자가 지금 앱과 같은지 본다. test/fixtures/library_cases.json 은 tool/gen_shaders.sh 가
// 지금 앱 db/local-db.ts로 실사 비교 책장의 읽기 기록을 저장(node:sqlite)하고 다시 읽어 뽑는다
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/store/library_read.dart';
import 'package:flutter_test/flutter_test.dart';

/// 숫자는 정수·소수 구분 없이 값으로 견준다(SQLite INTEGER ↔ JS number)
Object? norm(Object? v) => switch (v) {
      num n => n.toDouble(),
      Map m => {for (final e in m.entries) e.key: norm(e.value)},
      List l => [for (final x in l) norm(x)],
      _ => v,
    };

void main() {
  final json = jsonDecode(File('test/fixtures/library_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final rows = {for (final e in (json['rows'] as Map<String, dynamic>).entries) e.key: (e.value as List).cast<Map<String, Object?>>()};
  final lib = libraryFromRows(rows);

  test('같은 표를 지금 앱과 같은 서재로 읽는다', () {
    final mine = norm(lib.toJson()) as Map;
    final theirs = norm(json['library']) as Map;
    for (final kind in theirs.keys) {
      final t = theirs[kind] as Map, m = mine[kind] as Map;
      expect(m.keys.toList(), t.keys.toList(), reason: '$kind id 차례');
      for (final id in t.keys) {
        expect(m[id], t[id], reason: '$kind $id');
      }
    }
  });

  test('기간 통계가 지금 앱과 같다', () {
    expect(json['tz'], isNotNull);
    for (final s in (json['stats'] as List).cast<Map<String, dynamic>>()) {
      final name = s['name'] as String;
      final p = name.startsWith('month-')
          ? monthPeriod(int.parse(name.substring(6, 10)), int.parse(name.substring(11)))
          : yearPeriod(2026);
      final r = periodStats(lib, p, s['book'] as String?);
      expect(r.completedBooks, (s['completedBooks'] as List).cast<String>(), reason: '$name 완독 책');
      expect(r.completedRounds, s['completedRounds'], reason: '$name 완독 회차');
      expect(r.rereads, s['rereads'], reason: '$name 재독');
      expect(r.readMs, s['readMs'], reason: '$name 읽은 시간');
      expect(r.sessions.map((x) => x.id).toList(), (s['sessions'] as List).cast<String>(), reason: '$name 세션 차례');
      expect(r.bookmarkCount, s['bookmarkCount'], reason: '$name 갈피 수');
      expect(r.booksRead, (s['booksRead'] as List).cast<String>(), reason: '$name 읽은 책');
    }
  });

  test('시간 글자가 지금 앱과 같다', () {
    for (final d in (json['durations'] as List).cast<Map<String, dynamic>>()) {
      expect(formatDuration(d['ms'] as num), d['d'], reason: '${d['ms']}');
      expect(formatDurationPrecise(d['ms'] as num), d['p'], reason: '${d['ms']} 정밀');
    }
  });
}
