// 기기 안 키·값 저장(지금 앱 expo-sqlite/kv-store와 같은 파일·표): SQLite 폴더의 ExpoSQLiteStorage, storage(key, value).
// 설정·진행 중 독서처럼 서재 밖의 기기 값을 둔다(앱을 바꿔 깔아도 같은 값을 읽는다)
library;

import 'package:sqflite/sqflite.dart';

import 'local_db.dart';

Database? _kv;
Future<Database>? _opening;

Future<Database> _open() => _opening ??= () async {
      final d = await openDatabase(await libraryPath('ExpoSQLiteStorage'));
      // 지금 앱과 같은 기본 표(있으면 그대로), user_version 1
      await d.transaction((t) async {
        final v = (await t.rawQuery('PRAGMA user_version')).first.values.first as int? ?? 0;
        await t.execute('CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT);');
        if (v < 1) await t.execute('PRAGMA user_version = 1');
      });
      return _kv = d;
    }();

abstract final class KvStore {
  static Future<String?> get(String key) async {
    final r = await (await _open()).rawQuery('SELECT value FROM storage WHERE key = ?', [key]);
    return r.isEmpty ? null : r.first['value'] as String?;
  }

  static Future<void> set(String key, String value) async =>
      (await _open()).rawInsert('INSERT INTO storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

  static Future<void> remove(String key) async => (await _open()).rawDelete('DELETE FROM storage WHERE key = ?', [key]);
}

/// 시험용: 열린 저장소를 닫는다
Future<void> closeKv() async {
  await _kv?.close();
  _kv = null;
  _opening = null;
}
