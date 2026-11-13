// 관문 측정 앱(2026-11-13): 지금 앱(React Native)과 같은 값·같은 양으로 줄 여섯을 구워 시간을 잰다.
// 켜면 바로 한 번 굽고 logcat에 남긴다([flbake] 줄마다, [fltotal] 합). 화면의 단추로 다시 잰다(두 번째부터는 GPU 준비가 끝나 있다).
// 재는 것: 셰이더 읽기 · 빛 격자(GRID_PASSES번) · 면 굽기. 지금 앱의 `[bake] … ms … grid …` 과 같은 뜻이다.
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'ui/bake.dart';

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
  String _state = '준비 중…';
  bool _busy = false;
  BakeCase? _case;
  ui.FragmentProgram? _gridProg;
  ui.FragmentProgram? _bakeProg;

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
    final c = _case ??= await BakeCase.load();
    final gridProg = _gridProg ??= await ui.FragmentProgram.fromAsset('shaders/grid.frag');
    final bakeProg = _bakeProg ??= await ui.FragmentProgram.fromAsset('shaders/bake.frag');
    final loadMs = DateTime.now().difference(t0).inMilliseconds;

    final rows = <RowRun>[];
    final images = <ui.Image>[];
    for (final r in c.rows) {
      final t1 = DateTime.now();
      final grid = await solveGrid(gridProg, c, r);
      final gridMs = DateTime.now().difference(t1).inMilliseconds;
      final t2 = DateTime.now();
      final atlas = await bakeAtlas(bakeProg, c, r, grid);
      final bakeMs = DateTime.now().difference(t2).inMilliseconds;
      grid.dispose();
      images.add(atlas.image);
      final run = RowRun(r.items.length, atlas.w, atlas.h, gridMs, bakeMs);
      rows.add(run);
      // ignore: avoid_print
      print('[flbake] ${run.items} items ${run.w}x${run.h} ms ${run.total} grid $gridMs bake $bakeMs');
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
      _runs.add(run);
      _state = '${_runs.length}번째';
      _busy = false;
    });
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
            for (final img in _atlases)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SizedBox(
                  height: 90,
                  child: FittedBox(
                    alignment: Alignment.topLeft,
                    child: SizedBox(
                      width: img.width.toDouble(),
                      height: img.height.toDouble(),
                      child: CustomPaint(painter: _AtlasPainter(img)),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _AtlasPainter extends CustomPainter {
  _AtlasPainter(this.image);
  final ui.Image image;

  @override
  void paint(Canvas canvas, Size size) => canvas.drawImage(image, Offset.zero, Paint());

  @override
  bool shouldRepaint(_AtlasPainter old) => old.image != image;
}
