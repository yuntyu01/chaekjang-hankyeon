// 데이터 내보내기·복원(지금 앱 store/backup.ts, 같은 파일 형식이라 지금 앱 백업도 복원된다).
// 백업 범위: 내 서재 전부(판본·내 책·회차·세션·갈피·장정, 숨긴 책 포함), 책장 배치, 연도 책장, 보기 설정, 설정,
// 그리고 앱 폴더에 보관한 사진(실제 표지 사진·갈피 페이지 사진·장정 그림). 진행 중 독서(타이머)는 넣지 않는다.
// 파일 하나(JSON)에 사진을 base64로 담는다. 사진 주소는 'img:이름'으로 바꿔 저장해 다른 기기·재설치에서도 복원된다.
// 복원 안전장치: ① 파일 전체를 먼저 검사하고 틀리면 아무것도 바꾸지 않는다. ② 바꾸기 전에 지금 상태를 메모리에 떠 두고, 도중에 실패하면 그 상태로 되돌린다.
// 폴더 저장은 지금 앱의 '폴더 고르기' 대신 다운로드/책장한켠에 저장한다(권한 없이)
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../db/kv_store.dart';
import '../db/library_write.dart' show LibKind;
import '../domain/bookcase.dart';
import '../domain/library_json.dart';
import 'bookcase_store.dart';
import 'files.dart' show imageDir;
import 'library_model.dart';
import 'library_store.dart' show layoutState, readBookcases, replaceAllLibrary;
import 'placement_store.dart';
import 'settings_store.dart';

const _channel = MethodChannel('app.covebook/files');
const _viewKey = 'view-settings:v3'; // 지금 앱 보기 설정(이 앱은 쓰지 않지만 백업에는 그대로 담는다)
const _emptyLayout = '{"version":2,"shelves":[],"placements":[],"drawer":[]}';

typedef Counts = ({int books, int bookmarks, int rounds, int sessions, int bindings, int images});

Counts countsOf(Json d) {
  final lib = (d['library'] as Map?) ?? const {};
  int n(String k) => ((lib[k] as Map?) ?? const {}).length;
  return (books: n('books'), bookmarks: n('bookmarks'), rounds: n('rounds'), sessions: n('sessions'), bindings: n('bindings'), images: ((d['images'] as Map?) ?? const {}).length);
}

Future<String> _imagePrefix() async => Uri.directory((await imageDir()).path).toString();

/// 지금 상태를 백업 객체로
Future<Json> snapshot() async {
  final model = LibraryModel.instance;
  await model.load();
  await model.flushPending();
  final dir = await _imagePrefix();
  final refs = <String>{};
  final exported = mapImagesJson(libraryToJson(model.lib), (uri) {
    if (uri == null || !uri.startsWith(dir)) return uri;
    final name = uri.substring(dir.length);
    refs.add(name);
    return 'img:$name';
  });
  final images = <String, String>{};
  for (final name in refs) {
    final f = File('${(await imageDir()).path}/$name');
    if (f.existsSync()) images[name] = base64Encode(await f.readAsBytes());
  }
  return {
    'app': 'chaekjang',
    'format': 1,
    'exportedAt': DateTime.now().toUtc().toIso8601String(),
    'library': exported,
    'layout': (await layoutState()).json,
    'view': await KvStore.get(_viewKey),
    'settings': SettingsStore.instance.raw,
    'images': images,
    'bookcases': [for (final c in await readBookcases()) bookcaseToWire(c)],
  };
}

String _fileName(Json d) => 'chaekjang-backup-${(d['exportedAt']! as String).substring(0, 19).replaceAll(RegExp('[:T]'), '-')}.json';

Future<File> _write(Json d) async {
  final f = File('${(await getTemporaryDirectory()).path}/${_fileName(d)}');
  await f.writeAsString(jsonEncode(d));
  return f;
}

/// 공유 창으로 내보내기
Future<Counts> exportShare() async {
  final d = await snapshot();
  final f = await _write(d);
  await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: 'application/json')], title: '책장 한켠 백업'));
  return countsOf(d);
}

/// 다운로드/책장한켠에 파일로 저장
Future<({String name, Counts counts})> exportToDownloads() async {
  if (await _channel.invokeMethod<bool>('canSaveDownload') != true) throw StateError('이 기기에서는 바로 저장할 수 없어요. 공유로 보내기를 써 주세요.');
  final d = await snapshot();
  final f = await _write(d);
  try {
    await _channel.invokeMethod<String>('saveDownload', {'path': f.path, 'name': _fileName(d)});
  } finally {
    f.delete().ignore();
  }
  return (name: _fileName(d), counts: countsOf(d));
}

bool _has(Object? m, String key) => m is Map && m.containsKey(key);

/// 파일 검사: 틀리면 이유를 돌려준다(아무것도 바꾸지 않는다)
String? validateBackup(Object? x) {
  if (x is! Map) return '책장 한켠 백업 파일이 아니에요.';
  final d = x.cast<String, Object?>();
  if (d['app'] != 'chaekjang' || d['format'] != 1) return '책장 한켠 백업 파일이 아니에요.';
  final lib = d['library'];
  if (lib is! Map) return '서재 기록이 없어요.';
  if (d['exportedAt'] is! String || DateTime.tryParse(d['exportedAt']! as String) == null) return '백업 날짜가 올바르지 않아요.';
  if (d['layout'] != null && d['layout'] is! String) return '책장 배치가 올바르지 않아요.';
  if (d.containsKey('images') && d['images'] is! Map) return '사진 목록이 깨져 있어요.';
  for (final k in LibKind.values) {
    final t = lib[k.name];
    if (t == null && k != LibKind.books && k != LibKind.editions) continue;
    if (t is! Map) return '기록(${k.name})이 깨져 있어요.';
    for (final e in t.entries) {
      if (e.value is! Map || (e.value as Map)['id'] != e.key) return '기록(${k.name}) 중 id가 맞지 않는 항목이 있어요.';
    }
  }
  Map t(String k) => (lib[k] as Map?) ?? const {};
  for (final e in t('editions').values) {
    if (e['title'] is! String || e['authors'] is! List || (e['authors'] as List).any((a) => a is! String)) return '도서 정보가 올바르지 않아요.';
  }
  for (final b in t('books').values) {
    if (b['editionId'] is! String || !_has(t('editions'), b['editionId'] as String) || !['want', 'reading', 'read', 'paused'].contains(b['status'])) return '책과 도서 정보의 연결이 올바르지 않아요.';
  }
  for (final r in t('rounds').values) {
    if (!_has(t('books'), '${r['myBookId']}') || r['index'] is! int || (r['index'] as int) < 1) return '독서 회차가 올바르지 않아요.';
  }
  for (final b in t('bindings').values) {
    if (!_has(t('books'), '${b['myBookId']}') || b['spineColor'] is! String || b['motif'] is! String) return '장정 정보가 올바르지 않아요.';
  }
  for (final m in t('bookmarks').values) {
    if (!_has(t('books'), '${m['myBookId']}') || m['text'] is! String) return '갈피 정보가 올바르지 않아요.';
  }
  for (final s in t('sessions').values) {
    final dur = s['durationMs'];
    if ((s['myBookId'] != null && !_has(t('books'), '${s['myBookId']}')) || (s['roundId'] != null && !_has(t('rounds'), '${s['roundId']}')) || dur is! num || dur < 0) {
      return '독서 시간 기록이 올바르지 않아요.';
    }
  }
  final images = (d['images'] as Map?) ?? const {};
  for (final e in images.entries) {
    if (e.key is! String || !RegExp(r'^[\w.-]{1,80}$').hasMatch(e.key as String) || e.key == '.' || e.key == '..' || e.value is! String) return '사진 목록이 깨져 있어요.';
  }
  if (d.containsKey('bookcases')) {
    final list = d['bookcases'];
    if (list is! List || list.any((c) => bookcaseFromWire(c) == null)) return '연도 책장이 올바르지 않아요.';
    if ({for (final c in list) (c as Map)['year']}.length != list.length) return '연도 책장이 올바르지 않아요.';
  }
  if (d['layout'] case final String layout) {
    try {
      final l = jsonDecode(layout);
      if (l is! Map || ![1, 2].contains(l['version']) || l['shelves'] is! List || l['placements'] is! List || (l['version'] == 2 && l['drawer'] is! List)) return '책장 배치가 올바르지 않아요.';
    } catch (_) {
      return '책장 배치가 올바르지 않아요.';
    }
  }
  var missing = false;
  mapImagesJson(lib.cast<String, Object?>(), (uri) {
    if (uri != null && uri.startsWith('img:') && !images.containsKey(uri.substring(4))) missing = true;
    return uri;
  });
  if (missing) return '사진 파일을 찾지 못했어요.';
  return null;
}

/// 파일을 골라 읽고 검사한다
Future<({Json? data, Counts? counts, bool cancelled, String? error})> readBackupFile() async {
  final path = await _channel.invokeMethod<String>('pick');
  if (path == null) return (data: null, counts: null, cancelled: true, error: null);
  try {
    final data = jsonDecode(await File(path).readAsString());
    final bad = validateBackup(data);
    if (bad != null) return (data: null, counts: null, cancelled: false, error: bad);
    final d = (data as Map).cast<String, Object?>();
    return (data: d, counts: countsOf(d), cancelled: false, error: null);
  } catch (e) {
    return (data: null, counts: null, cancelled: false, error: '파일을 읽지 못했어요. $e');
  } finally {
    File(path).delete().ignore();
  }
}

Future<void> _apply(Json data, {bool reuseFiles = false, void Function()? onLibrarySaved}) async {
  final dir = await imageDir();
  final prefix = await _imagePrefix();
  // 기존 파일을 덮어쓰지 않는다(중간에 앱이 꺼져도 지금 서재 사진이 남는다)
  final renamed = <String, String>{};
  final images = (data['images'] as Map?)?.cast<String, Object?>() ?? const {};
  final refs = <String>{};
  final lib0 = (data['library']! as Map).cast<String, Object?>();
  mapImagesJson(lib0, (uri) {
    if (uri != null && uri.startsWith('img:')) refs.add(uri.substring(4));
    return uri;
  });
  final tag = 'restore_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}_${math.Random().nextInt(1 << 30).toRadixString(36)}';
  var i = 0;
  for (final name in refs) {
    if (reuseFiles) {
      renamed[name] = name;
      continue;
    }
    final ext = RegExp(r'\.(png|webp|jpe?g)$', caseSensitive: false).firstMatch(name)?.group(1)?.toLowerCase() ?? 'jpg';
    final fresh = '${tag}_${i++}.$ext';
    await File('${dir.path}/$fresh').writeAsBytes(base64Decode(images[name]! as String));
    renamed[name] = fresh;
  }
  final at = DateTime.now().toUtc().toIso8601String();
  final mapped = mapImagesJson(lib0, (uri) => uri != null && uri.startsWith('img:') ? '$prefix${renamed[uri.substring(4)]}' : uri);
  // 복원은 지금의 사용자 변경이다. 백업 당시 시각을 그대로 쓰면 서버가 최신 값으로 거절한다
  Json stamp(Json lib) => {
        for (final k in lib.entries)
          k.key: k.value is Map ? {for (final e in (k.value as Map).entries) e.key: {...(e.value as Map).cast<String, Object?>(), 'updatedAt': at}} : k.value,
      };
  final lib = libraryFromJson(stamp(mapped));
  final cases = data['bookcases'] is List ? [for (final c in data['bookcases'] as List) ?bookcaseFromWire(c)] : null;
  await LibraryModel.instance.flushPending();
  await replaceAllLibrary(lib, layoutJson: (data['layout'] as String?) ?? _emptyLayout, at: at, bookcases: cases);
  onLibrarySaved?.call();
  if (data['view'] case final String v) await KvStore.set(_viewKey, v);
  if (data['settings'] case final Map s) SettingsStore.instance.set(s.cast<String, Object?>());
  // 화면용 서재·책장·연도 책장을 다시 읽는다
  await LibraryModel.instance.reload();
  await PlacementStore.instance.reload();
  await BookcaseStore.instance.load();
}

/// 지금 데이터를 백업 내용으로 바꾼다. 실패하면 바꾸기 전 상태로 되돌리고 오류를 알린다
Future<void> restoreBackup(Json data) async {
  final bad = validateBackup(data);
  if (bad != null) throw StateError(bad);
  final before = await snapshot();
  var changed = false;
  try {
    await _apply(data, onLibrarySaved: () => changed = true);
  } catch (e) {
    if (changed) {
      try {
        await _apply(before, reuseFiles: true);
      } catch (rollback) {
        throw StateError('복원과 이전 상태 복구에 실패했어요. ($rollback)');
      }
    }
    throw StateError('복원하지 못했어요. 이전 기록은 유지했어요. ($e)');
  }
  // 이전 사진은 진행 중인 동기화나 실패 복구에 필요할 수 있으므로 여기서 지우지 않는다
}
