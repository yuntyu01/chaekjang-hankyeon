// SkSL(지금 앱의 빛 셰이더) → Flutter 런타임 이펙트 GLSL. build/sksl/*.sksl → shaders/*.frag
//
// 바뀌는 곳은 넷뿐이고 모두 기계적이다(식은 한 글자도 바꾸지 않는다):
//   1. 타입 이름: float2/3/4·half… → vec2/3/4, float3x3 → mat3
//   2. 진입점: `half4 main(float2 p) { … return c; }` → `void main() { vec2 p = FlutterFragCoord().xy; … fragColor = c; return; }`
//   3. 자식 그림: `uniform shader g;` → sampler2D + 크기·행렬·끝처리 uniform과 읽기 함수 `_g(uv)`,
//      `g.eval(uv)` → `_g(uv)`. SkSL에서는 자식 그림(ImageShader)에 붙인 행렬과 끝처리(clamp·decal)가 저절로 걸리지만
//      GLSL에는 그런 것이 없어 값으로 받아 함수 안에서 한다(gMat: 그리는 좌표 → 그림 칸, gDecal: 밖은 비워 둠)
//   4. 머리말: #version·runtime_effect.glsl·fragColor 선언
//
// 자식 그림의 칸 사이 읽기(선형)·끝 늘리기(clamp)는 Dart 쪽에서 ImageShader에 준다(지금 앱의 linearShader와 같다).
import 'dart:io';

/// 타입 이름 바꾸기(긴 이름부터: float4x4가 float4로 먼저 잡히지 않게)
const _types = <String, String>{
  'float4x4': 'mat4', 'float3x3': 'mat3', 'float2x2': 'mat2',
  'half4x4': 'mat4', 'half3x3': 'mat3', 'half2x2': 'mat2',
  'half4': 'vec4', 'half3': 'vec3', 'half2': 'vec2', 'half': 'float',
  'float4': 'vec4', 'float3': 'vec3', 'float2': 'vec2',
};

String _replaceWord(String src, String from, String to) =>
    src.replaceAllMapped(RegExp('\\b${RegExp.escape(from)}\\b'), (_) => to);

/// `열기(` 다음 자리 [open]에서 짝이 맞는 닫는 괄호의 자리
int _matchParen(String s, int open) {
  var depth = 1;
  var i = open;
  while (depth > 0) {
    final c = s[i];
    if (c == '(') depth++;
    if (c == ')') depth--;
    i++;
  }
  return i - 1;
}

/// `name.eval(식)` → `_name(식)`
String _rewriteEval(String src, String name) {
  final key = '$name.eval(';
  final out = StringBuffer();
  var i = 0;
  while (true) {
    final j = src.indexOf(key, i);
    if (j < 0) {
      out.write(src.substring(i));
      return out.toString();
    }
    out.write(src.substring(i, j));
    final open = j + key.length;
    final close = _matchParen(src, open);
    out.write('_$name(${src.substring(open, close)})');
    i = close + 1;
  }
}

/// `i == 0 ? A : (i == 1 ? B : (… : Z))` 처럼 같은 변수를 0, 1, 2, …와 차례로 견주는 긴 삼항 사슬을 이분 나무로 바꾼다
/// (`i < 8 ? (i < 4 ? …) : …`, 깊이 16 → 4). 값은 같다. 배열은 쓰지 않는다(지금 앱이 Adreno GLES 때문에 피한 모양).
/// impellerc가 Skia 대비용 SkSL을 만들 때 SPIRV-Cross가 사슬을 if 중첩으로 풀어 SkSL 구문 깊이 한도를 넘었다
String _balanceChains(String src) {
  final start = RegExp(r'(\w+) == 0 \? ');
  var out = src;
  var from = 0;
  while (true) {
    final m = start.firstMatch(out.substring(from));
    if (m == null) return out;
    final at = from + m.start;
    final v = m.group(1)!;
    // 사슬 읽기: 값 k마다 `v == k ? 식 : (`, 마지막은 `식` 뒤 닫는 괄호들
    final values = <String>[];
    var i = at;
    var k = 0;
    String? last;
    var opens = 0;
    while (true) {
      final head = '$v == $k ? ';
      if (!out.startsWith(head, i)) break;
      i += head.length;
      final e = _readExpr(out, i, ':');
      values.add(out.substring(i, e).trim());
      i = e + 1;
      while (i < out.length && out[i] == ' ') {
        i++;
      }
      if (out.startsWith('($v == ${k + 1} ? ', i)) {
        i++;
        opens++;
        k++;
        continue;
      }
      // 마지막 값: 괄호 하나로 감싼 식이거나 그냥 식
      final e2 = _readExpr(out, i, ')');
      last = out.substring(i, e2).trim();
      i = e2;
      break;
    }
    if (last == null || values.length < 4) {
      from = at + m.group(0)!.length;
      continue;
    }
    // 열었던 괄호만큼 닫는 괄호를 건너뛴다
    for (var o = 0; o < opens; o++) {
      while (out[i] == ' ') {
        i++;
      }
      if (out[i] != ')') throw StateError('삼항 사슬 끝 괄호를 찾지 못했다: ${out.substring(at, at + 80)}');
      i++;
    }
    final all = [...values, last];
    String tree(int lo, int hi) {
      if (hi - lo == 1) return all[lo];
      final mid = (lo + hi) ~/ 2;
      return '($v < $mid ? ${tree(lo, mid)} : ${tree(mid, hi)})';
    }

    final rep = tree(0, all.length);
    out = out.substring(0, at) + rep + out.substring(i);
    from = at + rep.length;
  }
}

/// i부터 괄호 균형이 맞는 채로 stop 문자를 만나는 자리(괄호 안의 stop은 건너뛴다)
int _readExpr(String s, int i, String stop) {
  var depth = 0;
  for (var j = i; j < s.length; j++) {
    final c = s[j];
    if (c == '(') depth++;
    if (c == ')') {
      if (depth == 0) return j;
      depth--;
    }
    if (depth == 0 && c == stop) return j;
    if (depth == 0 && (c == ';' || c == ',')) return j;
  }
  return s.length;
}

String convert(String sksl) {
  var s = _balanceChains(sksl);
  for (final e in _types.entries) {
    s = _replaceWord(s, e.key, e.value);
  }

  // 자식 그림
  final children = RegExp(r'uniform\s+shader\s+(\w+)\s*;')
      .allMatches(s)
      .map((m) => m.group(1)!)
      .toList();
  for (final c in children) {
    s = s.replaceAll(
      RegExp('uniform\\s+shader\\s+$c\\s*;'),
      'uniform sampler2D $c;\n'
          '  uniform vec2 ${c}Size;   // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)\n'
          '  uniform mat3 ${c}Mat;    // 그리는 좌표 → 그림 칸(SkSL에서는 자식 그림에 붙인 행렬)\n'
          '  uniform float ${c}Decal; // 1이면 그림 밖은 비워 둔다(SkSL TileMode.Decal)',
    );
    s = _rewriteEval(s, c);
  }

  // 진입점
  final mainRe = RegExp(r'vec4\s+main\s*\(\s*vec2\s+(\w+)\s*\)\s*\{');
  final m = mainRe.firstMatch(s);
  if (m == null) throw StateError('main(float2) 을 찾지 못했다');
  final coord = m.group(1)!;
  var head = s.substring(0, m.start);
  var body = s.substring(m.end);
  // main 안의 `return 식;` → `{ fragColor = 식; return; }`
  body = body.replaceAllMapped(RegExp(r'return\s+([^;]+);'), (x) => '{ fragColor = ${x.group(1)}; return; }');

  // 자식 그림 읽기 함수(행렬·끝처리). 선언 뒤·쓰는 곳 앞에 둔다
  if (children.isNotEmpty) {
    final fns = children.map((c) => '''
vec4 _$c(vec2 q) {
  vec3 t = $c\u004dat * vec3(q, 1.0);
  vec2 uv = (t.xy / t.z) / ${c}Size;
  if (${c}Decal > 0.5 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);
  return texture($c, uv);
}''').join('\n');
    // 마지막 uniform 선언 뒤에 넣는다
    final lastUniform = head.lastIndexOf(RegExp(r'uniform[^;]*;'));
    final end = head.indexOf(';', lastUniform) + 1;
    head = '${head.substring(0, end)}\n$fns\n${head.substring(end)}';
  }

  return '''#version 460 core
// 이 파일은 tool/gen_shaders.sh 가 만든다. 손으로 고치지 말 것(출처: ../app/src/ui/scene-light-sksl.ts)
#include <flutter/runtime_effect.glsl>

precision highp float;
layout(location = 0) out vec4 fragColor;

$head
void main() {
  vec2 $coord = FlutterFragCoord().xy;
$body''';
}

void main(List<String> args) {
  final inDir = Directory(args.isNotEmpty ? args[0] : 'build/sksl');
  final outDir = Directory(args.length > 1 ? args[1] : 'shaders');
  if (!outDir.existsSync()) outDir.createSync(recursive: true);
  final names = <String>[];
  for (final f in inDir.listSync().whereType<File>()) {
    if (!f.path.endsWith('.sksl')) continue;
    final name = f.uri.pathSegments.last.replaceAll('.sksl', '');
    final glsl = convert(f.readAsStringSync());
    File('${outDir.path}/$name.frag').writeAsStringSync(glsl);
    names.add('$name ${glsl.split('\n').length}줄');
  }
  names.sort();
  stdout.writeln('[glsl] ${names.join(', ')}');
}
