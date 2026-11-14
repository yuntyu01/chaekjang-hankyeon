// 표지 그림에서 색·두께 맞추기(지금 앱 services/cover-palette·cover-accent·spine-ratio·cover-color-backfill).
// 표지를 작은 칸에 줄여 그려(가장 가까운 화소, Skia 기본과 같다) 화소를 읽고 domain/rebinding 규칙으로 색을 고른다. 그림은 화면에 그리지 않는다.
// 앱을 켠 뒤 뒤에서 한 번: 책 색(띠 색 또는 가장 넓은 색) → 장정에 저장, 두께(YES24 책등 사진 비율)·갈피 색 → 기기에 저장. 바뀌면 책장을 다시 그린다
library;

import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

import '../db/kv_store.dart';
import '../db/library_write.dart' show nowIso;
import '../domain/cover_url.dart';
import '../domain/rebinding.dart';
import '../store/library_model.dart';
import 'cover_cache.dart';

const _accentKey = 'cover-accents-v2';
const _spineKey = 'yes24-spine-ratios-v1';

/// 기기에 저장해 둔 갈피 색·책등 비율을 읽는다(책장을 그리기 전에)
Future<void> loadCoverMeasures() async {
  try {
    final a = await KvStore.get(_accentKey);
    if (a != null) loadCoverAccentEntries(jsonDecode(a) as List);
    final s = await KvStore.get(_spineKey);
    if (s != null) loadSpineRatioEntries(jsonDecode(s) as List);
  } catch (_) {
    // 못 읽으면 다시 재면 된다
  }
}

/// 그림의 한 부분(src, 원본 화소)을 w×h로 줄여 그린 RGBA 화소(가장 가까운 화소)
Future<List<int>?> _pixels(ui.Image img, ui.Rect src, int w, int h) async {
  final rec = ui.PictureRecorder();
  final c = ui.Canvas(rec);
  c.drawImageRect(img, src, ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), ui.Paint()..filterQuality = ui.FilterQuality.none);
  final pic = rec.endRecording();
  final out = await pic.toImage(w, h);
  pic.dispose();
  final data = await out.toByteData(format: ui.ImageByteFormat.rawStraightRgba);
  out.dispose();
  return data == null ? null : Uint8List.view(data.buffer);
}

ui.Rect _all(ui.Image img) => ui.Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble());

/// 책 색: 표지에서 책등과 맞닿는 좁은 띠(폭의 4~8%)가 거의 한 색이면 그 색, 아니면 표지에서 가장 넓은 색. 못 읽으면 null
Future<String?> coverDominantColor(String? url) async {
  if (url == null) return null;
  final img = await loadCover(url);
  if (img == null) return null;
  final strip = await _pixels(img, ui.Rect.fromLTWH(img.width * 0.04, 0, img.width * 0.04, img.height.toDouble()), 4, 144);
  final edge = strip == null ? null : edgeColorOf(strip);
  if (edge != null) return edge;
  final px = await _pixels(img, _all(img), 48, 72);
  return px == null ? null : dominantColorOf(px);
}

/// 갈피 색: 뽑은 색, 고를 색이 없으면 ''(=null 표시), 표지를 못 읽었으면 null(다음에 다시)
Future<({String? color})?> coverAccentColor(String? url) async {
  if (url == null) return null;
  final img = await loadCover(url);
  if (img == null) return null;
  final px = await _pixels(img, _all(img), 48, 72);
  return px == null ? null : (color: accentColorOf(px));
}

/// 표지 색 칸용 상위 색(median cut, 24×36)
Future<List<PaletteEntry>?> coverPalette(String? url, [int n = 3]) async {
  if (url == null) return null;
  final img = await loadCover(url);
  if (img == null) return null;
  final px = await _pixels(img, _all(img), 24, 36);
  if (px == null) return null;
  final p = extractPalette(px, n);
  return p.isEmpty ? null : p;
}

/// YES24 책등 사진의 폭/높이(그림은 쓰지 않고 실제 두께만). 책등 사진이 없는 책은 0, 받지 못하면 null
Future<double?> coverSpineRatio(String coverUri) async {
  final url = spineOfCover(coverUri, 'L');
  if (url == null) return 0;
  final img = await loadCover(url);
  if (img == null) return null;
  return isSpineImage(img.width, img.height) ? img.width / img.height : 0;
}

/// 새로 들인 책 한 권의 표지에서 책등 비율·갈피 색을 재어 둔다(책 추가: 처음 놓을 때부터 실제 두께·표지 색 갈피로)
Future<void> measureCover(String uri) async {
  try {
    if (needsSpineRatio(uri)) {
      final r = await coverSpineRatio(uri);
      if (r != null) {
        rememberSpineRatio(uri, r);
        await KvStore.set(_spineKey, jsonEncode(spineRatioEntries()));
      }
    }
    if (needsCoverAccent(uri)) {
      final a = await coverAccentColor(coverAtSize(uri, 'M'));
      if (a != null) {
        rememberCoverAccent(uri, a.color ?? '');
        await KvStore.set(_accentKey, jsonEncode(coverAccentEntries()));
      }
    }
  } catch (_) {
    // 못 재면 다음 시작 때 맞춘다
  }
}

/// 표지 색이 바뀌어 책장을 다시 그려야 할 때 하나씩 올린다(홈이 듣는다)
final shelfRefresh = ValueNotifier<int>(0);

bool _running = false;

/// 이미 등록한 책을 한 번 맞춘다(앱을 켜고 조금 뒤 뒤에서). 다 뽑은 뒤 한 번에 저장해 책장이 한 번만 다시 그려진다
Future<void> backfillCoverColors() async {
  if (_running) return;
  _running = true;
  try {
    final model = LibraryModel.instance;
    await model.load();
    final colors = <({String editionId, String color})>[];
    for (final p in pendingCoverColors(model.lib)) {
      final color = await coverDominantColor(coverAtSize(p.coverUri, 'L'));
      if (color != null) colors.add((editionId: p.editionId, color: color));
    }
    if (colors.isNotEmpty) await model.commitLib(withCoverColors(model.lib, colors, nowIso()));
    final lib = model.lib;
    final covers = [for (final b in lib.books.values) lib.editions[b.editionId]?.coverUri];
    var measured = false, accents = false;
    for (final uri in covers) {
      if (uri == null || !needsSpineRatio(uri)) continue;
      final r = await coverSpineRatio(uri);
      if (r == null) continue;
      rememberSpineRatio(uri, r);
      measured = true;
    }
    if (measured) await KvStore.set(_spineKey, jsonEncode(spineRatioEntries()));
    for (final uri in covers) {
      if (uri == null || !needsCoverAccent(uri)) continue;
      final a = await coverAccentColor(coverAtSize(uri, 'M'));
      if (a == null) continue;
      rememberCoverAccent(uri, a.color ?? '');
      accents = true;
    }
    if (accents) await KvStore.set(_accentKey, jsonEncode(coverAccentEntries()));
    if (colors.isNotEmpty || measured || accents) {
      // ignore: avoid_print
      print('[covers] colors ${colors.length} spine $measured accents $accents');
      shelfRefresh.value++;
    }
  } finally {
    _running = false;
  }
}
