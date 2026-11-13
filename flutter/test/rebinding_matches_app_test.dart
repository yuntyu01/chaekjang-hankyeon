// 재장정 색 규칙이 지금 앱과 같은지(tool/dump_rebinding.test.ts가 지금 앱 함수로 뽑은 값)
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/rebinding.dart';
import 'package:flutter_test/flutter_test.dart';

typedef J = Map<String, dynamic>;

List<PaletteEntry>? _pal(Object? v) => v == null ? null : [for (final e in (v as List).cast<J>()) PaletteEntry(e['hex'], (e['weight'] as num).toDouble())];
Object _palJson(List<PaletteEntry> p) => [for (final e in p) {'hex': e.hex, 'weight': e.weight}];

void main() {
  final d = jsonDecode(File('test/fixtures/rebinding_cases.json').readAsStringSync()) as J;

  test('색 변환·글자색·강조색·추천 색', () {
    for (final c in (d['hsl'] as List).cast<J>()) {
      final s = c['c'] as String;
      final h = hexToHsl(s);
      final want = c['hsl'] as J;
      expect([h.h, h.s, h.l].map((v) => v.toStringAsFixed(9)), [want['h'], want['s'], want['l']].map((v) => (v as num).toDouble().toStringAsFixed(9)), reason: s);
      expect(hslToHex(h.h, h.s, h.l), c['back'], reason: s);
      expect(isAchromatic(s), c['achro'], reason: s);
      expect(tameToPalette(s), c['tame'], reason: s);
      final ink = inkFor(tameToPalette(s));
      expect([ink.base, ink.ink], [(c['ink'] as J)['base'], (c['ink'] as J)['ink']], reason: s);
      final raw = inkFor(s);
      expect([raw.base, raw.ink], [(c['inkRaw'] as J)['base'], (c['inkRaw'] as J)['ink']], reason: s);
      expect(accentFor(s), c['accent'], reason: s);
      final t = tonesFor(s);
      expect([t.inkColor, t.accentColor], [(c['tones'] as J)['inkColor'], (c['tones'] as J)['accentColor']], reason: s);
      expect(suggestColors(s), c['suggest'], reason: s);
    }
    expect([for (final b in bookColors) {'name': b.name, 'hex': b.hex}], d['bookColors']);
  });

  test('해시·시리즈 색·조판 변형', () {
    for (final c in (d['hashes'] as List).cast<J>()) {
      final s = c['s'] as String;
      expect(hash32(s), c['h'], reason: s);
      expect(seriesBase(s.isEmpty ? 'x' : s, 'v1'), c['series'], reason: s);
      expect(layoutFor(s.isEmpty ? null : s, 'seed'), c['layout'], reason: s);
    }
  });

  test('기준색·분야·모티프', () {
    for (final c in (d['picks'] as List).cast<J>()) {
      expect(pickSourceColor(_pal(c['palette']), c['theme'], '모순'), c['out'], reason: jsonEncode(c));
    }
    for (final c in (d['genres'] as List).cast<J>()) {
      expect(genreOf(c['c'], c['t']), c['g'], reason: jsonEncode(c));
      expect(pickMotif(c['c'], c['t'], 's'), c['m'], reason: jsonEncode(c));
    }
  });

  test('장정 만들기', () {
    for (final c in (d['arts'] as List).cast<J>()) {
      final i = c['input'] as J;
      final art = buildBookArt(
        RebindInput(
          title: i['title'],
          isbn: i['isbn'],
          category: i['category'],
          seriesTitle: i['seriesTitle'],
          pageCount: i['pageCount'],
          heightMm: i['heightMm'],
          coverColor: i['coverColor'],
          themeColor: i['themeColor'],
          palette: _pal(i['palette']),
        ),
        '2026-11-14T00:00:00.000Z',
      );
      expect(art.toJson(), c['art'], reason: jsonEncode(i));
    }
  });

  test('표지 화소에서 색 뽑기', () {
    for (final c in (d['pixels'] as List).cast<J>()) {
      final px = (c['px'] as List).cast<int>();
      final why = 'seed ${c['seed']}';
      expect(dominantColorOf(px), c['dominant'], reason: why);
      expect(accentColorOf(px), c['accent'], reason: why);
      expect(edgeColorOf(px), c['edge'], reason: why);
      expect(_palJson(extractPalette(px, 3)), c['palette3'], reason: why);
      final p6 = extractPalette(px, 6);
      expect(_palJson(p6), c['palette'], reason: why);
      expect(coverSwatches(p6), c['swatches'], reason: why);
    }
  });
}
