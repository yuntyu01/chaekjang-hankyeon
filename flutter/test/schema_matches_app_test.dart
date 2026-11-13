// 서재 DB 표 구조가 지금 앱(옮기기를 끝까지 돌린 뒤)과 같은지 본다: 표·열 이름·차례·형·NOT NULL·기본값·기본 키, 색인, user_version.
// test/fixtures/app_schema.json 은 tool/gen_shaders.sh 가 지금 앱 db/local-db.ts를 node:sqlite로 돌려 뽑는다
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/db/local_db.dart';
import 'package:flutter_test/flutter_test.dart';

/// CREATE TABLE 문에서 열(이름·형·NOT NULL·기본값·기본 키)을 읽는다
Map<String, List<({String name, String type, bool notnull, String? dflt, int pk})>> parseSchema(String sql) {
  final out = <String, List<({String name, String type, bool notnull, String? dflt, int pk})>>{};
  final table = RegExp(r'CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\)', multiLine: true);
  for (final m in table.allMatches(sql)) {
    final cols = <({String name, String type, bool notnull, String? dflt, int pk})>[];
    final body = m.group(2)!;
    List<String> pkCols = [];
    final pkm = RegExp(r'PRIMARY KEY \(([^)]*)\)').firstMatch(body);
    if (pkm != null && !RegExp(r'^\s*\w+ \w+ PRIMARY KEY', multiLine: true).hasMatch(body.split('\n').firstWhere((l) => l.contains('PRIMARY KEY (')))) {
      pkCols = pkm.group(1)!.split(',').map((c) => c.trim()).toList();
    }
    // 한 줄에 열이 여럿인 표(sync_*)도 있어 쉼표로 나눈다(괄호 안 쉼표는 제약이라 건너뛴다)
    final parts = <String>[];
    var depth = 0, cur = StringBuffer();
    for (final ch in body.split('')) {
      if (ch == '(') depth++;
      if (ch == ')') depth--;
      if (ch == ',' && depth == 0) {
        parts.add(cur.toString());
        cur = StringBuffer();
      } else {
        cur.write(ch);
      }
    }
    parts.add(cur.toString());
    for (final raw in parts) {
      final p = raw.trim();
      if (p.isEmpty || p.startsWith('PRIMARY KEY') || p.startsWith('FOREIGN KEY')) continue;
      final w = p.split(RegExp(r'\s+'));
      final dm = RegExp(r"DEFAULT ('[^']*'|\S+)").firstMatch(p);
      final inlinePk = p.contains('PRIMARY KEY');
      cols.add((
        name: w[0],
        type: w[1],
        notnull: p.contains('NOT NULL'),
        dflt: dm?.group(1),
        pk: inlinePk ? 1 : (pkCols.contains(w[0]) ? pkCols.indexOf(w[0]) + 1 : 0),
      ));
    }
    out[m.group(1)!] = cols;
  }
  return out;
}

void main() {
  final app = jsonDecode(File('test/fixtures/app_schema.json').readAsStringSync()) as Map<String, dynamic>;
  final mine = parseSchema(librarySchema);

  test('user_version이 지금 앱과 같다', () => expect(schemaVersion, app['version']));

  test('표 목록이 지금 앱과 같다', () {
    expect(mine.keys.toList()..sort(), (app['tables'] as Map).keys.toList()..sort());
  });

  test('표마다 열(이름·차례·형·NOT NULL·기본값·기본 키)이 지금 앱과 같다', () {
    for (final e in (app['tables'] as Map<String, dynamic>).entries) {
      final theirs = (e.value as List).cast<Map<String, dynamic>>();
      final cols = mine[e.key]!;
      expect(cols.map((c) => c.name).toList(), theirs.map((c) => c['name']).toList(), reason: '${e.key} 열 차례');
      for (var i = 0; i < theirs.length; i++) {
        final t = theirs[i], m = cols[i];
        final why = '${e.key}.${m.name}';
        expect(m.type, t['type'], reason: '$why 형');
        expect(m.notnull, t['notnull'] == 1, reason: '$why NOT NULL');
        expect(m.dflt, t['dflt_value'], reason: '$why 기본값');
        expect(m.pk, t['pk'], reason: '$why 기본 키');
      }
    }
  });

  test('색인이 지금 앱과 같다', () {
    final idx = RegExp(r'CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)').allMatches(librarySchema).map((m) => '${m.group(1)}@${m.group(2)}').toList();
    expect(idx, [for (final i in (app['indexes'] as List).cast<Map<String, dynamic>>()) '${i['name']}@${i['tbl_name']}']);
  });
}
