// 구운 줄 아틀라스를 휴대폰 캐시 폴더에 담아 두고 다음 실행에 다시 쓴다(지금 앱 ui/bake-cache.ts와 같은 방식).
// 굽기는 줄마다 GPU를 몇 초씩 쓴다. 책장이 그대로면 같은 그림이 나오므로, 굽는 데 들어가는 값 전부
// (면 자리·칸 수·법선·둘레·상자 목록·맞추기 값·셰이더)로 열쇠를 만들어 같은 열쇠의 그림이 있으면 굽지 않는다.
// 그림은 손실 없는 PNG로 담는다(다시 읽어도 화소가 같다)
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

import '../domain/shelf_row.dart';
import '../gen/light_uniforms.g.dart' as cal;
import '../services/cover_cache.dart' show decodeImageInLine;

/// 남겨 두는 그림 수(줄 수보다 넉넉히: 책을 옮기면 그 줄은 새 열쇠가 된다). 오래된 것부터 지운다
const _keep = 40;

Directory? _dir;

/// 읽어 둔 그림(이 캐시가 가진 것: 내줄 때는 clone, 받는 쪽이 자기 것을 버린다)
final Map<String, ui.Image> _mem = {};

/// 폴더에 있는 그림 파일(열쇠 → 파일). 그림은 필요할 때 하나씩 읽는다(켤 때 40장을 다 풀지 않는다)
final Map<String, File> _files = {};
Future<void>? _ready;

/// 굽기 결과를 정하는 값 전부 → 짧은 이름
String bakeKey(RowCase r) {
  final b = StringBuffer();
  // 셰이더가 바뀌면 옛 그림을 쓰면 안 된다(빌드마다 바뀌는 값을 넣는다)
  b.write('v1|');
  b.write('${r.env.u.join(',')}|');
  b.write('${r.bx.list.length}:');
  for (final v in r.bx.v) {
    b.write('${v.toStringAsFixed(6)},');
  }
  for (final it in r.items) {
    b.write('|${it.w}x${it.h};${it.self};');
    for (final v in [...it.o.list, ...it.u.list, ...it.v.list, ...it.n.list]) {
      b.write('${v.toStringAsFixed(6)},');
    }
  }
  for (final c in [cal.ECAM, cal.RADF, cal.RADU, cal.RADW, cal.RADE, cal.RADSL, cal.RADSR, cal.PAPER, cal.ALB_WALL, cal.ALB_PLANK]) {
    b.write('|${c.r},${c.g},${c.b}');
  }
  return sha1.convert(utf8.encode(b.toString())).toString().substring(0, 20);
}

/// 담아 둔 그림 목록을 한 번만 훑는다(오래된 것은 지운다). 실패하면 그냥 굽는다
Future<void> loadBakeCache() => _ready ??= () async {
      try {
        final base = await getTemporaryDirectory();
        final d = Directory('${base.path}/bake-v1');
        if (!d.existsSync()) d.createSync(recursive: true);
        _dir = d;
        final files = d.listSync().whereType<File>().where((f) => f.path.endsWith('.png')).toList()
          ..sort((a, b) => b.statSync().modified.compareTo(a.statSync().modified));
        for (final f in files.skip(_keep)) {
          f.deleteSync();
        }
        for (final f in files.take(_keep)) {
          _files[f.uri.pathSegments.last.replaceAll('.png', '')] = f;
        }
      } catch (e) {
        _dir = null;
      }
    }();

/// 같은 열쇠로 구워 둔 그림(받는 쪽 몫의 clone). 없으면 null
Future<ui.Image?> cachedBake(String key) async {
  var img = _mem[key];
  if (img == null) {
    final f = _files[key];
    if (f == null) return null;
    try {
      img = await decodeImageInLine(await f.readAsBytes());
    } catch (_) {
      img = null;
    }
    if (img == null) return null;
    _mem[key] = img;
  }
  return img.clone();
}

/// 새로 구운 그림을 담는다(PNG). 넘겨준 그림은 받는 쪽 것 그대로 두고 캐시는 clone을 가진다
Future<void> saveBake(String key, ui.Image image) async {
  _mem.remove(key)?.dispose();
  final own = image.clone();
  _mem[key] = own;
  final d = _dir;
  if (d == null) return;
  try {
    final data = await own.toByteData(format: ui.ImageByteFormat.png);
    if (data == null) return;
    final f = File('${d.path}/$key.png');
    await f.writeAsBytes(data.buffer.asUint8List(), flush: false);
    _files[key] = f;
  } catch (_) {
    // 담지 못해도 그리기에는 지장이 없다
  }
}

/// 담아 둔 그림 수(측정 로그용)
int get cachedCount => _files.length;

