// 관문 측정 앱(2026-11-13): 지금 앱(React Native)과 같은 값·같은 양으로 줄 여섯을 구워 시간을 잰다.
// 켜면 바로 한 번 굽고 logcat에 남긴다([flbake] 줄마다, [fltotal] 합). 화면의 단추로 다시 잰다(두 번째부터는 GPU 준비가 끝나 있다).
// 재는 것: 셰이더 읽기 · 빛 격자(GRID_PASSES번) · 면 굽기. 지금 앱의 `[bake] … ms … grid …` 과 같은 뜻이다.
import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'domain/camera.dart';
import 'domain/place_books.dart';
import 'domain/shelf_row.dart';
import 'ui/bake.dart';
import 'ui/bake_cache.dart';
import 'ui/plane_key.dart';
import 'store/library_store.dart';
import 'store/seed.dart';
import 'ui/glyph_metrics.dart';
import 'ui/metrics.dart';
import 'ui/outline.dart';
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

/// 머리글(나의 책장 · 2026) 높이: 그 아래가 책장 콘텐츠 위 끝
const _headerH = 78.0;

/// 창빛 그림자 그림의 배율(설계 단위 → 그림 칸). 지금 앱은 화면 배율을 쓴다
const _shadowScale = 2.0;

class GatePage extends StatefulWidget {
  const GatePage({super.key});

  @override
  State<GatePage> createState() => _GatePageState();
}

class _GatePageState extends State<GatePage> {
  final List<Run> _runs = [];
  final List<ui.Image> _atlases = [];
  final List<List<Spot>> _rowSpots = [];
  final List<double> _spaces = [];
  final List<({PlaneKey wall, PlaneKey floor})> _keys = [];
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
    // 서재(SQLite)에서 책과 자리를 읽어 줄을 만든다. 비어 있으면 보기 책을 넣는다
    await seedIfEmpty();
    final lib = await loadLibrary();
    final shelves = placeShelves(lib);
    final c = _case ??= BakeCase([
      for (var i = 0; i < shelves.length; i++)
        rowFromBooks(shelves[i], lib.books, rowSpace, top: i == 0, last: i == shelves.length - 1),
      probeRow(),
    ]);
    await ShelfPainter.load();
    final gridSlots = _gridSlots ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/grid.frag'), gridUniformNames);
    final bakeSlots = _bakeSlots ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/bake.frag'), bakeUniformNames);
    final loadMs = DateTime.now().difference(t0).inMilliseconds;

    await loadBakeCache();
    final rows = <RowRun>[];
    final images = <ui.Image>[];
    final spots = <List<Spot>>[];
    final spaces = <double>[];
    final keys = <({PlaneKey wall, PlaneKey floor})>[];
    for (var ri = 0; ri < c.rows.length; ri++) {
      final r = c.rows[ri];
      final probe = ri == c.rows.length - 1; // 맨 뒤는 값 확인용(시간에 넣지 않는다)
      // 같은 값으로 구워 담아 둔 그림이 있으면 굽지 않는다
      final key = bakeKey(r);
      final hit = cachedBake(key);
      if (hit != null) {
        final pack = packAtlas(r.items);
        images.add(hit);
        if (!probe) {
          spots.add(pack.at);
          spaces.add(r.space);
          keys.add(await rowKeys(r, _shadowScale));
          rows.add(RowRun(r.items.length, pack.w, pack.h, 0, 0));
        }
        // ignore: avoid_print
        print('[flbake] ${r.items.length} items ${pack.w}x${pack.h} cached');
        continue;
      }
      final t1 = DateTime.now();
      final grid = await solveGrid(gridSlots, c, r);
      final gridMs = DateTime.now().difference(t1).inMilliseconds;
      final t2 = DateTime.now();
      final atlas = await bakeAtlas(bakeSlots, c, r, grid);
      final bakeMs = DateTime.now().difference(t2).inMilliseconds;
      grid.dispose();
      images.add(atlas.image);
      unawaited(saveBake(key, atlas.image));
      if (!probe) {
        spots.add(atlas.at); // 면 0 = 뒷벽, 1 = 판 윗면, 2 = 판 앞면, 3부터 책 면
        spaces.add(r.space);
        keys.add(await rowKeys(r, _shadowScale));
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
      _rowSpots
        ..clear()
        ..addAll(spots);
      _spaces
        ..clear()
        ..addAll(spaces);
      _keys
        ..clear()
        ..addAll(keys);
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
    final r = _runs.isEmpty ? null : _runs.last;
    return Scaffold(
      backgroundColor: const Color(0xFFFFFFFF),
      body: SafeArea(
        child: Stack(
          children: [
            // 책장(화면 전체). 지금 앱 홈 화면과 같은 구도로 그린다
            if (_atlases.length > 1 && _rowSpots.length == _spaces.length)
              Positioned.fill(
                child: CustomPaint(
                  painter: ShelfPainter(
                    rows: _case!.rows,
                    atlases: _atlases,
                    rowSpots: _rowSpots,
                    spaces: _spaces,
                    keys: _keys,
                  ),
                ),
              ),
            // 머리글(지금 앱과 같은 자리·글씨)
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 8, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('나의 책장', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: Color(0xFF191F28))),
                  Text('2026', style: TextStyle(fontSize: 15, color: Color(0xFF8B95A1))),
                ],
              ),
            ),
            // 측정 값(관문용)
            Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: Colors.white70, borderRadius: BorderRadius.circular(8)),
                      child: Text(
                        r == null ? _state : '굽기 ${r.bakeTotal}ms · 켠 뒤 ${r.sinceBoot}ms',
                        style: const TextStyle(fontSize: 12, color: Color(0xFF191F28)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(onPressed: _busy ? null : _run, child: const Text('다시 굽기')),
                  ],
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
  ShelfPainter({required this.rows, required this.atlases, required this.rowSpots, required this.spaces, required this.keys});
  final List<RowCase> rows;
  final List<ui.Image> atlases;
  final List<List<Spot>> rowSpots;
  final List<double> spaces;
  final List<({PlaneKey wall, PlaneKey floor})> keys;

  static ShaderSlots? _lit;
  static ShaderSlots? _book;
  static GlyphMetrics? _glyphs;

  /// 그리기 셰이더는 한 번만 올린다(미리 컴파일돼 있다)
  static Future<void> load() async {
    _lit ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/lit.frag'), litUniformNames);
    _book ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/book.frag'), bookUniformNames);
    _glyphs ??= await GlyphMetrics.load(titleFontAsset);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final lit = _lit;
    final book = _book;
    if (lit == null || book == null) return;
    final m = makeMetrics(size.width);
    final cam = Cam(viewPitchMin);
    // 머리글 아래가 콘텐츠 위 끝(지금 앱 홈 스크롤 영역)
    const contentY = _headerH;
    final geo = computeRows(rows.length, m.scale, viewportHeight: size.height - contentY);
    Affine pxOf(RowGeom r) => Affine(m.scale, m.originX + sideMargin * m.scale, contentY + r.baseline);
    for (var i = 0; i < rowSpots.length && i < atlases.length && i < geo.length; i++) {
      final r = geo[i];
      final px = pxOf(r);
      // 줄 캔버스(지금 앱 RowCanvas): 칸 위로 맨 윗줄 벽 끝까지, 아래로 판 밑 벽까지. 윗선반 판 윤곽 안은 비운다(그 판이 보인다)
      final y0 = math.max(0.0, r.top - headDu * m.scale);
      final y1 = r.top + r.height + shelfCastExtent * m.scale;
      canvas.save();
      final area = Path()..addRect(Rect.fromLTRB(0, contentY + y0, size.width, contentY + y1));
      final up = i > 0 ? plankOutlinePath((v) => toPx(cam, pxOf(geo[i - 1]), v), m.scale) : null;
      canvas.clipPath(up == null ? area : Path.combine(PathOperation.difference, area, up));
      drawRow(canvas, lit, book, cam, px, rows[i], rowSpots[i], atlases[i], r.space, keys[i], glyphs: _glyphs);
      canvas.restore();
      if (contentY + y0 > size.height) break;
    }
  }

  @override
  bool shouldRepaint(ShelfPainter old) => old.atlases != atlases;
}

