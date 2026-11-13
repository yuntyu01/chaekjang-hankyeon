// 장정 재질 색: 받은 장정 띠(reference-bindings)에서 넓은 재질 색만 뽑는다(띠 양 끝의 밝고 어두운 가장자리는 버린다:
// 빛은 그릴 때 빛 모델이 계산한다). 지금 앱 domain/binding-material.ts를 옮긴 것.
library;

import 'dart:math' as math;

import '../gen/reference_bindings.g.dart';

/// 장정 띠: 색들·자리들(0~1)·가로 여부
class Binding {
  const Binding(this.colors, this.positions, this.horizontal);
  final List<String> colors;
  final List<double> positions;
  final bool horizontal;
}

List<int> _rgb(String hex) => [for (final i in [1, 3, 5]) int.parse(hex.substring(i, i + 2), radix: 16)];
String _hex(List<double> c) => '#${c.map((v) => math.max(0, math.min(255, (v + 0.5).floor())).toRadixString(16).padLeft(2, '0')).join()}';

/// 띠에서 가장자리 빛을 빼고 가운데 재질 색만(17칸, 가우스 가중 평균)
Binding _materialOnly(Binding b) {
  final samples = b.colors.map(_rgb).toList();
  final positions = [for (var i = 0; i <= 16; i++) i / 16];
  final colors = [
    for (final p in positions)
      () {
        final at = math.max(0.12, math.min(0.88, p));
        final out = [0.0, 0.0, 0.0];
        var total = 0.0;
        for (var i = 0; i < b.positions.length; i++) {
          final q = b.positions[i];
          if (q < 0.1 || q > 0.9) continue;
          final w = math.exp(-0.5 * math.pow((q - at) / 0.055, 2));
          total += w;
          for (var j = 0; j < 3; j++) {
            out[j] += samples[i][j] * w;
          }
        }
        return _hex(out.map((c) => c / total).toList());
      }(),
  ];
  return Binding(colors, positions, b.horizontal);
}

final _cache = <String, Binding>{};

/// 책 색 → 재질 띠(받은 띠가 있으면 그것, 없으면 가운데 색이 가장 가까운 띠를 이 색으로 옮겨서)
Binding? referenceBinding(String color) {
  final key = color.toUpperCase();
  final hit = _cache[key];
  if (hit != null) return hit;
  final original = referenceBindingProfiles[key];
  if (original != null) {
    return _cache[key] = _materialOnly(Binding(original.colors, original.positions, original.horizontal));
  }
  if (!RegExp(r'^#[0-9A-F]{6}$').hasMatch(key)) return null;
  final target = _rgb(key);
  ({List<String> colors, List<double> positions, bool horizontal})? closest;
  var best = double.infinity;
  var base = <int>[];
  for (final c in referenceBindingProfiles.values) {
    final center = _rgb(c.colors[c.colors.length ~/ 2]);
    var d = 0.0;
    for (var i = 0; i < 3; i++) {
      d += math.pow(center[i] - target[i], 2);
    }
    if (d < best) {
      best = d;
      closest = c;
      base = center;
    }
  }
  final shifted = [
    for (final h in closest!.colors) _hex([for (var i = 0; i < 3; i++) (target[i] + _rgb(h)[i] - base[i]).toDouble()]),
  ];
  return _cache[key] = _materialOnly(Binding(shifted, closest.positions, closest.horizontal));
}

/// 책 몸체(판·책등·판 끝)의 재질 색: 재질 띠의 가운데 색
String bindingSurfaceTone(String color) {
  final m = referenceBinding(color);
  return m == null ? color : m.colors[m.colors.length ~/ 2];
}

/// 표지 사진의 채도(지금 앱 scene-config/lighting PHOTO_SATURATION)
const photoSaturation = 0.85;
const _luma = [0.2126, 0.7152, 0.0722];

/// 채도 행렬(휘도는 그대로 두고 회색 쪽으로): 입력 r·g·b의 행 3개
List<List<double>> saturationMatrix(double s) => [
      for (var row = 0; row < 3; row++) [for (var col = 0; col < 3; col++) _luma[col] * (1 - s) + (row == col ? s : 0)],
    ];

List<double> saturated(List<double> c, double s) =>
    saturationMatrix(s).map((m) => m[0] * c[0] + m[1] * c[1] + m[2] * c[2]).toList();

/// 책 몸체 색: 재질 색(사진 책은 사진과 같은 채도로)
String bookToneOf(String face, {bool photo = false}) {
  final tone = bindingSurfaceTone(face);
  if (!photo) return tone;
  return _hex(saturated(_rgb(tone).map((v) => v.toDouble()).toList(), photoSaturation));
}
