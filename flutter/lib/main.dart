// 관문 측정 앱(2026-11-13): 지금 앱(React Native)과 같은 값으로 줄 하나를 구워 시간을 잰다.
// 켜면 바로 한 번 굽고 logcat에 남긴다([flbake] …). 화면의 단추로 다시 잰다(두 번째부터는 셰이더가 이미 올라와 있다).
// 재는 것: 빛 격자(GRID_PASSES번) · 면 굽기 · 합. 지금 앱의 `[bake] … ms … grid …` 과 같은 뜻이다.
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'ui/bake.dart';

Future<void> main() async {
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

class Run {
  Run(this.gridMs, this.bakeMs, this.loadMs, this.w, this.h);
  final int gridMs;
  final int bakeMs;
  final int loadMs;
  final int w;
  final int h;
  int get total => gridMs + bakeMs;
}

class GatePage extends StatefulWidget {
  const GatePage({super.key});

  @override
  State<GatePage> createState() => _GatePageState();
}

class _GatePageState extends State<GatePage> {
  final List<Run> _runs = [];
  ui.Image? _atlas;
  String _state = '준비 중…';
  bool _busy = false;

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
    final c = await BakeCase.load();
    // 셰이더는 빌드할 때 미리 컴파일돼 있다(impellerc). 여기서는 읽어 올리기만 한다
    final gridProg = await ui.FragmentProgram.fromAsset('shaders/grid.frag');
    final bakeProg = await ui.FragmentProgram.fromAsset('shaders/bake.frag');
    final loadMs = DateTime.now().difference(t0).inMilliseconds;

    final t1 = DateTime.now();
    final grid = await solveGrid(gridProg, c);
    final gridMs = DateTime.now().difference(t1).inMilliseconds;

    final t2 = DateTime.now();
    final atlas = await bakeAtlas(bakeProg, c, grid);
    final bakeMs = DateTime.now().difference(t2).inMilliseconds;
    grid.dispose();

    final run = Run(gridMs, bakeMs, loadMs, atlas.w, atlas.h);
    // ignore: avoid_print
    print('[flbake] ${c.items.length} items ${atlas.w}x${atlas.h} ms ${run.total} grid $gridMs bake $bakeMs load $loadMs');
    if (!mounted) return;
    setState(() {
      _atlas?.dispose();
      _atlas = atlas.image;
      _runs.add(run);
      _state = '${_runs.length}번째';
      _busy = false;
    });
  }

  @override
  void dispose() {
    _atlas?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Flutter 굽기 관문')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_state, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final r in _runs)
              Text('합 ${r.total}ms  (격자 ${r.gridMs} · 면 ${r.bakeMs} · 셰이더 읽기 ${r.loadMs})  ${r.w}x${r.h}'),
            const SizedBox(height: 12),
            FilledButton(onPressed: _busy ? null : _run, child: const Text('다시 굽기')),
            const SizedBox(height: 16),
            if (_atlas != null)
              Expanded(
                child: FittedBox(
                  alignment: Alignment.topLeft,
                  child: SizedBox(
                    width: _atlas!.width.toDouble(),
                    height: _atlas!.height.toDouble(),
                    child: CustomPaint(painter: _AtlasPainter(_atlas!)),
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
