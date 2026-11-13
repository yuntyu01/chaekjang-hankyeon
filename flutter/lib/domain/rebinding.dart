// 재장정(앱 장정, 지금 앱 domain/rebinding.ts): 책 정보 → 앱이 입힐 장정 값. 같은 입력이면 같은 출력(시간·무작위 없음).
// 표지 썸네일은 색 추출에만 쓴다(화면에 그리지 않는다). 같은지는 test/rebinding_matches_app_test.dart
library;

import 'dart:math' as math;

import 'color.dart';
import 'library.dart';

const rebindVersion = 4;
const satRange = (0.25, 0.55);
const lightRange = (0.35, 0.8);
const minContrast = 4.5;
const layoutVariants = ['spine_a', 'spine_b', 'spine_c'];

class PaletteEntry {
  const PaletteEntry(this.hex, this.weight);
  final String hex;
  final double weight;
}

class RebindInput {
  const RebindInput({required this.title, this.isbn, this.authors, this.publisher, this.publishedYear, this.pageCount, this.heightMm, this.widthMm, this.category, this.seriesTitle, this.palette, this.themeColor, this.coverColor});
  final String title;
  final String? isbn, publisher, category, seriesTitle, themeColor, coverColor;
  final List<String>? authors;
  final int? publishedYear;
  final num? pageCount, heightMm, widthMm;
  final List<PaletteEntry>? palette;
}

class BookArt {
  const BookArt(this.baseColor, this.inkColor, this.accentColor, this.motifId, this.layoutVariant, this.heightClass, this.thicknessClass, this.generatedAt, this.version);
  final String baseColor, inkColor, accentColor, motifId, layoutVariant, heightClass, thicknessClass, generatedAt;
  final int version;
  Map<String, Object> toJson() => {
        'baseColor': baseColor,
        'inkColor': inkColor,
        'accentColor': accentColor,
        'motifId': motifId,
        'layoutVariant': layoutVariant,
        'heightClass': heightClass,
        'thicknessClass': thicknessClass,
        'generatedAt': generatedAt,
        'version': version,
      };
}

// ---------- 색 ----------
List<int> _rgb(String hex) {
  var h = hex.replaceAll('#', '');
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  final n = int.parse(h, radix: 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/// h 0~360, s·l 0~1
({double h, double s, double l}) hexToHsl(String hex) {
  final c = _rgb(hex).map((v) => v / 255).toList();
  final r = c[0], g = c[1], b = c[2];
  final mx = math.max(r, math.max(g, b)), mn = math.min(r, math.min(g, b));
  final l = (mx + mn) / 2, d = mx - mn;
  if (d == 0) return (h: 0, s: 0, l: l);
  final s = d / (1 - (2 * l - 1).abs());
  // JS % 는 부호를 따른다(음수 그대로): (g-b)/d % 6
  double h = mx == r ? ((g - b) / d).remainder(6) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360).remainder(360);
  return (h: h, s: s, l: l);
}

String hslToHex(double h, double s, double l) {
  final c = (1 - (2 * l - 1).abs()) * s;
  final x = c * (1 - ((h / 60).remainder(2) - 1).abs());
  final m = l - c / 2;
  final (r, g, b) = h < 60
      ? (c, x, 0.0)
      : h < 120
          ? (x, c, 0.0)
          : h < 180
              ? (0.0, c, x)
              : h < 240
                  ? (0.0, x, c)
                  : h < 300
                      ? (x, 0.0, c)
                      : (c, 0.0, x);
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

double _clamp(double v, double lo, double hi) => math.max(lo, math.min(hi, v));

/// 흰·검·회색(무채색): 채도가 낮거나 아주 밝거나 아주 어두움
bool isAchromatic(String hex) {
  final c = hexToHsl(hex);
  return c.s < 0.14 || c.l > 0.92 || c.l < 0.1;
}

int _imul(int a, int b) => (a * b) & 0xFFFFFFFF;

/// 문자열 해시(FNV-1a + 마지막 섞기, 지금 앱 hash32: 코드 포인트마다 첫 UTF-16 칸)
int hash32(String s) {
  var h = 2166136261;
  for (final r in s.runes) {
    final c = r > 0xFFFF ? 0xD800 + ((r - 0x10000) >> 10) : r;
    h = _imul(h ^ c, 16777619);
  }
  h ^= h >> 16;
  h = _imul(h, 0x85ebca6b);
  h ^= h >> 13;
  h = _imul(h, 0xc2b2ae35);
  h ^= h >> 16;
  return h & 0xFFFFFFFF;
}

const _neutrals = ['#CDBF9F', '#4A4F57', '#6F7F8F'];
final _hexRe = RegExp(r'^#[\da-f]{3}([\da-f]{3})?$', caseSensitive: false);
final _hex6 = RegExp(r'^#[\da-f]{6}$', caseSensitive: false);

/// 썸네일 상위 색 → 기준색. 흰·검·회색이 70%를 넘으면 2순위 유채색, 전부 무채색이면 중립 3색 중 해시
String pickSourceColor(List<PaletteEntry>? palette, String? themeColor, String seed) {
  final list = [for (final (i, p) in (palette ?? const <PaletteEntry>[]).indexed) if (_hexRe.hasMatch(p.hex)) (i, p)]
    ..sort((a, b) {
      final c = b.$2.weight.compareTo(a.$2.weight);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  final ps = [for (final x in list) x.$2];
  if (ps.isEmpty) return themeColor != null && _hex6.hasMatch(themeColor) ? themeColor : _neutrals[hash32(seed) % _neutrals.length];
  final total = ps.fold<double>(0, (a, p) => a + p.weight);
  final t = total == 0 ? 1 : total;
  final achromaticShare = ps.where((p) => isAchromatic(p.hex)).fold<double>(0, (a, p) => a + p.weight) / t;
  final chromatic = ps.where((p) => !isAchromatic(p.hex)).toList();
  if (chromatic.isEmpty) return _neutrals[hash32(seed) % _neutrals.length];
  if (isAchromatic(ps.first.hex) && achromaticShare > 0.7) return chromatic.first.hex;
  return ps.first.hex;
}

/// 팔레트 범위로 보정(형광·원색이 와도 선반 톤 유지)
String tameToPalette(String hex) {
  final c = hexToHsl(hex);
  return hslToHex(c.h, _clamp(c.s, satRange.$1, satRange.$2), _clamp(c.l, lightRange.$1, lightRange.$2));
}

String _best(String b) => contrast(titleDark, b) >= contrast(titleLight, b) ? titleDark : titleLight;

/// 글자색: 먹/밝은 색 중 대비가 큰 쪽. 4.5:1에 못 미치면 바탕 명도를 팔레트 범위 안에서 밀어 맞춘다
({String base, String ink}) inkFor(String base) {
  final ink = _best(base);
  if (contrast(ink, base) >= minContrast) return (base: base, ink: ink);
  final c = hexToHsl(base);
  for (var d = 0.01; d <= 0.5; d += 0.01) {
    for (final dir in const [-1, 1]) {
      final l = _clamp(c.l + dir * d, lightRange.$1, lightRange.$2);
      final b = hslToHex(c.h, c.s, l);
      final i = _best(b);
      if (contrast(i, b) >= minContrast) return (base: b, ink: i);
    }
  }
  return (base: base, ink: ink);
}

/// 띠·모티프 색: 바탕의 보색 계열을 톤 다운
String accentFor(String base) {
  final c = hexToHsl(base);
  final l = c.l > 0.58 ? c.l - 0.26 : c.l + 0.3;
  return hslToHex((c.h + 165).remainder(360), _clamp(c.s * 0.8, 0.22, 0.4), _clamp(l, 0.25, 0.86));
}

/// 같은 시리즈는 같은 색 계열
String seriesBase(String seriesTitle, String volumeSeed) {
  final h = hash32(seriesTitle);
  final hue = ((h % 360) + 360) % 360;
  final l = 0.46 + ((hash32(volumeSeed) % 7) - 3) * 0.015;
  return hslToHex(hue.toDouble(), 0.34 + ((h >> 9) % 10) * 0.01, l);
}

/// 색 5개 추천: 보정된 기본색 + 같은 색상각의 명도·채도 변형 + 보색 계열
List<String> suggestColors(String base) {
  final c = hexToHsl(tameToPalette(base));
  String mk(double h, double s, double l) => inkFor(tameToPalette(hslToHex((h + 360).remainder(360), s, l))).base;
  final out = [
    inkFor(tameToPalette(base)).base,
    mk(c.h, c.s, _clamp(c.l - 0.14, 0.35, 0.8)),
    mk(c.h, c.s, _clamp(c.l + 0.16, 0.35, 0.8)),
    mk(c.h + 30, c.s, c.l),
    mk(c.h + 180, c.s * 0.9, c.l),
  ];
  return out.toSet().toList();
}

const _colorSeeds = [
  ('샌드', '#CDBF9F'), ('크림', '#E2D4B4'), ('살구', '#EBB99A'), ('코랄', '#E0937F'), ('로즈', '#D49A9E'), ('먼지분홍', '#D6ADAA'),
  ('와인', '#9A4F57'), ('테라코타', '#B5694A'), ('머스터드', '#D4A94C'), ('카멜', '#B58B5C'), ('초콜릿', '#6E4B3A'), ('올리브', '#8A8F5A'),
  ('세이지', '#A9B995'), ('민트', '#9CCBB8'), ('숲', '#527A54'), ('청록', '#4D8A8A'), ('하늘', '#8DB5D6'), ('파랑', '#5877AE'),
  ('남색', '#3F5280'), ('슬레이트', '#6B7F92'), ('라벤더', '#A9A3CE'), ('보라', '#7B6B9E'), ('자두', '#80526F'), ('먹색', '#4A4F57'),
];

/// 고를 수 있는 책 색(이름 포함)
final bookColors = [for (final (name, hex) in _colorSeeds) (name: name, hex: inkFor(tameToPalette(hex)).base)];

// ---------- 모티프 ----------
const motifSlotIds = ['leaf', 'sprig', 'cotton', 'moon', 'crescent', 'star', 'constellation', 'wave', 'ripple', 'flower', 'wildflower', 'tulip', 'camellia', 'pine', 'mountain', 'cloud', 'sun', 'rain', 'snow', 'feather', 'bird', 'cat', 'teacup', 'candle', 'key', 'letter', 'window', 'lantern', 'shell', 'mushroom'];

const _genreMotifs = {
  'novel': ['sprig', 'moon', 'wave', 'bird', 'window', 'lantern'],
  'poem': ['feather', 'flower', 'wildflower', 'rain', 'crescent'],
  'essay': ['leaf', 'cloud', 'cotton', 'teacup', 'shell'],
  'science': ['star', 'constellation', 'sun', 'key', 'snow'],
  'history': ['key', 'letter', 'lantern', 'mountain', 'pine'],
  'thought': ['candle', 'moon', 'mountain', 'window', 'ripple'],
  'society': ['window', 'key', 'letter', 'sun', 'cloud'],
  'art': ['tulip', 'camellia', 'flower', 'feather', 'teacup'],
  'tech': ['key', 'star', 'constellation', 'sun'],
  'child': ['cat', 'bird', 'mushroom', 'cotton', 'sun'],
  'general': motifSlotIds,
};

final _keywords = [
  ('poem', RegExp(r'시집|동시|^시$|^시\/희곡$|>시$')),
  ('child', RegExp(r'그림책|동화|어린이|유아|청소년')),
  ('novel', RegExp(r'소설|희곡|장편|단편|판타지|추리|스릴러|SF', caseSensitive: false)),
  ('essay', RegExp(r'에세이|수필|산문|여행|일기')),
  ('science', RegExp(r'과학|물리|화학|수학|천문|생물|우주|뇌')),
  ('history', RegExp(r'역사|전쟁|왕조|고대|조선|문명')),
  ('thought', RegExp(r'철학|종교|심리|명상|불교|기독교|인문')),
  ('society', RegExp(r'사회|정치|경제|경영|법|교육|사회과학')),
  ('art', RegExp(r'예술|미술|음악|사진|영화|건축|디자인')),
  ('tech', RegExp(r'기술|공학|컴퓨터|프로그래밍|IT|코딩', caseSensitive: false)),
];

/// KDC 백의 자리 → 분야(8xx는 문학이라 세분), 아니면 분류 경로·제목의 낱말로
String genreOf(String? category, [String title = '']) {
  final cat = (category ?? '').trim();
  final kdc = RegExp(r'^(\d{3})(?:\.\d+)?$').firstMatch(cat);
  if (kdc != null) {
    final n = kdc[1]!;
    if (n.startsWith('81') && n[2] == '1') return 'poem';
    if (n.startsWith('81') && n[2] == '4') return 'essay';
    switch (n[0]) {
      case '1' || '2':
        return 'thought';
      case '3':
        return 'society';
      case '4':
        return 'science';
      case '5':
        return 'tech';
      case '6':
        return 'art';
      case '8':
        return 'novel';
      case '9':
        return 'history';
    }
  }
  final parts = cat.split('>').map((x) => x.trim()).where((x) => x.isNotEmpty).toList().reversed;
  for (final part in parts) {
    for (final (g, re) in _keywords) {
      if (re.hasMatch(part)) return g;
    }
  }
  for (final (g, re) in _keywords) {
    if (g != 'poem' && re.hasMatch(title)) return g;
  }
  return 'general';
}

String pickMotif(String? category, String title, [String seed = '']) {
  final group = _genreMotifs[genreOf(category, title)]!;
  return group[hash32('$title|$seed') % group.length];
}

String layoutFor(String? seriesTitle, String seed) => layoutVariants[hash32(seriesTitle != null ? 'series:$seriesTitle' : 'book:$seed') % layoutVariants.length];

String heightClassOf(num h) => h < 180 ? 'short' : h < 215 ? 'medium' : 'tall';
String thicknessClassOf(num p) => p < 220 ? 'thin' : p < 420 ? 'medium' : 'thick';

// ---------- 본체 ----------
BookArt buildBookArt(RebindInput input, [String now = '']) {
  final seed = (input.isbn != null && input.isbn!.isNotEmpty) ? input.isbn! : input.title;
  final st = input.seriesTitle?.trim();
  final series = st == null || st.isEmpty ? null : st;
  final real = input.coverColor != null && _hex6.hasMatch(input.coverColor!) ? input.coverColor : null;
  final source = series != null ? seriesBase(series, seed) : pickSourceColor(input.palette, input.themeColor, seed);
  final bi = real != null ? (base: real, ink: tonesFor(real).inkColor) : inkFor(tameToPalette(source));
  return BookArt(bi.base, bi.ink, accentFor(bi.base), pickMotif(input.category, input.title, series ?? ''), layoutFor(series, seed),
      heightClassOf(input.heightMm ?? 188), thicknessClassOf(input.pageCount ?? 250), now, rebindVersion);
}

/// 바탕색에 맞는 글자색·강조색(바탕은 그대로, 글자색만 대비 큰 쪽)
({String inkColor, String accentColor}) tonesFor(String base) => (inkColor: _best(base), accentColor: accentFor(base));

// ---------- 썸네일 색 추출 ----------
const _paperWhite = 237;

class _Bin {
  int n = 0;
  int r = 0, g = 0, b = 0;
}

/// 비슷한 색끼리(채널마다 8단계) 묶은 칸(처음 나온 차례)
({List<_Bin> bins, int total}) _colorBins(List<int> rgba) {
  final bins = <int, _Bin>{};
  var total = 0;
  for (var i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    final key = ((rgba[i] >> 5) << 6) | ((rgba[i + 1] >> 5) << 3) | (rgba[i + 2] >> 5);
    final bin = bins.putIfAbsent(key, _Bin.new);
    bin.n++;
    bin.r += rgba[i];
    bin.g += rgba[i + 1];
    bin.b += rgba[i + 2];
    total++;
  }
  return (bins: bins.values.toList(), total: total);
}

({String hex, double share})? _topColor(List<int> rgba) {
  final c = _colorBins(rgba);
  _Bin? top;
  for (final bin in c.bins) {
    if (top == null || bin.n > top.n) top = bin;
  }
  if (top == null) return null;
  final r = top.r / top.n, g = top.g / top.n, b = top.b / top.n;
  final k = math.min(1.0, _paperWhite / math.max(r, math.max(g, b)));
  return (hex: rgbHex(r * k, g * k, b * k), share: top.n / c.total);
}

/// 표지에서 가장 넓게 차지하는 색(종이 흰색까지만 밝게)
String? dominantColorOf(List<int> rgba) => _topColor(rgba)?.hex;

const accentMinShare = 0.03;
const _accentSpeck = 0.002;

/// 갈피 색: 넓은 순서로 흰·검·회색이 아닌 첫 색(3% 이상), 그만한 색이 없으면 작아도 뚜렷한 색. 0.2% 아래는 잡티
String? accentColorOf(List<int> rgba) {
  final c = _colorBins(rgba);
  final sorted = [for (final (i, b) in c.bins.indexed) (i, b)]
    ..sort((a, b) {
      final d = b.$2.n.compareTo(a.$2.n);
      return d != 0 ? d : a.$1.compareTo(b.$1);
    });
  for (final (_, bin) in sorted) {
    final share = bin.n / c.total;
    if (share < _accentSpeck) return null;
    final hex = rgbHex(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n);
    if (share >= accentMinShare ? !isNeutralColor(hex) : isVividColor(hex)) return hex;
  }
  return null;
}

const edgeMinShare = 0.7;

/// 표지에서 책등과 맞닿는 좁은 띠의 색: 한 색이 띠의 70% 이상일 때만
String? edgeColorOf(List<int> rgba) {
  final t = _topColor(rgba);
  return t != null && t.share >= edgeMinShare ? t.hex : null;
}

/// 표지 색 칸: 많은 순서로 최대 5색(3% 미만·거의 같은 색은 뺀다)
List<String> coverSwatches(List<PaletteEntry>? palette, [int max = 5]) {
  final out = <({String hex, List<double> rgb})>[];
  final sorted = [for (final (i, e) in (palette ?? const <PaletteEntry>[]).indexed) (i, e)]
    ..sort((a, b) {
      final d = b.$2.weight.compareTo(a.$2.weight);
      return d != 0 ? d : a.$1.compareTo(b.$1);
    });
  for (final (_, e) in sorted) {
    if (e.weight < 0.03 || out.length >= max) continue;
    final c = [for (final i in [1, 3, 5]) int.parse(e.hex.substring(i, i + 2), radix: 16)];
    final k = math.min(1.0, _paperWhite / c.reduce(math.max));
    final rgb = [for (final v in c) v * k];
    if (out.any((o) => math.sqrt(math.pow(o.rgb[0] - rgb[0], 2) + math.pow(o.rgb[1] - rgb[1], 2) + math.pow(o.rgb[2] - rgb[2], 2)) < 28)) continue;
    out.add((hex: rgbHex(rgb[0], rgb[1], rgb[2]), rgb: rgb));
  }
  return [for (final o in out) o.hex];
}

/// median cut: 상위 n색과 비중(투명 화소는 건너뛴다)
List<PaletteEntry> extractPalette(List<int> rgba, [int n = 3]) {
  final px = <List<int>>[];
  for (var i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] >= 128) px.add([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (px.isEmpty) return const [];
  var boxes = <List<List<int>>>[px];
  List<int> spread(List<List<int>> b) => [
        for (var ch = 0; ch < 3; ch++) b.map((p) => p[ch]).reduce(math.max) - b.map((p) => p[ch]).reduce(math.min),
      ];
  while (boxes.length < n) {
    final scored = [
      for (final (i, b) in boxes.indexed)
        if (spread(b).reduce(math.max) > 0) (i: i, b: b, r: spread(b)),
    ]..sort((a, c) {
        final d = (c.b.length * c.r.reduce(math.max)).compareTo(a.b.length * a.r.reduce(math.max));
        return d != 0 ? d : a.i.compareTo(c.i);
      });
    if (scored.isEmpty) break;
    final box = scored.first.b;
    boxes = [for (final b in boxes) if (!identical(b, box)) b];
    final range = scored.first.r;
    final axis = range.indexOf(range.reduce(math.max));
    // JS sort(안정)와 같게: 같은 값은 원래 차례
    final idx = [for (var i = 0; i < box.length; i++) i]..sort((a, b) {
        final d = box[a][axis].compareTo(box[b][axis]);
        return d != 0 ? d : a.compareTo(b);
      });
    final sortedBox = [for (final i in idx) box[i]];
    var mid = sortedBox.length >> 1;
    for (var d = 0; d < sortedBox.length; d++) {
      if (mid - d > 0 && sortedBox[mid - d - 1][axis] != sortedBox[mid - d][axis]) {
        mid -= d;
        break;
      }
      if (mid + d < sortedBox.length && mid + d - 1 >= 0 && sortedBox[mid + d - 1][axis] != sortedBox[mid + d][axis]) {
        mid += d;
        break;
      }
    }
    boxes.add(sortedBox.sublist(0, mid));
    boxes.add(sortedBox.sublist(mid));
  }
  final entries = [
    for (final (i, b) in boxes.indexed)
      if (b.isNotEmpty)
        (
          i,
          PaletteEntry(
            rgbHex(b.fold<int>(0, (a, p) => a + p[0]) / b.length, b.fold<int>(0, (a, p) => a + p[1]) / b.length, b.fold<int>(0, (a, p) => a + p[2]) / b.length),
            b.length / px.length,
          )
        ),
  ]..sort((a, b) {
      final d = b.$2.weight.compareTo(a.$2.weight);
      return d != 0 ? d : a.$1.compareTo(b.$1);
    });
  return [for (final e in entries) e.$2];
}

// ---------- 이미 등록한 책의 표지 색 맞추기(지금 앱 library.ts pendingCoverColors·withCoverColors·rebindInput) ----------

/// 표지 색을 아직 맞추지 않은 판본(YES24 등 도서 이미지 표지, 장정 판이 옛 규칙)
List<({String editionId, String coverUri})> pendingCoverColors(Library lib) => [
      for (final e in lib.editions.values)
        if (e.coverSource == 'api' && e.coverUri != null && (e.art?.version ?? 1) < rebindVersion) (editionId: e.id, coverUri: e.coverUri!),
    ];

RebindInput rebindInput(Edition e, {String? coverColor}) {
  final year = int.tryParse((e.publishedAt ?? '').length >= 4 ? e.publishedAt!.substring(0, 4) : '') ?? 0;
  return RebindInput(
    title: e.title,
    isbn: e.isbn13,
    authors: e.authors,
    publisher: e.publisher,
    publishedYear: year > 0 ? year : null,
    pageCount: e.pageCount,
    heightMm: e.heightMm,
    widthMm: e.widthMm,
    category: e.category,
    seriesTitle: e.seriesTitle,
    coverColor: coverColor,
  );
}

BookArtParams _params(BookArt a) =>
    BookArtParams(a.baseColor, a.inkColor, a.accentColor, a.motifId, a.layoutVariant, a.heightClass, a.thicknessClass, a.generatedAt, a.version);

/// 뽑은 색을 판본의 추천 장정과 그 판본 책들의 기본 장정에 넣는다(사용자가 고친 장정은 그대로)
Library withCoverColors(Library lib, List<({String editionId, String color})> colors, String now) {
  final editions = {...lib.editions};
  final bindings = {...lib.bindings};
  for (final (:editionId, :color) in colors) {
    final e = editions[editionId];
    if (e == null) continue;
    final tones = tonesFor(color);
    final old = e.art;
    final art = old != null
        ? BookArtParams(color, tones.inkColor, tones.accentColor, old.motifId, old.layoutVariant, old.heightClass, old.thicknessClass, old.generatedAt, rebindVersion)
        : _params(buildBookArt(rebindInput(e, coverColor: color), now));
    editions[editionId] = e.withArt(art, now);
    for (final b in lib.books.values) {
      final bd = b.editionId == editionId && b.bindingId != null ? bindings[b.bindingId] : null;
      if (bd != null && bd.source == 'default' && bd.coverArtId == null) bindings[bd.id] = bd.withColors(color, tones.inkColor, tones.accentColor, now);
    }
  }
  return lib.copy(editions: editions, bindings: bindings);
}
