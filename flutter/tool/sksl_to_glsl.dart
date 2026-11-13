// SkSL(지금 앱의 빛 셰이더) → Flutter 런타임 이펙트 GLSL. build/sksl/*.sksl → shaders/*.frag
//
// 바뀌는 곳은 넷뿐이고 모두 기계적이다(식은 한 글자도 바꾸지 않는다):
//   1. 타입 이름: float2/3/4·half… → vec2/3/4, float3x3 → mat3
//   2. 진입점: `half4 main(float2 p) { … return c; }` → `void main() { vec2 p = FlutterFragCoord().xy; … fragColor = c; return; }`
//   3. 자식 그림: `uniform shader g;` → `uniform sampler2D g;` + `uniform vec2 gSize;`,
//      `g.eval(uv)` → `texture(g, (uv) / gSize)` (SkSL은 화소 좌표, GLSL은 0~1 좌표라 크기로 나눈다)
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

/// `name.eval(식)` → `texture(name, (식) / nameSize)`
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
    out.write('texture($name, (${src.substring(open, close)}) / ${name}Size)');
    i = close + 1;
  }
}

String convert(String sksl) {
  var s = sksl;
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
      'uniform sampler2D $c;\n  uniform vec2 ${c}Size;  // 그림 칸 수(SkSL 화소 좌표를 0~1로 바꾼다)',
    );
    s = _rewriteEval(s, c);
  }

  // 진입점
  final mainRe = RegExp(r'vec4\s+main\s*\(\s*vec2\s+(\w+)\s*\)\s*\{');
  final m = mainRe.firstMatch(s);
  if (m == null) throw StateError('main(float2) 을 찾지 못했다');
  final coord = m.group(1)!;
  final head = s.substring(0, m.start);
  var body = s.substring(m.end);
  // main 안의 `return 식;` → `{ fragColor = 식; return; }`
  body = body.replaceAllMapped(RegExp(r'return\s+([^;]+);'), (x) => '{ fragColor = ${x.group(1)}; return; }');

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
