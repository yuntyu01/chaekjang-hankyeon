// 갈피(종이 탭) 그리기: 머리에서 위로 나온 종이를 탭 그림 좌표(뿌리 = 원점, 위가 −)로 그리고, 같은 모양 안을 탭 빛 셰이더(tab.frag)로 칠한다.
// 탭 가운데 한 점의 하늘 가림은 줄 굽기에 한 칸으로 구운 값을 읽어 쓴다. 지금 앱 art.tsx Ribbons·tabPath, BookNode Ribbons, SceneLight TabLight를 옮긴 것
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import '../domain/book3.dart';
import '../domain/book_look.dart';
import '../domain/camera.dart';
import '../domain/geometry.dart';
import '../domain/ribbon_design.dart';
import '../domain/shelf_row.dart';
import '../domain/vec3.dart';
import '../gen/book_light.g.dart' as bl;
import '../gen/light_uniforms.g.dart' as cal;
import '../gen/scene_uniforms.g.dart';
import 'bake.dart';
import 'outline.dart';
import 'scene.dart';

/// 탭 위 모서리 반지름(지금 앱 TAB_R)
final _tabR = mm(1.5);

const tabUniformNames = [
  'pxa', 'root', 'axR', 'axU', 'nrm', 'loss', 'cam4', 'keyOn', 'albedo', 'eref', 'sref', 'mR', 'mB', 'mG', 'mS', 'mSeed',
  'env', 'ECAM', 'RADF', 'RADU', 'RADW', 'RADE', 'RADSL', 'RADSR', 'PAPER', 'DODGE', 'SPLIT',
];

/// 탭 한 장의 모양(탭 그림 좌표, px). 둥근 위 모서리, 뿌리를 축으로 tilt만큼 기운다
ui.Path _tabPath(Tab t, double s) {
  final w = t.width * s, hidden = tabHidden * s, top = -t.out * s;
  final r = math.min(_tabR * s, w / 2);
  final p = ui.Path()
    ..moveTo(-w / 2, hidden)
    ..lineTo(-w / 2, top + r)
    ..quadraticBezierTo(-w / 2, top, -w / 2 + r, top)
    ..lineTo(w / 2 - r, top)
    ..quadraticBezierTo(w / 2, top, w / 2, top + r)
    ..lineTo(w / 2, hidden)
    ..close();
  final a = t.tilt * math.pi / 180;
  // translate(x, hidden) · rotate(a) · translate(0, −hidden)
  final m = Float64List(16)
    ..[0] = math.cos(a)
    ..[1] = math.sin(a)
    ..[4] = -math.sin(a)
    ..[5] = math.cos(a)
    ..[10] = 1
    ..[15] = 1;
  m[12] = t.x * s + hidden * math.sin(a);
  m[13] = hidden - hidden * math.cos(a);
  return p.transform(m);
}

/// 구운 줄 그림에서 갈피 탭 한 점의 하늘 가림을 읽는다(굽기 셰이더가 담은 값을 lit.frag와 같은 식으로 푼다)
Future<Map<String, C3>> readTabLosses(RowCase row, ui.Image atlas, List<Spot> spots) async {
  final items = [for (final it in row.items) if (it.key.endsWith(':tab')) it];
  if (items.isEmpty) return const {};
  final data = await atlas.toByteData(format: ui.ImageByteFormat.rawStraightRgba);
  if (data == null) return const {};
  final out = <String, C3>{};
  for (final it in items) {
    final i = row.indexOf(it.key);
    if (i < 0 || i >= spots.length) continue;
    final sp = spots[i];
    final at = (sp.y * atlas.width + sp.x) * 4;
    final n = it.n;
    final sky = bl.ambient + bl.skyTilt.$1 * n.x + bl.skyTilt.$2 * n.y + bl.skyTilt.$3 * n.z;
    double decode(int byte, double skyC) {
      final g = byte / 255;
      final a = (g - bl.lossG0) / (1 - bl.lossG0), b = (bl.lossG0 - g) / bl.lossG0;
      return skyC * sky - (g >= bl.lossG0 ? bl.lossRP * a * a : -bl.lossRN * b * b);
    }

    out[it.key.substring(0, it.key.length - 4)] =
        C3(decode(data.getUint8(at), bl.skyC.r), decode(data.getUint8(at + 1), bl.skyC.g), decode(data.getUint8(at + 2), bl.skyC.b));
  }
  return out;
}

/// 책 한 권의 갈피 탭(있으면): 종이 색 → 빛 두 겹(곱하기·닷지). 머리가 보는 쪽을 등지면 보이는 바깥 면에 가려지는 부분은 그리지 않는다
void drawRibbons(ui.Canvas canvas, ShaderSlots slots, Cam c, Affine px, RowCase row, Book3 b, BookLook look, C3? loss) {
  if (look.ribbons <= 0 || loss == null) return;
  final tabs = tabsOf(b.id, look.ribbons, look.ribbon, look.tone);
  final out = tabs.map((t) => t.out).reduce(math.max);
  final s = px.s;
  final axes = tabAxes(b);
  final root = tabRoot(b, out).root;
  ui.Offset proj(Vec3 v) => c.project(v);
  final p = proj(root);
  final pu = proj(root + axes.up);
  final p1 = proj(Vec3(root.x + 1, root.y, root.z));
  var k = (p1 - p).distance;
  if (k == 0) k = 1;
  final ux = (pu.dx - p.dx) / k, uy = (pu.dy - p.dy) / k;
  if (math.sqrt(ux * ux + uy * uy) < 1e-3) return;
  final pa = proj(root + axes.ax);
  final q0 = px.at(p);
  // 탭 그림은 머리 방향(화면에서 위 방향)으로 세우고, 가로는 돌아간 축을 그대로 투영한다
  final m = Float64List(16)
    ..[0] = (pa.dx - p.dx) / k
    ..[1] = (pa.dy - p.dy) / k
    ..[4] = -ux
    ..[5] = -uy
    ..[10] = 1
    ..[12] = q0.dx
    ..[13] = q0.dy
    ..[15] = 1;

  canvas.save();
  // 머리가 등을 보이면(크게 젖힌 표지 책) 보이는 바깥 면 자리는 비운다
  final eye = Eye(c.eye.x, c.eye.y, viewDist);
  if (facing(eye, b, FaceId.head) <= 0.002) {
    final hide = ui.Path();
    final cs = corners(b);
    for (final f in const [FaceId.spine, FaceId.cover, FaceId.back, FaceId.tail, FaceId.fore]) {
      if (facing(eye, b, f) <= 0.002) continue;
      hide.addPolygon([for (final i in faceCorners(f)) px.at(proj(cs[i]))], true);
    }
    canvas.clipPath(ui.Path.combine(ui.PathOperation.difference, ui.Path()..addRect(const ui.Rect.fromLTRB(-1e5, -1e5, 1e5, 1e5)), hide));
  }
  canvas.transform(m);
  final shape = ui.Path();
  for (final t in tabs) {
    final path = _tabPath(t, s);
    canvas.drawPath(path, ui.Paint()..color = _hex(t.color));
    shape.addPath(path, ui.Offset.zero);
  }
  // 빛: 탭 모양 안을 화소마다(무광 종이, 재질 색은 앞장 탭 종이 색)
  final albedo = linearOf(int.parse(tabs.first.color.substring(1), radix: 16));
  final seed = seedOf('${b.id}:tab');
  for (final (dodge, blend) in const [(0.0, ui.BlendMode.multiply), (1.0, ui.BlendMode.colorDodge)]) {
    final sh = slots.shader();
    void vec(String name, List<double> v) {
      final at = slots.at(name);
      for (var i = 0; i < v.length; i++) {
        sh.setFloat(at + i, v[i]);
      }
    }

    void one(String name, double v) => sh.setFloat(slots.at(name), v);
    vec('pxa', [s, 0, 0]);
    vec('root', root.list);
    vec('axR', axes.ax.list);
    vec('axU', axes.up.list);
    vec('nrm', axes.n.list);
    vec('loss', loss.list);
    vec('cam4', [c.eye.x, c.eye.y, c.eye.z, viewDist]);
    one('keyOn', 1);
    vec('albedo', albedo.list);
    vec('eref', tabPaper.eref.list);
    vec('sref', tabPaper.sref.list);
    vec('mR', tabPaper.mat.rough);
    vec('mB', tabPaper.mat.bump);
    vec('mG', tabPaper.mat.grain);
    vec('mS', tabPaper.mat.gsize);
    vec('mSeed', seed);
    vec('env', row.env.u);
    vec('ECAM', cal.ECAM.list);
    vec('RADF', cal.RADF.list);
    vec('RADU', cal.RADU.list);
    vec('RADW', cal.RADW.list);
    vec('RADE', cal.RADE.list);
    vec('RADSL', cal.RADSL.list);
    vec('RADSR', cal.RADSR.list);
    vec('PAPER', cal.PAPER.list);
    one('DODGE', dodge);
    one('SPLIT', 0);
    canvas.drawPath(shape, ui.Paint()
      ..shader = sh
      ..blendMode = blend);
  }
  canvas.restore();
}

ui.Color _hex(String hex) => ui.Color(0xFF000000 | int.parse(hex.substring(1), radix: 16));
