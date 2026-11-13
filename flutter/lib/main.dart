// 관문 측정 앱(2026-11-13): 지금 앱(React Native)과 같은 값·같은 양으로 줄 여섯을 구워 시간을 잰다.
// 켜면 바로 한 번 굽고 logcat에 남긴다([flbake] 줄마다, [fltotal] 합). 화면의 단추로 다시 잰다(두 번째부터는 GPU 준비가 끝나 있다).
// 재는 것: 셰이더 읽기 · 빛 격자(GRID_PASSES번) · 면 굽기. 지금 앱의 `[bake] … ms … grid …` 과 같은 뜻이다.
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'domain/camera.dart';
import 'domain/geometry.dart';
import 'domain/shelf_row.dart';
import 'ui/bake.dart';
import 'ui/scene.dart';

/// 앱이 깨어난 때(켜고 책장이 다 될 때까지를 재려고 되도록 이른 곳에서 잡는다).
/// Dart의 최상위 final은 처음 읽을 때 만들어지므로 main에서 바로 읽어 둔다
DateTime bootAt = DateTime.now();

Future<void> main() async {
  bootAt = DateTime.now();
  WidgetsFlutterBinding.ensureInitialized();
  await initBake();
  runApp(const GateApp());
}

class GateApp extends StatelessWidget {
  const GateApp({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
        title: '책장 한켠 (Flutter 관문)',
        home: GatePage(),
      );
}

class RowRun {
  RowRun(this.items, this.w, this.h, this.gridMs, this.bakeMs);
  final int items;
  final int w;
  final int h;
  final int gridMs;
  final int bakeMs;
  int get total => gridMs + bakeMs;
}

class Run {
  Run(this.rows, this.loadMs, this.sinceBoot);
  final List<RowRun> rows;
  final int loadMs;
  final int sinceBoot;
  int get bakeTotal => rows.fold(0, (t, r) => t + r.total);
  int get gridTotal => rows.fold(0, (t, r) => t + r.gridMs);
}

class GatePage extends StatefulWidget {
  const GatePage({super.key});

  @override
  State<GatePage> createState() => _GatePageState();
}

class _GatePageState extends State<GatePage> {
  final List<Run> _runs = [];
  final List<ui.Image> _atlases = [];
  final List<Spot> _wallSpots = [];
  final List<double> _spaces = [];
  String _state = '준비 중…';
  bool _busy = false;
  BakeCase? _case;
  ShaderSlots? _gridSlots;
  ShaderSlots? _bakeSlots;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _run());
  }

  Future<void> _run() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _state = '굽는 중…';
    });
    final t0 = DateTime.now();
    // 셰이더는 빌드할 때 미리 컴파일돼 있다(impellerc). 여기서는 읽어 올리기만 한다
    // 줄은 Dart에서 만든다(지금 앱의 빛 모델을 옮긴 domain/shelf_row). 지금 앱 로그의 줄들과 같은 양:
    // 면 3 + 책×4 → 3 · 23 · 19 · 19 · 31 · 19면, 맨 뒤는 값 확인용 작은 줄
    final c = _case ??= BakeCase([
      for (final (n, space) in const [(0, 190.0), (5, 190.0), (4, 205.0), (4, 205.0), (7, 215.0), (4, 205.0)])
        buildRow(sampleBooks(n, space), space),
      probeRow(),
    ]);
    await ShelfPainter.load();
    final gridSlots = _gridSlots ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/grid.frag'), gridUniformNames);
    final bakeSlots = _bakeSlots ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/bake.frag'), bakeUniformNames);
    final loadMs = DateTime.now().difference(t0).inMilliseconds;

    final rows = <RowRun>[];
    final images = <ui.Image>[];
    final spots = <Spot>[];
    final spaces = <double>[];
    for (var ri = 0; ri < c.rows.length; ri++) {
      final r = c.rows[ri];
      final probe = ri == c.rows.length - 1; // 맨 뒤는 값 확인용(시간에 넣지 않는다)
      final t1 = DateTime.now();
      final grid = await solveGrid(gridSlots, c, r);
      final gridMs = DateTime.now().difference(t1).inMilliseconds;
      final t2 = DateTime.now();
      final atlas = await bakeAtlas(bakeSlots, c, r, grid);
      final bakeMs = DateTime.now().difference(t2).inMilliseconds;
      grid.dispose();
      images.add(atlas.image);
      if (!probe) {
        spots.add(atlas.at[0]); // 면 0 = 뒷벽
        spaces.add(r.env.ceil);
      }
      final run = RowRun(r.items.length, atlas.w, atlas.h, gridMs, bakeMs);
      if (!probe) rows.add(run);
      // ignore: avoid_print
      print('[flbake] ${run.items} items ${run.w}x${run.h} ms ${run.total} grid $gridMs bake $bakeMs');
      // 구운 값이 맞는지 보는 자국(시간 잰 뒤에 따로 읽는다): 평균과 고른 칸 몇 개.
      // 같은 값을 지금 앱 셰이더(CanvasKit)로도 구워 견준다(tool/pixcheck.test.ts)
      // ignore: avoid_print
      print('[flpix] row $ri ${atlas.w}x${atlas.h} ${await _stamp(atlas.image)}');
    }
    final run = Run(rows, loadMs, DateTime.now().difference(bootAt).inMilliseconds);
    // ignore: avoid_print
    print('[fltotal] rows ${rows.length} bake ${run.bakeTotal}ms (grid ${run.gridTotal}) load ${run.loadMs}ms sinceBoot ${run.sinceBoot}ms');

    if (!mounted) {
      for (final i in images) {
        i.dispose();
      }
      return;
    }
    setState(() {
      for (final i in _atlases) {
        i.dispose();
      }
      _atlases
        ..clear()
        ..addAll(images);
      _wallSpots
        ..clear()
        ..addAll(spots);
      _spaces
        ..clear()
        ..addAll(spaces);
      _runs.add(run);
      _state = '${_runs.length}번째';
      _busy = false;
    });
  }

  /// 구운 그림의 자국: 평균 R,G,B와 고른 칸 여덟
  Future<String> _stamp(ui.Image img) async {
    final data = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (data == null) return 'null';
    final b = data.buffer.asUint8List();
    var sr = 0, sg = 0, sb = 0;
    for (var i = 0; i < b.length; i += 4) {
      sr += b[i];
      sg += b[i + 1];
      sb += b[i + 2];
    }
    final n = b.length ~/ 4;
    final picks = <String>[];
    for (var k = 1; k <= 8; k++) {
      final i = ((n * k) ~/ 9) * 4;
      picks.add('${b[i]},${b[i + 1]},${b[i + 2]}');
    }
    return 'mean ${(sr / n).toStringAsFixed(2)},${(sg / n).toStringAsFixed(2)},${(sb / n).toStringAsFixed(2)} at ${picks.join(' ')}';
  }

  @override
  void dispose() {
    for (final i in _atlases) {
      i.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Flutter 굽기 관문')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            Text(_state, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final r in _runs)
              Text('줄 ${r.rows.length}개 합 ${r.bakeTotal}ms  (격자 ${r.gridTotal})  셰이더 읽기 ${r.loadMs}ms  켠 뒤 ${r.sinceBoot}ms'),
            const SizedBox(height: 12),
            FilledButton(onPressed: _busy ? null : _run, child: const Text('다시 굽기')),
            const SizedBox(height: 16),
            if (_atlases.length > 1 && _wallSpots.length == _spaces.length)
              SizedBox(
                height: 420,
                child: CustomPaint(
                  painter: ShelfPainter(
                    rows: _case!.rows,
                    atlases: _atlases,
                    wallSpots: _wallSpots,
                    spaces: _spaces,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 구운 줄들을 실제 책장처럼 쌓아 그린다(지금은 뒷벽만, ui/scene). 줄마다 카메라가 따로다
class ShelfPainter extends CustomPainter {
  ShelfPainter({required this.rows, required this.atlases, required this.wallSpots, required this.spaces});
  final List<RowCase> rows;
  final List<ui.Image> atlases;
  final List<Spot> wallSpots;
  final List<double> spaces;

  static ShaderSlots? _lit;

  /// 벽 셰이더는 한 번만 올린다(미리 컴파일돼 있다)
  static Future<void> load() async {
    _lit ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/lit.frag'), litUniformNames);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final lit = _lit;
    if (lit == null) return;
    final m = metricsOf(size.width);
    final cam = Cam(viewPitchMin);
    var y = 0.0;
    for (var i = 0; i < wallSpots.length && i < atlases.length; i++) {
      final space = spaces[i];
      final px = Affine(m.scale, m.originX, y + (space + shelfThick) * m.scale);
      final h = rowHeightPx(cam, px, space);
      canvas.save();
      canvas.clipRect(Rect.fromLTWH(0, y, size.width, h));
      drawRow(canvas, lit, cam, px, rows[i], wallSpots[i], atlases[i], emptyImage, space);
      canvas.restore();
      y += h;
      if (y > size.height) break;
    }
  }

  @override
  bool shouldRepaint(ShelfPainter old) => old.atlases != atlases;
}

