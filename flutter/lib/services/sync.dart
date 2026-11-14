// 서버 동기화(지금 앱 services/sync.ts). 앱은 서버 없이도 모두 동작하는 '로컬 우선' 구조이고, 서버 주소(SYNC_URL)가 있을 때만 동기화한다.
// 흐름: 첫 연결 때 기기 계정을 만들어 토큰을 받고, 서재 전체를 올린다 → 이후에는 바뀐 것만 올리고(push) 서버의 변경을 받는다(pull).
// 사진은 파일 API로 따로 올리고 받는다. 충돌은 updatedAt이 더 새로운 쪽이 이긴다(domain/sync).
// 서버 주소는 빌드 때 --dart-define=SYNC_URL=... 로 준다(시험 서재가 운영 서버에 올라가지 않게 기본은 꺼 둔다)
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';

import '../db/kv_store.dart';
import '../db/library_write.dart';
import '../domain/bookcase.dart';
import '../domain/sync.dart';
import '../store/bookcase_store.dart';
import '../store/files.dart' show imageDir;
import '../store/library_model.dart';
import '../store/library_store.dart' show layoutState, markBookcasesSynced, readBookcases, saveRemoteLayout, unsyncedBookcaseIds, writeBookcase;
import '../store/placement_store.dart';

const syncBase = String.fromEnvironment('SYNC_URL');

const _tokenKey = 'sync-token:v1';
const _revKey = 'sync-rev:v1';
const _epochKey = 'sync-epoch:v1';
const _filesKey = 'sync-files:v1'; // 이미 올린 파일 id
const _accountKey = 'account:v1'; // 소셜 연결 여부·닉네임(화면 표시용 사본)
const _pauseKey = 'sync-paused:v1';

class ApiError implements Exception {
  ApiError(this.status, this.code, this.message);
  final int status;
  final String code, message;

  @override
  String toString() => message;
}

String get _base => syncBase.replaceAll(RegExp(r'/+$'), '');

Future<Object?> api(String method, String path, String? token, [Object? body]) async {
  if (_base.isEmpty) throw StateError('서버 주소가 설정되지 않았어요');
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
  try {
    final req = await client.openUrl(method, Uri.parse('$_base$path')).timeout(const Duration(seconds: 15));
    if (token != null) req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    if (body != null) {
      req.headers.contentType = ContentType.json;
      req.add(utf8.encode(jsonEncode(body)));
    }
    final res = await req.close().timeout(const Duration(seconds: 15));
    final text = await res.transform(utf8.decoder).join().timeout(const Duration(seconds: 15));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      var code = 'http', message = '서버 응답 ${res.statusCode}';
      try {
        final e = (jsonDecode(text) as Map)['error'] as Map?;
        code = (e?['code'] as String?) ?? code;
        message = (e?['message'] as String?) ?? message;
      } catch (_) {
        // 서버가 JSON 오류 본문을 보내지 않을 수 있다
      }
      throw ApiError(res.statusCode, code, message);
    }
    if (res.statusCode == 204 || res.statusCode == 202 || text.isEmpty) return null;
    return jsonDecode(text);
  } on TimeoutException {
    throw StateError('서버 응답 시간이 초과됐어요. 다시 시도해 주세요.');
  } finally {
    client.close();
  }
}

enum SyncState { off, idle, syncing, error }

class SyncService extends ChangeNotifier with WidgetsBindingObserver {
  SyncService._();
  static final instance = SyncService._();

  bool get available => _base.isNotEmpty;
  SyncState state = _base.isEmpty ? SyncState.off : SyncState.idle;
  String? lastAt, lastError;
  int pending = 0;
  bool paused = false, deletionPending = false;
  ({bool kakao, bool google, String nickname}) account = (kakao: false, google: false, nickname: '');
  ({bool kakao, bool google, bool accountDeletion}) providers = (kakao: false, google: false, accountDeletion: false);

  Future<void>? _pauseLoaded;
  bool _running = false, _again = false, _linking = false, _accountChecked = false, _providersChecked = false, _bookcasesSupported = false, _started = false;
  Completer<void>? _runningDone;
  Timer? _timer;
  String? _verifiedToken;
  String? _dir;

  Future<String> _imageDir() async => _dir ??= Uri.directory((await imageDir()).path).toString();

  void _set({SyncState? state, String? lastAt, Object? error = _keep}) {
    if (state != null) this.state = state;
    if (lastAt != null) this.lastAt = lastAt;
    if (!identical(error, _keep)) lastError = error as String?;
    notifyListeners();
  }

  Future<void> _refreshPending() async {
    final p = await readPending();
    final l = await layoutState();
    pending = p.length + (l.dirty ? 1 : 0);
    notifyListeners();
  }

  Future<void> _loadPause() => _pauseLoaded ??= KvStore.get(_pauseKey).then((v) {
        deletionPending = v == 'delete-pending';
        paused = v == '1' || deletionPending;
        notifyListeners();
      }).catchError((Object e) {
        _pauseLoaded = null;
        throw e;
      });

  Future<void> _pauseCloud({bool deleting = false}) async {
    paused = true;
    deletionPending = deleting;
    _timer?.cancel();
    _timer = null;
    _again = false;
    _set(state: SyncState.off);
    await KvStore.set(_pauseKey, deleting ? 'delete-pending' : '1');
  }

  Future<void> _refreshProviders() async {
    try {
      final a = (await api('GET', '/auth/providers', null) as Map?) ?? const {};
      providers = (google: a['google'] == true, kakao: a['kakao'] == true, accountDeletion: a['accountDeletion'] == true);
      _providersChecked = true;
      notifyListeners();
    } catch (_) {
      _providersChecked = false;
    }
  }

  void _setAccount(({bool kakao, bool google, String nickname}) a) {
    account = a;
    KvStore.set(_accountKey, jsonEncode({'kakao': a.kakao, 'google': a.google, 'nickname': a.nickname})).ignore();
    notifyListeners();
  }

  Future<String> _ensureToken() async {
    if (paused) throw StateError('서버 동기화가 중지되어 있어요');
    final saved = await KvStore.get(_tokenKey);
    if (saved != null) return saved;
    final created = (await api('POST', '/auth/device', null))! as Map;
    // 토큰을 마지막에 기록한다. 중간에 앱이 꺼져도 다음 시작 때 전체 올리기를 다시 준비한다
    final model = LibraryModel.instance;
    await model.load();
    await model.flushPending();
    await queueAllChanges(fullDirty(model.lib));
    await KvStore.set(_revKey, '0');
    await KvStore.set(_filesKey, '[]');
    await KvStore.set(_tokenKey, created['token']! as String);
    return created['token']! as String;
  }

  /// 커뮤니티 API도 같은 서버 계정 토큰을 쓴다(동기화가 중지되어 있으면 쓰지 않는다)
  Future<String> serverToken() async {
    if (_base.isEmpty) throw StateError('이 빌드에는 서버 주소가 없어요');
    await _loadPause();
    return _ensureToken();
  }

  // ---------- 사진 ----------
  Future<Set<String>> _doneFiles() async => {for (final x in jsonDecode((await KvStore.get(_filesKey)) ?? '[]') as List) '$x'};

  String _mime(String id) => RegExp(r'\.png$', caseSensitive: false).hasMatch(id)
      ? 'image/png'
      : RegExp(r'\.webp$', caseSensitive: false).hasMatch(id)
          ? 'image/webp'
          : 'image/jpeg';

  Future<File> _fileOf(String id) async => File('${(await imageDir()).path}/$id');

  Future<void> _uploadFiles(String token, List<String> ids) async {
    if (ids.isEmpty) return;
    final done = await _doneFiles();
    for (final id in ids) {
      if (done.contains(id)) continue;
      final f = await _fileOf(id);
      if (!f.existsSync()) continue; // 이 기기에 파일이 없으면(지워짐) 올릴 수 없다
      final client = HttpClient();
      try {
        final req = await client.putUrl(Uri.parse('$_base/files/${Uri.encodeComponent(id)}'));
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
        req.headers.set(HttpHeaders.contentTypeHeader, _mime(id));
        await req.addStream(f.openRead());
        final res = await req.close();
        await res.drain<void>();
        if (res.statusCode < 200 || res.statusCode >= 300) throw ApiError(res.statusCode, 'upload', '사진을 올리지 못했어요(${res.statusCode})');
      } finally {
        client.close();
      }
      done.add(id);
    }
    await KvStore.set(_filesKey, jsonEncode(done.toList()));
  }

  Future<void> _downloadFiles(String token, List<String> ids) async {
    if (ids.isEmpty) return;
    final done = await _doneFiles();
    for (final id in ids) {
      final f = await _fileOf(id);
      if (f.existsSync()) continue;
      final client = HttpClient();
      try {
        final req = await client.getUrl(Uri.parse('$_base/files/${Uri.encodeComponent(id)}'));
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
        final res = await req.close();
        if (res.statusCode != 200) {
          await res.drain<void>();
          throw ApiError(res.statusCode, 'download', '사진을 받지 못했어요(${res.statusCode})');
        }
        await res.pipe(f.openWrite());
      } catch (e) {
        if (f.existsSync()) f.deleteSync();
        rethrow;
      } finally {
        client.close();
      }
      done.add(id); // 서버에 있는 파일이니 다시 올리지 않는다
    }
    await KvStore.set(_filesKey, jsonEncode(done.toList()));
  }

  List<String> _filesIn(Map<String, Object?> body) => {
        for (final x in (body['bookmarks'] as List?) ?? const []) (x as Map)['photoFileId'],
        for (final x in (body['editions'] as List?) ?? const []) (x as Map)['coverFileId'],
        for (final x in (body['bindings'] as List?) ?? const []) ...[(x as Map)['coverArtFileId'], x['spineArtFileId']],
      }.whereType<String>().toList();

  // 기기에서 지워져 올릴 수 없는 사진은 연결을 뺀다(서버 외래키에 걸려 동기화가 통째로 막히지 않게)
  Future<void> _dropMissingFiles(Map<String, List<Wire>> body) async {
    final done = await _doneFiles();
    final gone = <String>{};
    for (final id in _filesIn(body)) {
      if (!done.contains(id) && !(await _fileOf(id)).existsSync()) gone.add(id);
    }
    if (gone.isEmpty) return;
    void clear(String kind, List<String> keys) {
      for (final x in body[kind] ?? const <Wire>[]) {
        for (final k in keys) {
          if (gone.contains(x[k])) x.remove(k);
        }
      }
    }

    clear('bookmarks', ['photoFileId']);
    clear('editions', ['coverFileId']);
    clear('bindings', ['coverArtFileId', 'spineArtFileId']);
  }

  // ---------- 올리기·받기 ----------
  Future<void> _pushBatch(String token, Map<String, Object?> body) async {
    final r = await api('POST', '/sync/push', token, body) as Map?;
    // 서버의 최신 값이 이긴 항목은 이전 커서 밖에 있을 수 있다. 확인 표시 전에 처음부터 다시 읽는다
    if ((r?['skipped'] as List?)?.isNotEmpty ?? false) await KvStore.set(_revKey, '0');
  }

  Future<void> _pushOnce(String token) async {
    final model = LibraryModel.instance;
    await model.flushPending();
    final pendingRows = await readPending();
    final dirty = {for (final e in pendingRows.entries) e.key: (deleted: e.value.deleted, at: e.value.at)};
    final dir = await _imageDir();
    final built = buildPush(model.lib, dirty, dir);
    final body = built.body;
    await _dropMissingFiles(body);
    if (built.count != dirty.length) throw StateError('올릴 서재 기록을 찾지 못했어요');
    final saved = await layoutState();
    final layout = saved.dirty && saved.json != null ? {'layoutJson': saved.json, 'version': 2, 'updatedAt': saved.at ?? DateTime.now().toUtc().toIso8601String()} : null;
    final layoutRevision = saved.dirty ? saved.revision : null;
    // 연도 책장은 그 책·장정과 같은 요청이나 그 뒤 요청에 보낸다(서버 외래키). 연도 책장을 모르는 서버(재배포 전)에는 보내지 않는다
    final unsynced = _bookcasesSupported ? await unsyncedBookcaseIds() : <String>{};
    final cases = unsynced.isEmpty ? <Bookcase>[] : [for (final c in await readBookcases()) if (unsynced.contains(c.id)) c];
    final bookcases = cases.isEmpty ? null : [for (final c in cases) bookcaseToWire(c)];
    final sentCases = [for (final c in cases) c.id];
    if (built.count == 0 && layout == null && bookcases == null) {
      await acknowledgePending(pendingRows, layoutRevision);
      return;
    }
    // 서버는 종류별 한 요청에 1,000개까지만 받는다. 큰 서재는 참조 순서대로 나눠 보내고 성공한 묶음만 확인한다
    const kinds = ['editions', 'books', 'bindings', 'rounds', 'sessions', 'bookmarks'];
    if (kinds.any((k) => (body[k]?.length ?? 0) > 1000)) {
      for (final kind in kinds) {
        final items = body[kind] ?? const <Wire>[];
        for (var off = 0; off < items.length; off += 1000) {
          final chunk = items.sublist(off, (off + 1000).clamp(0, items.length));
          final batch = {kind: chunk};
          await _uploadFiles(token, _filesIn(batch));
          await _pushBatch(token, batch);
          final sent = {for (final it in chunk) '$kind:${it['id']}'};
          await acknowledgePending({for (final e in pendingRows.entries) if (sent.contains(e.key)) e.key: e.value}, null);
        }
      }
      if (layout != null || bookcases != null) await _pushBatch(token, {'layout': ?layout, 'bookcases': ?bookcases});
      await acknowledgePending(const {}, layoutRevision);
      await markBookcasesSynced(sentCases);
      return;
    }
    await _uploadFiles(token, _filesIn(body));
    await _pushBatch(token, {...body, 'layout': ?layout, 'bookcases': ?bookcases});
    await acknowledgePending(pendingRows, layoutRevision);
    await markBookcasesSynced(sentCases);
  }

  Future<void> _pullAll(String token) async {
    var since = int.tryParse((await KvStore.get(_revKey)) ?? '0') ?? 0;
    var epoch = int.tryParse((await KvStore.get(_epochKey)) ?? '0') ?? 0;
    // 처음부터 받는 동안은 연도 책장을 남기지 않는다. 끝까지 받으면 지운다
    if (since == 0) await KvStore.set(pullAllKey, '1');
    final model = LibraryModel.instance;
    final dir = await _imageDir();
    var booksChanged = false;
    for (var guard = 0; guard < 200; guard++) {
      final p = (await api('GET', '/sync/pull?since=$since&limit=500', token))! as Map<String, Object?>;
      if (p['bookcases'] is List) _bookcasesSupported = true;
      // 새 서버에서 예전 커서가 놓쳤을 수 있는 기록을 한 번 처음부터 다시 받는다
      if (((p['syncEpoch'] as num?) ?? 0) >= 2 && epoch < 2) {
        await KvStore.set(_revKey, '0');
        await KvStore.set(_epochKey, '2');
        epoch = 2;
        if (since != 0) {
          since = 0;
          await KvStore.set(pullAllKey, '1');
          continue;
        }
      }
      final downloaded = <String>{};
      var applied = false;
      for (var retry = 0; retry < 20; retry++) {
        await model.flushPending();
        final pendingRows = await readPending();
        final m = mergeRemote(model.lib, p, dir, {for (final e in pendingRows.entries) e.key: (deleted: e.value.deleted, at: e.value.at)});
        final files = [for (final id in m.files) if (!downloaded.contains(id)) id];
        if (files.isNotEmpty) {
          await _downloadFiles(token, files); // 사진을 먼저 받아 두고 서재에 반영한다
          downloaded.addAll(files);
          continue; // 받는 동안 바뀐 로컬 기록을 다시 비교한다
        }
        if (m.writes.isNotEmpty || m.erases.isNotEmpty) {
          await model.applyRemote(m.writes, m.erases);
          booksChanged = true;
        }
        applied = true;
        break;
      }
      if (!applied) throw StateError('변경을 받아오지 못했어요. 다시 시도해 주세요');
      if (p['layout'] case final Map<String, Object?> l?) {
        if (await saveRemoteLayout(l['layoutJson']! as String, l['updatedAt']! as String)) booksChanged = true;
      }
      if (p['bookcases'] case final List<Object?> list when list.isNotEmpty) {
        for (final c in list.map(bookcaseFromWire).whereType<Bookcase>()) {
          await writeBookcase(c, synced: true);
        }
        await BookcaseStore.instance.load();
      }
      since = ((p['rev'] as num?) ?? since).toInt();
      await KvStore.set(_revKey, '$since');
      if (p['more'] != true) {
        await KvStore.remove(pullAllKey);
        break;
      }
    }
    // 받은 책·배치로 책장을 다시 그린다
    if (booksChanged) await PlacementStore.instance.reload();
  }

  Future<void> _requireSafeServer(String token) async {
    if (_verifiedToken == token) return;
    final r = (await api('GET', '/sync/pull?since=0&limit=1', token))! as Map;
    if (r['bookcases'] is List) _bookcasesSupported = true;
    // 낮은 revision이 나중에 커밋되면 변경을 놓칠 수 있는 구 서버에는 쓰지 않는다
    if (((r['syncEpoch'] as num?) ?? 0) < 2) throw StateError('서버 동기화 업데이트가 필요해요. 기록은 기기에 보관하고 있어요.');
    _verifiedToken = token;
  }

  Future<void> syncNow() async {
    if (_base.isEmpty) return;
    try {
      await _loadPause();
    } catch (e) {
      _set(state: SyncState.error, error: '$e');
      return;
    }
    if (paused) return;
    if (_linking || _running) {
      _again = true;
      return;
    }
    _running = true;
    BookcaseStore.instance.syncBusy = true;
    _runningDone = Completer<void>();
    _set(state: SyncState.syncing, error: null);
    try {
      var token = await _ensureToken();
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          await _requireSafeServer(token);
          await _pushOnce(token);
          await _pullAll(token);
          break;
        } on ApiError catch (e) {
          if (e.status == 401) {
            if (!deletionPending) await _pauseCloud();
            throw StateError('계정 인증이 만료됐거나 삭제되어 동기화를 중지했어요. 기기의 기록은 남아 있어요.');
          }
          if (e.code == 'missing_reference' && attempt == 0) {
            await queueAllChanges(fullDirty(LibraryModel.instance.lib)); // 부모가 서버에 없다 → 전부 올려 참조를 채운다
            token = await _ensureToken();
            continue;
          }
          rethrow;
        }
      }
      _set(state: SyncState.idle, lastAt: DateTime.now().toUtc().toIso8601String());
      if (!_providersChecked) _refreshProviders();
      if (!_accountChecked) {
        _accountChecked = true;
        _refreshAccount(token);
      }
    } catch (e) {
      _set(state: paused ? SyncState.off : SyncState.error, error: e is StateError ? e.message : '$e');
      _schedule(const Duration(minutes: 1)); // 연결이 안 되면 1분 뒤 다시
    } finally {
      _running = false;
      BookcaseStore.instance.syncBusy = false;
      await _refreshPending().catchError((_) {});
      // 동기화 중에는 연도 책장을 남기지 않았다: 끝나면 한 번 확인한다
      if (state == SyncState.idle) BookcaseStore.instance.checkYear().catchError((_) => null);
      _runningDone?.complete();
      _runningDone = null;
      if (_again) {
        _again = false;
        _schedule(const Duration(seconds: 1));
      }
    }
  }

  /// 서버 계정만 삭제한다. 요청 전에 동기화를 영구 중지하고, 진행 중인 쓰기가 끝난 뒤 요청한다
  Future<void> deleteCloudAccount() async {
    if (_base.isEmpty) throw StateError('서버 주소가 설정되지 않았어요');
    if (_linking) throw StateError('로그인 처리가 끝난 뒤 다시 시도해 주세요');
    _linking = true;
    try {
      await _loadPause();
      final token = await KvStore.get(_tokenKey);
      if (token == null) throw StateError('삭제할 서버 계정 인증이 없어요');
      await _pauseCloud(deleting: true);
      await _runningDone?.future;
      await api('DELETE', '/me', token, {'confirmation': 'DELETE'});
      // 서버 접수 확인을 먼저 기록한다. 이후 정리 도중 종료돼도 삭제 대기 상태로 갇히지 않는다
      await KvStore.set(_pauseKey, '1');
      deletionPending = false;
      await KvStore.remove(_tokenKey);
      await KvStore.remove(_revKey);
      await KvStore.remove(_filesKey);
      _verifiedToken = null;
      _accountChecked = false;
      _setAccount((kakao: false, google: false, nickname: ''));
      _set(state: SyncState.off, error: null);
    } finally {
      _linking = false;
    }
  }

  /// 사용자가 명시적으로 원할 때만 새 서버 계정을 만들고 이 기기의 기록을 다시 올린다
  Future<void> resumeCloudSync() async {
    await _loadPause();
    if (deletionPending) throw StateError('계정 삭제 요청을 먼저 완료해 주세요.');
    if (_linking || _running) throw StateError('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
    for (final k in [_tokenKey, _revKey, _filesKey, _pauseKey]) {
      await KvStore.remove(k);
    }
    paused = false;
    _verifiedToken = null;
    _accountChecked = false;
    _setAccount((kakao: false, google: false, nickname: ''));
    _set(state: SyncState.idle, error: null);
    await syncNow();
  }

  Future<void> _refreshAccount(String token) async {
    try {
      final me = (await api('GET', '/me', token))! as Map;
      if (await KvStore.get(_tokenKey) != token) return;
      final a = (kakao: me['kakao'] == true, google: me['google'] == true, nickname: (me['nickname'] as String?) ?? '');
      if (a != account) _setAccount(a);
    } catch (_) {
      // 표시용이라 실패해도 동기화는 계속한다
    }
  }

  void _schedule(Duration d) {
    if (_base.isEmpty || paused) return;
    _timer?.cancel();
    _timer = Timer(d, () {
      _timer = null;
      syncNow();
    });
  }

  /// 앱 시작 때 한 번: 바뀔 때마다 4초 뒤 묶어 올리고, 앱이 다시 앞으로 오면 받아 온다
  void start() {
    if (_started || _base.isEmpty) return;
    _started = true;
    _refreshProviders();
    _loadPause().catchError((Object e) => _set(state: SyncState.error, error: '$e'));
    _refreshPending().catchError((_) {});
    KvStore.get(_accountKey).then((raw) {
      try {
        if (raw == null) return;
        final a = jsonDecode(raw) as Map;
        account = (kakao: a['kakao'] == true, google: a['google'] == true, nickname: (a['nickname'] as String?) ?? '');
        notifyListeners();
      } catch (_) {
        // 깨진 값은 무시
      }
    });
    localDataChanged.addListener(() {
      _refreshPending().catchError((_) {});
      _schedule(const Duration(seconds: 4));
    });
    WidgetsBinding.instance.addObserver(this);
    _schedule(const Duration(milliseconds: 1500));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    _refreshProviders();
    _schedule(const Duration(milliseconds: 500));
  }
}

const _keep = Object();
