// 책장에 그리는 표지·책등 그림(YES24 주소 등)을 기기에 받아 두고 읽는다. 지금 앱 services/cover-cache·ui/book3d/use-cover-image를 옮긴 것.
// 책은 사진을 기다리지 않는다: 기기에 있으면 바로 쓰고, 없으면 코드로 그린 장정을 먼저 보이고 받는 대로 바꾼다.
// 다시 받을 수 있는 그림이라 캐시 폴더에 두고, 90일 지난 것·150MB 넘는 것은 지운다(YES24 답변: 이미지는 일시 저장만).
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:path_provider/path_provider.dart';

const _downloadTimeout = Duration(seconds: 20);
const coverCacheMaxBytes = 150 * 1024 * 1024;
const coverCacheMaxAge = Duration(days: 90);

/// 주소 → 파일 이름(같은 주소는 늘 같은 파일, 지금 앱 coverFileName과 같은 해시)
String coverFileName(String uri) {
  var a = 0xdeadbeef, b = 0x41c6ce57;
  int imul(int x, int y) => (x * y) & 0xFFFFFFFF;
  for (final c in uri.codeUnits) {
    a = imul(a ^ c, 2654435761);
    b = imul(b ^ c, 1597334677);
  }
  return '${a.toRadixString(36)}${b.toRadixString(36)}.img';
}

Directory? _dir;
Future<Directory> _coverDir() async {
  final d = _dir ??= Directory('${(await getTemporaryDirectory()).path}/covers');
  if (!d.existsSync()) d.createSync(recursive: true);
  return d;
}

final _memory = <String, ui.Image>{};
const _memoryMax = 128;
final _running = <String, Future<ui.Image?>>{};

/// 이미 읽어 둔 그림(없으면 null)
ui.Image? coverInMemory(String uri) => _memory[uri];

void _remember(String uri, ui.Image img) {
  _memory.remove(uri);
  _memory[uri] = img;
  if (_memory.length > _memoryMax) _memory.remove(_memory.keys.first);
}

/// 해독은 한 번에 하나씩: 여럿을 한꺼번에 맡기면 에뮬레이터(Impeller GLES)에서 프레임이 끝나지 않았다(지금 앱도 책 그림을 한 권씩 기록한다)
Future<void> _decoding = Future.value();
/// 다른 그림(책장 시작 사진 등)도 표지와 같은 줄에서 한 장씩 해독한다(에뮬 Impeller GLES에서 동시에 맡기면 getNextFrame이 끝나지 않는다)
Future<ui.Image?> decodeImageInLine(Uint8List bytes) => _decode(bytes);

Future<ui.Image?> _decode(Uint8List bytes) {
  final done = _decoding.then((_) => _decodeNow(bytes));
  _decoding = done.then((_) {}, onError: (_) {});
  return done;
}

Future<ui.Image?> _decodeNow(Uint8List bytes) async {
  try {
    final codec = await ui.instantiateImageCodec(bytes);
    final img = (await codec.getNextFrame()).image;
    return img;
  } catch (e) {
    debugPrint('[flcover] decode failed $e');
    return null;
  }
}

/// 표지 그림을 받는다(기기에 있으면 그것, 없으면 내려받아 담아 둔다). 못 받으면 null(그 책은 코드로 그린 장정으로)
Future<ui.Image?> loadCover(String uri) {
  final hit = _memory[uri];
  if (hit != null) return Future.value(hit);
  // whenComplete에 꺼낸 값을 돌려주면 그 값(바로 이 약속)을 기다려 끝나지 않는다: 블록으로 지우기만
  return _running[uri] ??= _load(uri).whenComplete(() {
    _running.remove(uri);
  });
}

Future<ui.Image?> _load(String uri) async {
  final dir = await _coverDir();
  final file = File('${dir.path}/${coverFileName(uri)}');
  if (file.existsSync() && file.lengthSync() > 0) {
    final img = await _decode(await file.readAsBytes());
    if (img != null) {
      _remember(uri, img);
      return img;
    }
  }
  if (!uri.startsWith(RegExp(r'https?://', caseSensitive: false))) return null;
  final part = File('${file.path}.${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}.part');
  final client = HttpClient()..connectionTimeout = _downloadTimeout;
  try {
    final req = await client.getUrl(Uri.parse(uri)).timeout(_downloadTimeout);
    final res = await req.close().timeout(_downloadTimeout);
    if (res.statusCode != 200) {
      await res.drain<void>();
      debugPrint('[flcover] $uri status ${res.statusCode}');
      return null;
    }
    final sink = part.openWrite();
    await res.pipe(sink).timeout(_downloadTimeout);
    await part.rename(file.path);
    final img = await _decode(await file.readAsBytes());
    if (img != null) _remember(uri, img);
    return img;
  } catch (e) {
    debugPrint('[flcover] $uri failed $e');
    if (part.existsSync()) part.deleteSync();
    return null;
  } finally {
    client.close(force: true);
  }
}

/// 받아 둔 표지 정리(앱을 켠 뒤 한 번): 남은 조각 파일, 오래된 표지, 상한을 넘는 것(오래된 것부터)
Future<void> pruneCoverCache([int maxBytes = coverCacheMaxBytes]) async {
  try {
    final dir = await _coverDir();
    final files = <({File f, int size, DateTime at})>[];
    for (final e in dir.listSync()) {
      if (e is! File) continue;
      if (e.path.endsWith('.part')) {
        e.deleteSync();
        continue;
      }
      final st = e.statSync();
      if (DateTime.now().difference(st.modified) > coverCacheMaxAge) {
        e.deleteSync();
        continue;
      }
      files.add((f: e, size: st.size, at: st.modified));
    }
    files.sort((a, b) => b.at.compareTo(a.at));
    var total = 0;
    for (final x in files) {
      total += x.size;
      if (total > maxBytes) x.f.deleteSync();
    }
  } catch (_) {}
}
