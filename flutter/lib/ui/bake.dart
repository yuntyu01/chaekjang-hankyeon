// 하늘 가림 굽기(줄 아틀라스). 지금 앱 ui/SceneLight.tsx의 bakeAtlas·solveGridImage와 같은 차례로 돈다.
// 셰이더는 빌드할 때 미리 컴파일된 shaders/grid.frag · shaders/bake.frag(출처: 지금 앱의 scene-light-sksl, tool/gen_shaders.sh).
//
// 관문(S23 측정)용이라 굽는 입력은 assets/bake_case.json에서 읽는다(지금 앱의 빛 모델이 뽑아 둔 줄 하나).
// 두 앱이 같은 값을 구워야 시간·화소를 견줄 수 있다. 관문을 지나면 입력도 Dart 쪽에서 만든다.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/services.dart' show rootBundle;

/// 굽는 면 하나: 면 위 칸 격자(O에서 U·V만큼씩 w × h칸)와 바깥 법선 n, 이 면의 책(self, 없으면 −1)
class BakeItem {
  BakeItem.fromJson(Map<String, dynamic> j)
      : o = _v(j['O']),
        u = _v(j['U']),
        v = _v(j['V']),
        n = _v(j['n']),
        w = j['w'] as int,
        h = j['h'] as int,
        self = (j['self'] as num).toDouble();

  final List<double> o;
  final List<double> u;
  final List<double> v;
  final List<double> n;
  final int w;
  final int h;
  final double self;
}

List<double> _v(Object? x) => (x as List).map((e) => (e as num).toDouble()).toList();

/// 줄 하나의 굽기 입력(둘레·상자 목록·구울 면들)
class BakeRow {
  BakeRow.fromJson(Map<String, dynamic> j)
      : env = _v(j['env']),
        nBox = j['nBox'] as int,
        box = _v(j['box']),
        items = (j['items'] as List).map((x) => BakeItem.fromJson(x as Map<String, dynamic>)).toList();

  final List<double> env;
  final int nBox;
  final List<double> box;
  final List<BakeItem> items;

  int get cells => items.fold(0, (t, it) => t + it.w * it.h);
}

class BakeCase {
  BakeCase.fromJson(Map<String, dynamic> j)
      : gridPasses = j['gridPasses'] as int,
        gridN = j['gridN'] as int,
        envNy = j['envNy'] as int,
        envNx = j['envNx'] as int,
        cal = (j['cal'] as Map<String, dynamic>).map((k, x) => MapEntry(k, _v(x))),
        rows = (j['rows'] as List).map((x) => BakeRow.fromJson(x as Map<String, dynamic>)).toList();

  final int gridPasses;
  final int gridN;
  final int envNx;
  final int envNy;
  final Map<String, List<double>> cal;
  final List<BakeRow> rows;

  /// 빛 격자 그림 크기(scene-light-sksl GRID_SCALE 배치)
  int gridW() => 6 * gridN;
  int gridH(BakeRow r) => r.nBox * gridN + 3 * envNy;

  static Future<BakeCase> load() async {
    final text = await rootBundle.loadString('assets/bake_case.json');
    return BakeCase.fromJson(jsonDecode(text) as Map<String, dynamic>);
  }
}

/// 면마다 아틀라스에서의 자리(칸). 둘레에 한 칸씩 더 굽는다(겹선형 읽기가 옆 면으로 새지 않게)
class Spot {
  const Spot(this.x, this.y, this.w, this.h);
  final int x;
  final int y;
  final int w;
  final int h;
}

const _gutter = 1;
const _atlasW = 512;

/// 선반 쌓기: 높이 순으로 왼쪽부터, 줄이 차면 아래로(지금 앱 bakeAtlas와 같다)
({List<Spot> at, int w, int h}) packAtlas(List<BakeItem> items) {
  final order = List<int>.generate(items.length, (i) => i)..sort((a, b) => items[b].h - items[a].h);
  var w = _atlasW;
  for (final it in items) {
    final need = it.w + 2 * _gutter;
    if (need > w) w = need;
  }
  final at = List<Spot>.filled(items.length, const Spot(0, 0, 0, 0));
  var x = 0, y = 0, shelf = 0;
  for (final i in order) {
    final it = items[i];
    final fw = it.w + 2 * _gutter;
    if (x + fw > w) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    at[i] = Spot(x + _gutter, y + _gutter, it.w, it.h);
    x += fw;
    if (it.h + 2 * _gutter > shelf) shelf = it.h + 2 * _gutter;
  }
  return (at: at, w: w, h: y + shelf);
}

/// 셰이더 uniform의 자리 번호를 프로그램마다 한 번만 구해 둔다.
/// Flutter의 이름으로 넣는 API(getUniformVec3·getUniformVec4Array)는 부를 때마다 슬롯 객체를 만드는데,
/// 배열은 원소마다 배열 전체 길이만큼 만든다(box[160] 한 번에 160×640개). 면마다 부르면 그것만으로 몇 초가 간다.
/// 자리 번호는 프로그램마다 고정이므로 한 번 구해 두고 setFloat으로 바로 넣는다(그냥 Float32List 쓰기라 값싸다)
class ShaderSlots {
  ShaderSlots(this.prog, List<String> names) {
    final sh = prog.fragmentShader();
    for (final n in names) {
      _at[n] = sh.getUniformFloat(n, 0).shaderIndex;
    }
    sh.dispose();
  }

  final ui.FragmentProgram prog;
  final Map<String, int> _at = {};

  ui.FragmentShader shader() => prog.fragmentShader();

  int at(String name) => _at[name]!;
}

const _calNames = ['ECAM', 'RADF', 'RADU', 'RADW', 'RADE', 'RADSL', 'RADSR', 'PAPER', 'ALB_WALL', 'ALB_PLANK'];
const _commonNames = ['env', ..._calNames, 'box', 'nBox', 'gridOn', 'gridNx', 'gridSize'];
const _itemNames = ['O', 'Ux', 'Vy', 'tN', 'cells', 'selfIdx'];

/// 굽기 셰이더가 쓰는 이름 전부(면 값 + 함께 읽는 값)
const bakeUniformNames = [..._itemNames, ..._commonNames];
const gridUniformNames = _commonNames;

void _setVec(ui.FragmentShader sh, int at, List<double> v) {
  for (var i = 0; i < v.length; i++) {
    sh.setFloat(at + i, v[i]);
  }
}

/// 두 셰이더가 함께 읽는 값(둘레·맞추기 값·상자 목록·빛 격자 그림)
void _setCommon(ui.FragmentShader sh, ShaderSlots u, BakeCase c, BakeRow r, {required ui.Image? grid}) {
  _setVec(sh, u.at('env'), r.env);
  for (final name in _calNames) {
    _setVec(sh, u.at(name), c.cal[name]!);
  }
  final box = u.at('box');
  for (var i = 0; i < r.box.length; i++) {
    sh.setFloat(box + i, r.box[i]);
  }
  sh.setFloat(u.at('nBox'), r.nBox.toDouble());
  sh.setFloat(u.at('gridOn'), grid != null ? 1 : 0);
  sh.setFloat(u.at('gridNx'), r.nBox > 0 || r.env[0] > 1.5 ? c.envNx.toDouble() : 1);
  _setVec(sh, u.at('gridSize'), [c.gridW().toDouble(), c.gridH(r).toDouble()]);
  // 칸 사이는 선형으로, 끝은 늘려 읽는다(지금 앱 linearShader와 같다)
  sh.setImageSampler(0, grid ?? _empty, filterQuality: ui.FilterQuality.low);
}

late ui.Image _empty;

/// 1×1 회색 그림(빛 격자가 아직 없을 때 자리만 채운다. 그때 셰이더는 읽지 않는다)
Future<void> initBake() async {
  final done = Completer<ui.Image>();
  ui.decodeImageFromPixels(Uint8List.fromList([128, 128, 128, 255]), 1, 1, ui.PixelFormat.rgba8888, done.complete);
  _empty = await done.future;
}

/// 그림이 실제로 그려질 때까지 기다린다. 그림을 읽는 1×1 그림을 하나 더 만들어 GPU가 이 그림을 끝내게 한다
/// (지금 앱이 굽고 나서 1화소를 읽어 기다리는 것과 같은 뜻. 그냥 두면 GPU 일이 나중으로 밀려 시간이 작게 나온다)
Future<void> settle(ui.Image img) async {
  final rec = ui.PictureRecorder();
  ui.Canvas(rec).drawImageRect(
    img,
    ui.Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
    const ui.Rect.fromLTWH(0, 0, 1, 1),
    ui.Paint(),
  );
  final pic = rec.endRecording();
  (await pic.toImage(1, 1)).dispose();
  pic.dispose();
}

/// 한 번 그려 그림으로 만든다(GPU가 끝나면 Future가 끝난다: 시간 재기에 쓴다)
Future<ui.Image> _draw(int w, int h, ui.FragmentShader sh) async {
  final rec = ui.PictureRecorder();
  ui.Canvas(rec).drawRect(
    ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()),
    ui.Paint()..shader = sh,
  );
  final pic = rec.endRecording();
  final img = await pic.toImage(w, h);
  pic.dispose();
  return img;
}

/// 빛 격자(되비침)를 gridPasses번 풀어 그림 한 장으로. 첫 번은 가리개를 가림 없는 받는 빛으로 본다
Future<ui.Image> solveGrid(ShaderSlots u, BakeCase c, BakeRow r) async {
  ui.Image? img;
  for (var k = 0; k < c.gridPasses; k++) {
    final sh = u.shader();
    _setCommon(sh, u, c, r, grid: img);
    final next = await _draw(c.gridW(), c.gridH(r), sh);
    sh.dispose();
    img?.dispose();
    img = next;
  }
  return img!;
}

/// 줄 아틀라스 한 장: 면마다 제 자리에 굽는다
Future<({ui.Image image, List<Spot> at, int w, int h})> bakeAtlas(
  ShaderSlots u,
  BakeCase c,
  BakeRow r,
  ui.Image grid,
) async {
  final pack = packAtlas(r.items);
  final rec = ui.PictureRecorder();
  final canvas = ui.Canvas(rec);
  for (var i = 0; i < r.items.length; i++) {
    final it = r.items[i];
    final sp = pack.at[i];
    final sh = u.shader();
    _setVec(sh, u.at('O'), it.o);
    _setVec(sh, u.at('Ux'), it.u);
    _setVec(sh, u.at('Vy'), it.v);
    _setVec(sh, u.at('tN'), it.n);
    _setVec(sh, u.at('cells'), [it.w.toDouble(), it.h.toDouble()]);
    sh.setFloat(u.at('selfIdx'), it.self);
    _setCommon(sh, u, c, r, grid: grid);
    canvas.save();
    canvas.translate(sp.x.toDouble(), sp.y.toDouble());
    canvas.drawRect(
      ui.Rect.fromLTWH(-_gutter.toDouble(), -_gutter.toDouble(), (it.w + 2 * _gutter).toDouble(), (it.h + 2 * _gutter).toDouble()),
      ui.Paint()..shader = sh,
    );
    canvas.restore();
  }
  final pic = rec.endRecording();
  final img = await pic.toImage(pack.w, pack.h);
  pic.dispose();
  await settle(img);
  return (image: img, at: pack.at, w: pack.w, h: pack.h);
}
