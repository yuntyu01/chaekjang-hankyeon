// 글꼴 파일(TrueType)에서 글자마다 나아가기 폭과 잉크 상자를 읽는다.
// 지금 앱은 Skia measureText(잉크 상자)와 getGlyphWidths(나아가기 폭)로 제목을 한 글자씩 놓는다.
// Flutter 글자 그리기(Paragraph)는 나아가기 폭만 알려 주므로, 같은 값을 쓰려고 글꼴 표(cmap·hmtx·loca·glyf)를 직접 읽는다.
library;

import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;

class GlyphMetrics {
  GlyphMetrics._(this._d, this.unitsPerEm, this.ascender, this.descender, this._hmtx, this._nH, this._loca, this._glyf,
      this._longLoca, this._cmap);

  final ByteData _d;
  final int unitsPerEm;

  /// hhea 올림·내림(글꼴 단위, 내림은 음수)
  final int ascender;
  final int descender;
  final int _hmtx;
  final int _nH;
  final int _loca;
  final int _glyf;
  final bool _longLoca;
  final Map<int, int> _cmap;

  static final Map<String, GlyphMetrics> _cache = {};

  /// 자산의 글꼴을 읽는다(한 번만)
  static Future<GlyphMetrics> load(String asset) async {
    final hit = _cache[asset];
    if (hit != null) return hit;
    final data = await rootBundle.load(asset);
    return _cache[asset] = parse(data);
  }

  static GlyphMetrics parse(ByteData d) {
    final n = d.getUint16(4);
    final tables = <String, int>{};
    for (var i = 0; i < n; i++) {
      final at = 12 + i * 16;
      final tag = String.fromCharCodes([d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3)]);
      tables[tag] = d.getUint32(at + 8);
    }
    final head = tables['head']!;
    final hhea = tables['hhea']!;
    final cmap = tables['cmap']!;
    return GlyphMetrics._(
      d,
      d.getUint16(head + 18),
      d.getInt16(hhea + 4),
      d.getInt16(hhea + 6),
      tables['hmtx']!,
      d.getUint16(hhea + 34),
      tables['loca'] ?? 0,
      tables['glyf'] ?? 0,
      d.getInt16(head + 50) == 1,
      _readCmap(d, cmap),
    );
  }

  /// 유니코드 → 글자 번호(형식 12 우선, 없으면 4)
  static Map<int, int> _readCmap(ByteData d, int cmap) {
    final n = d.getUint16(cmap + 2);
    int? f4, f12;
    for (var i = 0; i < n; i++) {
      final at = cmap + 4 + i * 8;
      final pid = d.getUint16(at), eid = d.getUint16(at + 2);
      final off = cmap + d.getUint32(at + 4);
      final format = d.getUint16(off);
      if (format == 12 && pid == 3 && eid == 10) f12 = off;
      if (format == 4 && pid == 3 && (eid == 1 || eid == 0)) f4 = off;
      if (format == 12 && pid == 0) f12 ??= off;
      if (format == 4 && pid == 0) f4 ??= off;
    }
    final out = <int, int>{};
    if (f12 != null) {
      final groups = d.getUint32(f12 + 12);
      for (var g = 0; g < groups; g++) {
        final at = f12 + 16 + g * 12;
        final start = d.getUint32(at), end = d.getUint32(at + 4), gid = d.getUint32(at + 8);
        for (var c = start; c <= end; c++) {
          out[c] = gid + c - start;
        }
      }
      return out;
    }
    if (f4 == null) return out;
    final segX2 = d.getUint16(f4 + 6);
    final ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (var s = 0; s < segX2 ~/ 2; s++) {
      final end = d.getUint16(ends + s * 2), start = d.getUint16(starts + s * 2);
      final delta = d.getInt16(deltas + s * 2), rangeAt = ranges + s * 2, range = d.getUint16(rangeAt);
      for (var c = start; c <= end && c != 0xFFFF; c++) {
        int gid;
        if (range == 0) {
          gid = (c + delta) & 0xFFFF;
        } else {
          final g = d.getUint16(rangeAt + range + (c - start) * 2);
          gid = g == 0 ? 0 : (g + delta) & 0xFFFF;
        }
        if (gid != 0) out[c] = gid;
      }
    }
    return out;
  }

  int glyphOf(int codePoint) => _cmap[codePoint] ?? 0;

  /// 나아가기 폭(글자 크기 fs에서)
  double advance(int codePoint, double fs) {
    final g = glyphOf(codePoint);
    final i = g < _nH ? g : _nH - 1;
    return _d.getUint16(_hmtx + i * 4) * fs / unitsPerEm;
  }

  /// 잉크 상자 왼쪽·오른쪽(글자 원점 기준, 글자 크기 fs에서). 빈 글자는 (0, 0)
  ({double x0, double x1}) ink(int codePoint, double fs) {
    if (_glyf == 0) return (x0: 0, x1: advance(codePoint, fs));
    final g = glyphOf(codePoint);
    final a = _longLoca ? _d.getUint32(_loca + g * 4) : _d.getUint16(_loca + g * 2) * 2;
    final b = _longLoca ? _d.getUint32(_loca + g * 4 + 4) : _d.getUint16(_loca + g * 2 + 2) * 2;
    if (b <= a) return (x0: 0, x1: 0);
    final at = _glyf + a;
    final k = fs / unitsPerEm;
    return (x0: _d.getInt16(at + 2) * k, x1: _d.getInt16(at + 6) * k);
  }

  /// Skia 글꼴 올림·내림(올림은 음수, 내림은 양수 — SkFontMetrics와 같은 부호)
  double ascent(double fs) => -ascender * fs / unitsPerEm;
  double descent(double fs) => -descender * fs / unitsPerEm;
}

/// 제목 글꼴 파일
const titleFontAsset = 'assets/fonts/Hahmlet-SemiBold.ttf';
