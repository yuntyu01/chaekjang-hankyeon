// 색 계산: 책 색에서 제목 색·갈피 색을 고른다. 지금 앱 domain/color.ts와 book-design jacketColor를 옮긴 것
// (값이 같은지는 test/color_title_test.dart가 지금 앱 결과와 견준다).
library;

import 'dart:math' as math;

List<int> _parse(String hex) {
  var h = hex.replaceAll('#', '');
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  final n = int.parse(h, radix: 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/// JS Math.round(.5는 위로)
int _round(double v) => (v + 0.5).floor();

String _toHex(List<double> rgb) =>
    '#${rgb.map((v) => _round(math.max(0, math.min(255, v))).toRadixString(16).padLeft(2, '0')).join()}';

/// 0xRRGGBB → '#rrggbb'
String hexOf(int rgb) => '#${(rgb & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

/// '#rrggbb' → 0xRRGGBB
int rgbOf(String hex) {
  final c = _parse(hex);
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/// amount > 0이면 밝게, < 0이면 어둡게
String shade(String hex, double amount) =>
    _toHex(_parse(hex).map((v) => amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)).toList());

double luminance(String hex) {
  final c = _parse(hex).map((v) {
    final x = v / 255;
    return x <= 0.03928 ? x / 12.92 : math.pow((x + 0.055) / 1.055, 2.4).toDouble();
  }).toList();
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

double contrast(String a, String b) {
  final la = luminance(a), lb = luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

/// 제목 먹색(회색빛 검정)과 밝은 글자(흰색)
const titleDark = '#3A3B3D';
const titleLight = '#FFFFFF';

/// 예전 자동 글자색(남색 먹·크림, 그림 표지의 갈색 먹): 저장돼 있어도 지금 규칙으로 다시 고른다
const legacyTitleInks = ['#2F3944', '#F7EEDC', '#4A3F3A'];

/// 그림 위 제목처럼 밝음·어두움을 그림에 맞춰 정해 둔 색은 같은 쪽의 새 색으로만 바꾼다
String modernInk(String c) {
  final u = c.toUpperCase();
  return u == '#F7EEDC' ? titleLight : legacyTitleInks.contains(u) ? titleDark : c;
}

/// 밝은 글자 대비가 이만큼 이상이면 흰색(사용자 '될 수 있으면 흰색')
const titleMinContrast = 2.7;

/// 제목 색: 밝은 글자 대비가 2.7 이상이면 흰색, 먹색은 2배 넘게 앞설 때만
String titleInk(String bg) {
  final dark = contrast(titleDark, bg);
  final light = contrast(titleLight, bg);
  if (light < titleMinContrast) return dark > light ? titleDark : titleLight;
  return dark >= light * 2 ? titleDark : titleLight;
}

/// 책에 그릴 제목 색: 자동으로 고른 색이 저장돼 있으면 지금 규칙으로 다시 고른다
String displayInk(String? stored, String face) {
  final s = stored?.toUpperCase();
  final auto = s == null || legacyTitleInks.contains(s) || s == titleDark || s == titleLight;
  return auto ? titleInk(face) : stored!;
}

String rgbHex(double r, double g, double b) => _toHex([r, g, b]);

// ---------- HSL ----------
List<double> _toHsl(List<int> c) {
  final r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  final mx = math.max(r, math.max(g, b)), mn = math.min(r, math.min(g, b));
  final l = (mx + mn) / 2;
  if (mx == mn) return [0, 0, l];
  final d = mx - mn;
  final s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  final h = mx == r ? (g - b) / d + (g < b ? 6 : 0) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

List<double> _fromHsl(double h, double s, double l) {
  if (s == 0) return [l * 255, l * 255, l * 255];
  final q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  final p = 2 * l - q;
  double f(double t) {
    final u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  }

  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

double _clamp(double v, double lo, double hi) => math.max(lo, math.min(hi, v));
String _hsl(double h, double s, double l) => _toHex(_fromHsl(h, math.min(1, s), _clamp(l, 0, 0.93)));

const _accentFallback = ['#C9A27E', '#8FA695', '#9A97BD'];

bool isNeutralColor(String hex) {
  final hsl = _toHsl(_parse(hex));
  return hsl[2] > 0.86 || hsl[2] < 0.14 || hsl[1] < 0.14;
}

List<double> _accentHsl(String? accent, String key) {
  var k = 0;
  for (final c in key.codeUnits) {
    k = (k * 31 + c) & 0xFFFFFFFF;
  }
  final ok = accent != null && RegExp(r'^#[\da-f]{6}$', caseSensitive: false).hasMatch(accent);
  return _toHsl(_parse(ok ? accent : _accentFallback[k % _accentFallback.length]));
}

/// 책장 갈피 탭: 첫째 = 길쭉한 장, 둘째 = 짧은 장(더 밝게)
(String, String) tabColors(String? accent, String key) {
  final hsl = _accentHsl(accent, key);
  final sat = _clamp(hsl[1], 0.28, 0.62);
  final base = _clamp(hsl[2], 0.42, 0.72);
  return (_hsl(hsl[0], sat, base), _hsl(hsl[0], sat, base + 0.12));
}

// ---------- 장정 색(book-design) ----------
/// 예전 예시 색을 지금 색으로(사용자가 고른 색은 그대로)
const _legacyColors = {
  '#3D5F57': '#627260', '#BE5D47': '#CF886E', '#1D426B': '#4B6080',
  '#5E6D5B': '#627260', '#CE886F': '#CF886E', '#FBD392': '#FDD594',
  '#88A4BA': '#8CA5BA', '#FDF0E0': '#FEF1DF',
  '#1E4260': '#4B6080', '#B4C8D6': '#8DA5B9', '#B5C7D7': '#819AB1',
  '#4E6B60': '#A7AF95', '#893E41': '#8D4F4E', '#E39E8A': '#F3B497',
  '#F8C69F': '#F0BDA0', '#DDAFAF': '#F4BF9C',
};

String jacketColor(String color) => _legacyColors[color.toUpperCase()] ?? color;
