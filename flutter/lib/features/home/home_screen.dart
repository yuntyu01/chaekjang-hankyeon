// 홈 화면(책장 탭): 서재를 읽어 줄마다 굽고(담아 둔 그림이 있으면 그대로) 실제 책장을 그린다. 지금 앱 features/home/HomeScreen을 옮기는 중.
// 머리줄·하단바 덮개·책장 그림까지. 측정: 켤 때마다 logcat에 [flbake] 줄마다·[fltotal] 합, 제목을 길게 누르면 다시 굽는다
library;

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../services/cover_colors.dart';
import '../../ui/kit.dart' show Btn, showSheet;
import 'locked_rows.dart';

import '../../domain/camera.dart';
import '../../domain/place_books.dart';
import '../../domain/received3.dart';
import '../../domain/shelf_row.dart';
import '../../services/cover_cache.dart';
import '../../store/files.dart' show imageDir;
import '../../store/library_store.dart';
import '../../store/seed.dart';
import '../../ui/bake.dart';
import '../../ui/bake_cache.dart';
import '../../ui/book_key.dart';
import '../../ui/cover_photo.dart';
import '../../ui/glyph_metrics.dart';
import '../../ui/metrics.dart';
import '../../ui/outline.dart';
import '../../ui/plane_key.dart';
import '../../ui/ribbons.dart';
import '../../ui/scene.dart';
import '../../ui/theme.dart';

/// 앱이 깨어난 때(main이 채운다). 켜고 책장이 다 될 때까지를 잰다
DateTime bootAt = DateTime.now();

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

/// 창빛 그림자 그림의 배율(설계 단위 → 그림 칸). 지금 앱은 화면 배율을 쓴다
const _shadowScale = 2.0;

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _scroll = ScrollController();

  /// 책장 그림(입력이 같으면 다시 쓰고, 바뀌면 다시 그린다)
  ui.Image? _shelfImage;
  Object? _shelfKey;
  bool _frozen = false;
  Timer? _freezeTimer;

  /// 시작 사진(files/home_snapshot.png): 굳힌 책장 그림을 저장해 두고 다음에 켤 때 먼저 보인다
  ui.Image? _snap;
  static Future<File> _snapFile() async => File('${(await imageDir()).parent.path}/home_snapshot.png');

  Future<void> _loadSnap() async {
    try {
      final f = await _snapFile();
      if (!f.existsSync()) return;
      final img = await decodeImageInLine(await f.readAsBytes());
      if (img == null) return;
      if (!mounted || _atlases.length > 1) {
        img.dispose();
        return;
      }
      setState(() => _snap = img);
      // ignore: avoid_print
      print('[flsnap] 시작 사진 ${img.width}x${img.height}');
    } catch (_) {
      // 없거나 깨졌으면 그냥 진짜 책장을 기다린다
    }
  }

  Future<void> _saveSnap(ui.Image img) async {
    try {
      final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) return;
      await (await _snapFile()).writeAsBytes(bytes.buffer.asUint8List(), flush: true);
    } catch (_) {
      // 다음에 굳힐 때 다시 저장한다
    }
  }

  Widget _shelfLayer(ShelfPainter painter, Size size, double dpr) {
    final w = (size.width * dpr).ceil(), h = (size.height * dpr).ceil();
    // 셰이더가 아직 안 올라왔거나 그림이 너무 크면(텍스처 한도) 그대로 그린다
    // 켤 때는 화면에 보이는 만큼만 바로 그린다(한 장으로 굳히면 안 보이는 아래 줄까지 그려 책장이 1초쯤 늦게 뜬다).
    // 가만히 있게 되면(6초 뒤) 또는 밀기 시작하면 그림으로 굳힌다
    _freezeTimer ??= Timer(const Duration(seconds: 6), () {
      if (mounted && !_frozen) setState(() => _frozen = true);
    });
    if (!_frozen || !ShelfPainter.ready || h > 8192 || w > 8192) return CustomPaint(painter: painter);
    final key = (
      _runs.length,
      painter.rows,
      painter.atlases,
      painter.rowSpots,
      painter.photos,
      painter.bookKeys,
      painter.keys,
      painter.contentTop,
      painter.bottomInset,
      painter.viewport,
      painter.frostedFrom,
      w,
      h,
    );
    if (_shelfImage == null || _shelfKey != key) {
      final rec = ui.PictureRecorder();
      final canvas = Canvas(rec)..scale(dpr);
      painter.paint(canvas, size);
      final pic = rec.endRecording();
      final old = _shelfImage;
      _shelfImage = pic.toImageSync(w, h);
      _shelfKey = key;
      pic.dispose();
      final saved = _shelfImage!;
      WidgetsBinding.instance.addPostFrameCallback((_) => _saveSnap(saved));
      // 시작 사진은 진짜 책장이 떴으니 놓는다
      final s0 = _snap;
      if (s0 != null) {
        _snap = null;
        WidgetsBinding.instance.addPostFrameCallback((_) => s0.dispose());
      }
      // 앞 장은 이번 화면이 다 그려진 뒤 놓는다
      if (old != null) WidgetsBinding.instance.addPostFrameCallback((_) => old.dispose());
    }
    return RawImage(image: _shelfImage, width: size.width, height: size.height, scale: dpr, filterQuality: FilterQuality.none, fit: BoxFit.fill);
  }

  final List<Run> _runs = [];
  final List<ui.Image> _atlases = [];
  final List<List<Spot>> _rowSpots = [];
  final List<double> _spaces = [];
  final List<({PlaneKey wall, PlaneKey floor})> _keys = [];
  String _state = '준비 중…';

  /// 줄마다 책이 받는 창빛 그림자(책 id → 면 칸 그림)
  List<Map<String, BookKey>> _bookKeys = const [];

  /// 받아 온 표지 사진(주소 → 그림). 받는 대로 다시 그린다(그 전까지는 코드로 그린 장정)
  Map<String, CoverPhoto> _photos = const {};
  bool _busy = false;

  /// 줄 가운데 맨 끝 몇 줄이 잠긴 칸인지
  int _lockedCount = 0;
  BakeCase? _case;
  ShaderSlots? _gridSlots;
  ShaderSlots? _bakeSlots;

  @override
  void initState() {
    super.initState();
    shelfRefresh.addListener(_refresh);
    _loadSnap();
    WidgetsBinding.instance.addPostFrameCallback((_) => _run());
  }

  // 표지 색·두께·갈피 색이 새로 맞춰졌다: 줄을 서재에서 다시 만들어 굽는다(굽는 중이면 끝난 뒤)
  bool _again = false;
  void _refresh() {
    if (!mounted) return;
    if (_busy) {
      _again = true;
      return;
    }
    _case = null;
    _run();
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
    _loadCovers([for (final b in lib.books) ?b.coverArtUri]);
    final shelves = placeShelves(lib);
    // 마지막 선반 아래 잠긴 칸(다섯 칸까지): 흐린 예시 책
    final locked = [for (var i = 0; i < lockedShelfCount(shelves.length); i++) await lockedRow(i)];
    _lockedCount = locked.length;
    final c = _case ??= BakeCase([
      for (var i = 0; i < shelves.length; i++) rowFromBooks(shelves[i], lib.books, rowSpace, top: i == 0, last: i == shelves.length - 1 && locked.isEmpty),
      for (var i = 0; i < locked.length; i++) rowFromBooks(locked[i].bodies, locked[i].books, rowSpace, last: i == locked.length - 1),
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
        r.tabLoss = await readTabLosses(r, hit, pack.at);
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
      r.tabLoss = await readTabLosses(r, atlas.image, atlas.at);
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
    // 책 면이 받는 창빛 그림자(다른 책이 가리는 몫): 줄마다 책마다(위 판이 막는 부분은 뺀 가리개)
    final bookKeys = <Map<String, BookKey>>[];
    for (var ri = 0; ri < c.rows.length - 1; ri++) {
      final r = c.rows[ri];
      final keysOf = <String, BookKey>{};
      for (final b in r.books) {
        final key = await bookKeyImage(b, receivedShadow3(b, occludersIn(r.books, b, r.space), _shadowScale), _shadowScale);
        if (key != null) keysOf[b.id] = key;
      }
      bookKeys.add(keysOf);
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
      _bookKeys = bookKeys;
      _runs.add(run);
      _state = '${_runs.length}번째';
      _busy = false;
    });
    if (_again) {
      _again = false;
      _refresh();
    }
  }

  // 잠긴 선반 시트(지금 앱 LockedShelfSheet): 결제는 아직 붙이지 않아 무료로 연다
  void _openLocked() => showSheet<void>(
    context,
    title: '선반 한 칸 더 열기',
    description: '책을 더 진열할 수 있는 선반이 한 칸 늘어나요. 한 번 열면 계속 쓸 수 있어요.',
    builder: (ctx) => Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Btn(
        label: '무료로 열기',
        size: 'l',
        onPress: () async {
          Navigator.pop(ctx);
          final ok = await addShelf();
          if (!mounted) return;
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(ok ? '선반을 열었어요.' : '지금은 바꿀 수 없어요.'), duration: const Duration(seconds: 2)));
          if (ok) _refresh();
        },
      ),
    ),
  );

  /// 표지 사진을 받는다(기기에 있으면 바로). 하나 올 때마다 다시 그린다
  bool _pruned = false;
  void _loadCovers(List<String> uris) {
    if (!_pruned) {
      _pruned = true;
      pruneCoverCache();
    }
    final t0 = DateTime.now();
    var left = uris.toSet().length;
    for (final uri in uris.toSet()) {
      if (_photos.containsKey(uri)) {
        left--;
        continue;
      }
      loadCover(uri).then((img) async {
        if (img != null && mounted) {
          final photo = await CoverPhoto.of(img);
          setState(() => _photos = {..._photos, uri: photo});
        }
        if (--left == 0) debugPrint('[flcover] ${uris.length} covers ${DateTime.now().difference(t0).inMilliseconds}ms got ${_photos.length}');
      });
    }
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
    _scroll.dispose();
    _shelfImage?.dispose();
    _snap?.dispose();
    _freezeTimer?.cancel();
    shelfRefresh.removeListener(_refresh);
    for (final i in _atlases) {
      i.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final r = _runs.isEmpty ? null : _runs.last;
    final pad = MediaQuery.paddingOf(context);
    final scale = MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.3);
    Widget header() => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: scale),
      child: _Header(
        year: DateTime.now().year,
        // 측정 메뉴: 제목을 길게 누르면 다시 굽고 시간을 알린다(지금 앱 측정 번들의 책장 메뉴 자리)
        onLongPress: _busy ? null : _run,
        status: r == null ? _state : '굽기 ${r.bakeTotal}ms · 켠 뒤 ${r.sinceBoot}ms',
      ),
    );
    final ready = _atlases.length > 1 && _rowSpots.length == _spaces.length;
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final snap = _snap;
    return ColoredBox(
      color: AppColors.bg,
      child: Stack(
        children: [
          // 시작 사진(지금 앱 LoadingScreen 스냅샷): 진짜 책장이 준비될 때까지 지난번에 굳힌 책장 그림을 먼저 보인다
          if (!ready && snap != null && snap.width == (MediaQuery.sizeOf(context).width * dpr).ceil()) ...[
            Positioned(
              left: 0,
              top: 0,
              child: IgnorePointer(
                child: RawImage(image: snap, width: snap.width / dpr, height: snap.height / dpr, scale: dpr, filterQuality: FilterQuality.none, fit: BoxFit.fill),
              ),
            ),
            Positioned(left: 0, right: 0, top: pad.top, child: header()),
          ],
          // 책장(머리글 아래부터, 맨 윗줄 벽은 머리글 뒤까지). 지금 앱 홈 화면과 같은 구도
          if (ready)
            Positioned.fill(
              // 지금 앱: 스크롤 영역은 상태 표시줄 아래부터(위로 올라간 책은 상태 표시줄 밑에서 잘린다)
              child: ClipRect(
                clipper: _BelowTop(pad.top),
                child: LayoutBuilder(
                  builder: (context, box) {
                    final contentTop = pad.top + homeHeaderHeight;
                    final bottomInset = navigationShelfReserve + pad.bottom;
                    final m = makeMetrics(box.maxWidth);
                    final n = _rowSpots.length;
                    final geo = computeRows(n, m.scale, viewportHeight: box.maxHeight - contentTop, bottomInset: bottomInset);
                    // 잠긴 칸까지 다 보이게 세로로 넘긴다(머리줄도 함께, 지금 앱 홈 스크롤)
                    final last = geo.isEmpty ? null : geo.last;
                    // 끝 여백(지금 앱 contentEnd): 판 그늘 몫과 하단바 블록 + 덮개 0.6 중 큰 것
                    final tail = math.max((shelfCastExtent + 8) * m.scale, pad.bottom + TabBarStyle.gap + TabBarStyle.height + TabBarStyle.fade * 0.6);
                    final height = math.max(box.maxHeight, last == null ? 0.0 : contentTop + last.top + last.height + tail);
                    final lockedFrom = n - _lockedCount;
                    return NotificationListener<ScrollStartNotification>(
                      onNotification: (_) {
                        if (!_frozen) setState(() => _frozen = true);
                        return false;
                      },
                      child: SingleChildScrollView(
                        controller: _scroll,
                        child: SizedBox(
                          width: box.maxWidth,
                          height: height,
                          child: Stack(
                            children: [
                              // 책장은 화면 밀도 크기의 그림 한 장으로 한 번 그려 두고 밀 때는 옮기기만 한다(지금 앱 줄 캔버스와 같은 생각).
                              // 그대로 두면 밀 때마다 빛 셰이더를 모두 다시 돌려 에뮬에서 16fps였다. 셰이더 좌표는 그리는 면 기준이라 결과 화소는 같다
                              Positioned.fill(
                                child: RepaintBoundary(
                                  child: _shelfLayer(
                                    ShelfPainter(
                                      rows: _case!.rows,
                                      atlases: _atlases,
                                      rowSpots: _rowSpots,
                                      spaces: _spaces,
                                      photos: _photos,
                                      bookKeys: _bookKeys,
                                      keys: _keys,
                                      contentTop: contentTop,
                                      bottomInset: bottomInset,
                                      viewport: box.maxHeight,
                                      frostedFrom: lockedFrom,
                                    ),
                                    Size(box.maxWidth, height),
                                    MediaQuery.devicePixelRatioOf(context),
                                  ),
                                ),
                              ),
                              // 머리줄(책장과 함께 스크롤: 지금 앱 2026-11-04 '상단 라인은 고정이 아니야'): 왼쪽 '나의 책장'과 그 밑 해, 오른쪽 스토어·꾸미기·전체 책·더하기
                              Positioned(left: 0, right: 0, top: pad.top, child: header()),
                              // 잠긴 칸: 가운데 자물쇠, 누르면 선반 한 칸 더 열기
                              for (var i = lockedFrom; i < n && i < geo.length; i++)
                                Positioned(
                                  left: 0,
                                  right: 0,
                                  top: contentTop + geo[i].top,
                                  height: geo[i].height,
                                  child: Semantics(
                                    button: true,
                                    label: '잠긴 선반, 눌러서 열기',
                                    onTap: _openLocked,
                                    excludeSemantics: true,
                                    child: _Pressable(
                                      onTap: _openLocked,
                                      child: const Center(child: _LockIcon()),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          // 화면 위 끝 덮개(지금 앱 HeaderVeil): 올라간 거리만큼(28dp까지) 진해지는 벽색 그라데이션
          Positioned(
            left: 0,
            right: 0,
            top: pad.top,
            height: _veilH,
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _scroll,
                builder: (context, _) {
                  final o = _scroll.hasClients ? (_scroll.offset / _veilH).clamp(0.0, 1.0) : 0.0;
                  return Opacity(
                    opacity: o,
                    child: const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [AppColors.bg, Color(0xD9FFFFFF), Color(0x00FFFFFF)], stops: [0, 0.35, 1]),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          // 하단바 쪽 덮개: 책장이 하단바 뒤로 들어갈 때 벽 색으로 서서히 덮는다(지금 앱 TabBarFade)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: pad.bottom + TabBarStyle.gap + TabBarStyle.height + TabBarStyle.fade,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment(0, -1 + 2 * TabBarStyle.fade / (pad.bottom + TabBarStyle.gap + TabBarStyle.height + TabBarStyle.fade)),
                    colors: [for (final a in _fadeStops) Color.fromRGBO(255, 255, 255, a.$2)],
                    stops: [for (final a in _fadeStops) a.$1],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 화면 위 끝 덮개 높이(지금 앱 HEADER_FADE)
const _veilH = 28.0;

/// top 아래만 보이게 자른다(상태 표시줄 밑부터)
class _BelowTop extends CustomClipper<Rect> {
  const _BelowTop(this.top);
  final double top;
  @override
  Rect getClip(Size size) => Rect.fromLTRB(0, top, size.width, size.height);
  @override
  bool shouldReclip(_BelowTop old) => old.top != top;
}

/// 하단바 덮개 농도(끝이 부드러운 곡선)
const _fadeStops = [(0.0, 0.0), (0.2, 0.05), (0.4, 0.2), (0.6, 0.48), (0.8, 0.8), (1.0, 1.0)];

/// 머리줄 높이(지금 앱은 배치에서 잰다): 위 16 + 제목 줄 34 + 4 + 해 줄 23 + 아래 12. 글자 줄은 지금 앱처럼 화소로 올린 높이(rnPx)
double get homeHeaderHeight => TabHeader.paddingTop + rnPx(34) + 4 + rnPx(23) + TabHeader.paddingBottom;

/// 책장 줄 배치에서 하단바 몫(지금 앱 navigation.shelfReserve)
const navigationShelfReserve = 78.0;

/// 머리줄 오른쪽 아이콘: 칸 34, 그림 31, 맨 끝 칸 가운데가 화면 끝에서 24.3(시안에서 떠낸 그림)
const _headerCell = 34.0;
const _headerArt = 31.0;
const _headerLastCenter = 24.3;

class _Header extends StatelessWidget {
  const _Header({required this.year, required this.status, this.onLongPress});
  final int year;
  final String status;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    Widget icon(String name, String label) => Semantics(
      button: true,
      label: label,
      child: _Pressable(
        onTap: () => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text('$label: 아직 옮기는 중이에요'), duration: const Duration(seconds: 1))),
        child: SizedBox(
          width: _headerCell,
          height: 44,
          child: Center(
            child: Image.asset('assets/header/$name.png', width: _headerArt, height: _headerArt),
          ),
        ),
      ),
    );
    return Padding(
      // 지금 앱(커밋된 HomeScreen): 머리줄 아래 여백 = tabHeader 12, 해는 제목 밑 4dp·보통 굵기(headerType.sub).
      // 다른 세션의 11-10 미커밋 조정(아래 여백 4·해 −2dp SemiBold)은 커밋되면 함께 옮긴다
      padding: const EdgeInsets.fromLTRB(TabHeader.paddingH, TabHeader.paddingTop, TabHeader.paddingH - (TabHeader.paddingH - (_headerLastCenter - _headerCell / 2)), TabHeader.paddingBottom),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: GestureDetector(
              onLongPress: onLongPress,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('나의 책장', style: AppType.title, maxLines: 1),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Tooltip(
                      message: status,
                      child: Text('$year', style: AppType.sub, maxLines: 1),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 2.5),
            child: Row(children: [icon('store', '스토어'), icon('decorate', '꾸미기'), icon('books', '전체 책'), icon('add', '책 더하기')]),
          ),
        ],
      ),
    );
  }
}

/// 잠긴 칸 자물쇠(지금 앱 TabIcons LockIcon 32×40, 색 #3F4347·구멍 #F4F3F2)
class _LockIcon extends StatelessWidget {
  const _LockIcon();

  @override
  Widget build(BuildContext context) => CustomPaint(size: const Size(32, 40), painter: _LockPainter());
}

class _LockPainter extends CustomPainter {
  static const _ink = Color(0xFF3F4347), _hole = Color(0xFFF4F3F2);

  @override
  void paint(Canvas canvas, Size size) {
    final shackle = Path()
      ..moveTo(8.5, 19)
      ..lineTo(8.5, 11.5)
      ..arcToPoint(const Offset(23.5, 11.5), radius: const Radius.circular(7.5))
      ..lineTo(23.5, 19);
    canvas.drawPath(
      shackle,
      Paint()
        ..color = _ink
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.6,
    );
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(2.5, 16.5, 27, 22), const Radius.circular(5.5)), Paint()..color = _ink);
    canvas.drawCircle(const Offset(16, 25.5), 3.1, Paint()..color = _hole);
    canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(14.5, 25.5, 3, 6.5), const Radius.circular(1.5)), Paint()..color = _hole);
  }

  @override
  bool shouldRepaint(_LockPainter old) => false;
}

/// 눌리는 동안 옅어지는 단추(지금 앱 press 0.55)
class _Pressable extends StatefulWidget {
  const _Pressable({required this.child, this.onTap});
  final Widget child;
  final VoidCallback? onTap;

  @override
  State<_Pressable> createState() => _PressableState();
}

class _PressableState extends State<_Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.opaque,
    onTapDown: (_) => setState(() => _down = true),
    onTapCancel: () => setState(() => _down = false),
    onTapUp: (_) => setState(() => _down = false),
    onTap: widget.onTap,
    child: Opacity(opacity: _down ? pressOpacity : 1, child: widget.child),
  );
}

/// 구운 줄들을 실제 책장처럼 쌓아 그린다(지금은 뒷벽만, ui/scene). 줄마다 카메라가 따로다
class ShelfPainter extends CustomPainter {
  ShelfPainter({
    required this.rows,
    required this.atlases,
    required this.rowSpots,
    required this.spaces,
    required this.keys,
    this.photos = const {},
    this.bookKeys = const [],
    this.contentTop = 78,
    this.bottomInset = 0,
    this.viewport,
    this.frostedFrom = 1 << 30,
  });

  /// 줄 자리를 정하는 화면 높이(스크롤해도 줄 자리는 화면 기준, 지금 앱 computeRows)
  final double? viewport;

  /// 이 차례부터는 잠긴 칸(책을 흐리게)
  final int frostedFrom;

  /// 콘텐츠(책장 줄) 위 끝과 아래 하단바 몫(화면 px)
  final double contentTop;
  final double bottomInset;
  final Map<String, CoverPhoto> photos;
  final List<Map<String, BookKey>> bookKeys;
  final List<RowCase> rows;
  final List<ui.Image> atlases;
  final List<List<Spot>> rowSpots;
  final List<double> spaces;
  final List<({PlaneKey wall, PlaneKey floor})> keys;

  static ShaderSlots? _lit;
  static ShaderSlots? _book;
  static ShaderSlots? _tab;
  static GlyphMetrics? _glyphs;

  /// 그리기 셰이더가 다 올라왔는지(그림으로 굳히기 전에 본다)
  static bool get ready => _lit != null && _book != null && _tab != null && _glyphs != null;

  /// 그리기 셰이더는 한 번만 올린다(미리 컴파일돼 있다)
  static Future<void> load() async {
    _lit ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/lit.frag'), litUniformNames);
    _book ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/book.frag'), bookUniformNames);
    _tab ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/tab.frag'), tabUniformNames);
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
    final contentY = contentTop;
    final geo = computeRows(rows.length, m.scale, viewportHeight: (viewport ?? size.height) - contentY, bottomInset: bottomInset);
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
      drawRow(
        canvas,
        lit,
        book,
        cam,
        px,
        rows[i],
        rowSpots[i],
        atlases[i],
        r.space,
        keys[i],
        glyphs: _glyphs,
        photos: photos,
        tab: _tab,
        bookKeys: i < bookKeys.length ? bookKeys[i] : const {},
        frosted: i >= frostedFrom,
      );
      canvas.restore();
      if (contentY + y0 > size.height) break;
    }
  }

  @override
  bool shouldRepaint(ShelfPainter old) =>
      old.atlases != atlases ||
      old.photos != photos ||
      old.bookKeys != bookKeys ||
      old.contentTop != contentTop ||
      old.bottomInset != bottomInset ||
      old.viewport != viewport ||
      old.frostedFrom != frostedFrom;
}
