// 홈 화면(책장 탭): 서재를 읽어 줄마다 굽고(담아 둔 그림이 있으면 그대로) 실제 책장을 그린다. 지금 앱 features/home/HomeScreen을 옮기는 중.
// 머리줄·하단바 덮개·책장 그림까지. 측정: 켤 때마다 logcat에 [flbake] 줄마다·[fltotal] 합, 제목을 길게 누르면 다시 굽는다
library;

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart' show SchedulerBinding;
import 'package:flutter/material.dart';

import '../../services/cover_colors.dart';
import '../../ui/kit.dart' show Btn, showSheet;
import 'locked_rows.dart';
import 'book_sheet.dart';
import '../book/all_books_screen.dart' show openAllBooks;
import '../store/store_screen.dart' show openStore;
import 'decorate_panel.dart';
import '../../app/app_shell.dart' show tabBarHidden;
import '../../domain/geometry.dart' show maxFrontSpin, maxSpin;
import '../../domain/layout.dart' show ShelfLayout, placementOf, shelfItems, sortedShelves;
import '../../domain/book3_physics.dart' show fromPlaced;
import '../../domain/geometry.dart' show shelfUsableWidth;
import '../../domain/layout_engine.dart';
import '../../domain/types.dart' show Book, Pose, tiltToward;
import '../../domain/shelf_scene.dart' show computeShelf, resolveLeans;
import '../../domain/vec3.dart' show C3, Vec3;
import '../../domain/book3.dart' show corners, toWorld;
import '../../domain/front_pose.dart' show FrontState;
import '../../domain/placed.dart' show jsRound;
import '../../store/placement_store.dart';

import '../../domain/camera.dart';
import '../../domain/place_books.dart';
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
import '../../ui/row_bake.dart';
import '../../ui/scene.dart';
import '../../ui/theme.dart';
import '../book/add_book_screen.dart' show openAddBook;

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

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _scroll = ScrollController();

  // ---------- 누르기·꾸미기(책장 편집) ----------
  /// 마지막으로 그린 책장 기하(누른 책 찾기용): 줄 자리·화면 배율·머리글 아래 끝·잠긴 칸 시작
  ({ShelfMetrics m, List<RowGeom> geo, double contentTop, int lockedFrom})? _geom;
  bool _decorating = false;
  String? _editId;
  String? _editMsg;
  ({String title, Pose pose, int lean, ({bool left, bool right}) canLean, double spin, double spinMax, ({double lo, double hi})? spinRange, ({double lo, double hi, double z}) depth})? _panel;

  /// 정보 시트를 연 책(시트가 열린 동안 윤곽 빛)
  String? _popId;

  /// 그 책이 있는 줄이 화면 가운데쯤 오게 넘기고 2.5초 윤곽을 빛낸다
  void _focusBook() {
    final id = focusBookOnShelf.value, g = _geom, c = _case;
    if (id == null || g == null || c == null) return;
    focusBookOnShelf.value = null;
    final i = [for (var k = 0; k < c.rows.length; k++) if (c.rows[k].books.any((b) => b.id == id)) k].firstOrNull;
    if (i == null || i >= g.geo.length) return;
    if (_scroll.hasClients) {
      final r = g.geo[i];
      final p = _scroll.position;
      final target = (g.contentTop + r.top + r.height / 2 - p.viewportDimension / 2).clamp(0.0, p.maxScrollExtent);
      _scroll.animateTo(target, duration: const Duration(milliseconds: 300), curve: Curves.easeOutCubic);
    }
    setState(() => _popId = id);
    Future<void>.delayed(const Duration(milliseconds: 2500), () {
      if (mounted && _popId == id) setState(() => _popId = null);
    });
  }

  /// 그린 책(잠긴 칸 빼고)마다 화면 윤곽(콘텐츠 좌표)과 가장 앞 깊이. 줄마다 그릴 때와 같은 카메라·변환
  Iterable<({String id, ui.Path path, double z})> _outlines([String? only]) sync* {
    final g = _geom, c = _case;
    if (g == null || c == null) return;
    final cam = Cam(viewPitchMin);
    for (var i = 0; i < g.lockedFrom && i < g.geo.length && i < c.rows.length; i++) {
      final px = Affine(g.m.scale, g.m.originX + sideMargin * g.m.scale, g.contentTop + g.geo[i].baseline);
      for (final b in c.rows[i].books) {
        if (only != null && b.id != only) continue;
        yield (id: b.id, path: bookOutline(cam, px, b), z: corners(b).map((v) => v.z).reduce(math.min));
      }
    }
  }

  /// 누른 점 아래의 책: 윤곽 안에 든 것 중 가장 앞(깊이 작은) 책
  String? _hitBook(Offset p) {
    String? best;
    var bestZ = double.infinity;
    for (final o in _outlines()) {
      if (o.z < bestZ && o.path.contains(p)) {
        bestZ = o.z;
        best = o.id;
      }
    }
    return best;
  }

  ui.Path? _outlineOf(String? id) => id == null ? null : _outlines(id).firstOrNull?.path;

  Future<void> _onTap(Offset p) async {
    final id = _hitBook(p);
    if (_decorating) {
      setState(() {
        _drag = null;
        _editId = id;
        _editMsg = null;
      });
      _computePanel();
      return;
    }
    if (id == null) return;
    setState(() => _popId = id);
    await showBookSheet(context, id);
    if (mounted) setState(() => _popId = null);
  }

  Future<void> _enterDecorate([String? id]) async {
    await PlacementStore.instance.ensure();
    if (!mounted) return;
    setState(() {
      _decorating = true;
      _editId = id;
      _editMsg = null;
    });
    tabBarHidden.value = true;
    _computePanel();
  }

  void _exitDecorate() {
    _clearPreview();
    setState(() {
      _drag = null;
      _decorating = false;
      _editId = null;
      _panel = null;
      _editMsg = null;
    });
    tabBarHidden.value = false;
  }

  /// 고른 책의 조작부 값(자세·기대기 가능 방향·회전 범위·앞뒤 범위)
  void _computePanel() {
    final s = PlacementStore.instance, l = s.layout, id = _editId;
    final p = l == null || id == null ? null : placementOf(l, id);
    if (l == null || id == null || p == null) {
      setState(() => _panel = null);
      return;
    }
    // 기울이면 실제로 기대는지(닿을 곳이 없으면 바로 선다). 그 선반만 풀어 본다
    bool can(int d) {
      if (p.pose != Pose.upright) return false;
      if (p.tilt.sign == d) return true;
      final r = setTilt(l, s.books, id, tiltToward(d));
      return r.ok && (placementOf(resolveLeans(r.layout!, s.books, p.shelfId), id)?.tilt ?? 0) != 0;
    }

    final fs = p.pose == Pose.front ? frontStateOf(l, s.books, id) : null;
    setState(() => _panel = (
          title: s.books[id]?.title ?? '',
          pose: p.pose == Pose.front && (p.pitch ?? 0) >= 89.95 ? Pose.horizontal : p.pose,
          lean: p.tilt.sign,
          canLean: (left: can(-1), right: can(1)),
          spin: fs?.state.spin ?? p.spin ?? 0,
          spinMax: p.pose == Pose.front ? maxFrontSpin : maxSpin,
          spinRange: spinRangeOf(l, s.books, id),
          depth: depthRange(l, s.books, id),
        ));
  }

  /// 편집 결과 확정(실패면 까닭을 조작부에, 성공 알림은 note)
  Future<bool> _apply(EditResult r, [String? note]) async {
    if (!r.ok) {
      setState(() => _editMsg = r.reason == 'no-change' ? null : editFailText[r.reason] ?? editFailText['outside']);
      return false;
    }
    final ok = await PlacementStore.instance.commit(r.layout!);
    if (!mounted) return ok;
    setState(() => _editMsg = ok ? note : editFailText['no-space']);
    _computePanel();
    return ok;
  }

  /// 고른 책에 편집 한 번(배치·책이 있을 때만)
  void _edit(EditResult Function(ShelfLayout l, BookMap books, String id) op) {
    final s = PlacementStore.instance, l = s.layout, id = _editId;
    if (l == null || id == null) return;
    _apply(op(l, s.books, id));
  }

  void _editPose(Pose pose) {
    if (_panel?.pose != pose) _edit((l, b, id) => setPose(l, b, id, pose));
  }

  void _editLean(int d) {
    if (_panel?.lean != d) _edit((l, b, id) => setTilt(l, b, id, tiltToward(d)));
  }

  void _editSpin(double deg) => _edit((l, b, id) {
        if (placementOf(l, id)?.pose != Pose.front) return setSpin(l, b, id, deg);
        final fs = frontStateOf(l, b, id);
        final r = fs == null ? null : frontSpin(l, b, id, fs.state, fs.qx, deg);
        return r == null ? const EditResult.fail('no-space') : EditResult.ok(r.layout);
      });

  void _editDepth(double z) => _edit((l, b, id) => setDepth(l, b, id, z));

  // ---------- 끌어 옮기기(지금 앱 HomeScreen beginDrag·endDrag, useShelfDragPreview) ----------
  /// 잡은 책: 잡은 곳(콘텐츠 좌표)·잡은 항목 가운데와 폭(설계 단위)·윤곽·끄는 책을 뺀 배치(끌기 한 번에 한 번만 계산)
  ({String id, String shelfId, Offset start, double centerDU, double widthDU, ui.Path path, ShelfLayout detached})? _drag;
  Offset _dragNow = Offset.zero;
  bool _dragOk = true;

  void _beginDrag(Offset at) {
    final id = _hitBook(at);
    final path = _outlineOf(id);
    final s = PlacementStore.instance, l = s.layout;
    final p = l == null || id == null ? null : placementOf(l, id);
    if (l == null || p == null || path == null) return;
    // 잡은 항목(더미의 받침이면 더미 전체)의 곧은 3D 상자: 가운데와 폭
    final item = shelfItems(l, p.shelfId).where((it) => it.bookIds.contains(id)).firstOrNull;
    final bx = boxOf(l, s.books, id!);
    var lo = double.infinity, hi = double.negativeInfinity;
    for (final c in bx == null ? const <Vec3>[] : corners(fromPlaced(bx))) {
      lo = math.min(lo, c.x);
      hi = math.max(hi, c.x);
    }
    setState(() {
      _decorating = true;
      _editId = id;
      _editMsg = null;
      _frozen = true; // 끄는 책은 굳힌 책장 그림에서 떠 온다
      _dragNow = at;
      _dragOk = true;
      _drag = (
        id: id,
        shelfId: p.shelfId,
        start: at,
        centerDU: (lo + hi) / 2,
        widthDU: item != null ? itemWidth(item, l, s.books) : hi - lo,
        path: path,
        detached: detach(l, id, s.books),
      );
    });
    tabBarHidden.value = true;
    _computePanel();
    _dragTarget = null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_drag?.id == id) _showPreview(l, {p.shelfId}, hide: id, key: 'lifted');
    });
  }

  /// 손가락 자리의 놓을 자리(늘 확정 배치에서 계산: 같은 줄이면 바꿔 놓기, 다른 줄이면 끄는 책을 뺀 배치에서 놓을 자리).
  /// key가 같으면 놓은 배치도 같다(손가락이 움직여도 자리가 그대로면 다시 계산하지 않는다)
  ({String key, String? shelfId, EditResult Function() run}) _targetAt(Offset at) {
    final d = _drag, g = _geom, s = PlacementStore.instance, l = s.layout;
    if (d == null || g == null || l == null) return (key: 'none', shelfId: null, run: () => const EditResult.fail('no-change'));
    final shelves = sortedShelves(l);
    final cy = at.dy - g.contentTop;
    final index = g.geo.isEmpty || cy < g.geo.first.top ? -1 : g.geo.indexWhere((r) => cy >= r.top && cy < r.top + r.height);
    final centerDU = d.centerDU + (at.dx - d.start.dx) / g.m.scale;
    final withinX = centerDU > -sideMargin && centerDU < shelfUsableWidth + sideMargin;
    if (!withinX || index < 0 || index >= shelves.length) return (key: 'outside', shelfId: null, run: () => const EditResult.fail('outside'));
    final shelfId = shelves[index].id;
    if (shelfId == d.shelfId) {
      final t = findSwapTarget(l, s.books, d.id, centerDU);
      return (key: 'same:${t.kind}:${t.itemKey}:${t.index}:${t.x}:${t.dx}', shelfId: shelfId, run: () => applySwapTarget(l, s.books, d.id, t));
    }
    final t = findDropTarget(d.detached, s.books, shelfId, centerDU, placementOf(l, d.id)!.pose, d.widthDU);
    return (key: 'other:$shelfId:${t.kind}:${t.itemKey}:${t.index}:${t.x}', shelfId: shelfId, run: () => moveBook(l, s.books, d.id, t));
  }

  /// 마지막으로 본 놓을 자리와 그 결과
  ({String key, EditResult result})? _dragTarget;

  EditResult _dropAt(Offset at) {
    final t = _targetAt(at);
    final last = _dragTarget;
    if (last != null && last.key == t.key) return last.result;
    final r = t.run();
    _dragTarget = (key: t.key, result: r);
    // 미리 보기: 놓을 수 있으면 그 배치(기대기까지 그 줄에서 풀어 둔다: 놓는 순간 각도가 튀지 않게), 아니면 확정 배치에서 든 책만 빠진다
    final d = _drag!, l = PlacementStore.instance.layout!, books = PlacementStore.instance.books;
    if (r.ok && t.shelfId != null) {
      final src = t.shelfId == d.shelfId ? r.layout! : resolveLeans(r.layout!, books, d.shelfId);
      _showPreview(resolveLeans(src, books, t.shelfId), {d.shelfId, t.shelfId!}, hide: d.id, key: t.key);
    } else {
      _showPreview(l, {d.shelfId}, hide: d.id, key: 'lifted');
    }
    return r;
  }

  // 가장자리 자동 스크롤(지금 앱 autoScroll: 끄는 동안만, 화면 위아래 72 안이면 한 틀에 최대 14씩). 스크롤하면서도 손가락 자리로 놓을 자리를 다시 본다
  final _viewportKey = GlobalKey();
  Offset? _dragGlobal;
  Timer? _autoScroll;

  void _autoScrollTick() {
    final g = _dragGlobal, box = _viewportKey.currentContext?.findRenderObject() as RenderBox?;
    if (_drag == null || g == null || box == null || !_scroll.hasClients) return;
    const edge = 72.0, speed = 14.0;
    final y = box.globalToLocal(g).dy, h = box.size.height;
    final delta = y < edge ? -speed * math.min(1, (edge - y) / edge) : y > h - edge ? speed * math.min(1, (y - (h - edge)) / edge) : 0.0;
    if (delta == 0) return;
    final p = _scroll.position;
    final next = (p.pixels + delta).clamp(0.0, p.maxScrollExtent);
    if (next == p.pixels) return;
    _scroll.jumpTo(next);
    final local = box.globalToLocal(g);
    _moveDrag(Offset(local.dx, local.dy + next));
  }

  void _stopAutoScroll() {
    _autoScroll?.cancel();
    _autoScroll = null;
    _dragGlobal = null;
  }

  void _moveDrag(Offset at) {
    if (_drag == null) return;
    final r = _dropAt(at);
    setState(() {
      _dragNow = at;
      _dragOk = r.ok || r.reason == 'no-change';
    });
  }

  Future<void> _endDrag() async {
    _stopAutoScroll();
    if (_drag == null) return;
    final r = _dropAt(_dragNow);
    setState(() => _drag = null);
    _dragTarget = null;
    // 성공은 알리지 않는다(바뀐 책장이 보이고, 바로 위에 되돌리기). 놓았으면 새로 굽기가 끝날 때까지 미리 보기를 그대로 둔다(옛 자리로 튀지 않게)
    if (!await _apply(r)) _clearPreview();
  }

  // ---------- 미리 보기(끄는 동안 바뀐 선반만 그 배치로 그린다, 지금 앱 previewShelf) ----------
  /// 선반 차례 → 미리 보는 줄. 바로는 지난 그림의 빛(면 이름으로 자리를 옮겨 쓴다)으로, 잠시 뒤 그 배치로 구운 그림으로
  Map<int, _PreviewRow> _previewRows = const {};
  String? _previewKey;
  Timer? _previewBake;

  /// 그릴 줄 목록(미리 보는 줄을 끼운 것). 미리 보기가 바뀔 때만 새로 만든다(손가락이 움직일 때마다 책장을 다시 그리지 않게)
  ({List<RowCase> rows, List<ui.Image> atlases, List<List<Spot>> spots, List<({PlaneKey wall, PlaneKey floor})> keys, List<Map<String, BookKey>> bookKeys})? _shown;

  void _showPreview(ShelfLayout l, Set<String> shelfIds, {String? hide, required String key}) {
    final c = _case, s = PlacementStore.instance, committed = s.layout;
    if (c == null || committed == null || key == _previewKey) return;
    final shelves = sortedShelves(committed);
    final next = <int, _PreviewRow>{};
    for (final id in shelfIds) {
      final i = shelves.indexWhere((x) => x.id == id);
      if (i < 0 || i >= _rowSpots.length) continue;
      final bodies = [for (final f in computeShelf(l, s.books, id)) if (f.bookId != hide) fromPlaced(f.box)];
      final old = c.rows[i], oldSpots = _rowSpots[i];
      final row = rowFromBooks(bodies, _libBooks, rowSpace, top: old.top, last: old.last)..tabLoss = old.tabLoss;
      final spots = [
        for (final it in row.items)
          switch (old.indexOf(it.key)) { final k when k >= 0 && k < oldSpots.length => oldSpots[k], _ => oldSpots.first },
      ];
      next[i] = _PreviewRow(row, spots);
    }
    _previewKey = key;
    _setPreviewRows(next);
    _previewBake?.cancel();
    _previewBake = Timer(const Duration(milliseconds: 150), () => _bakePreview(key));
  }

  Future<void> _bakePreview(String key) async {
    final grid = _gridSlots, bake = _bakeSlots;
    if (grid == null || bake == null) return;
    for (final e in Map.of(_previewRows).entries) {
      if (e.value.atlas != null) continue;
      // 차례를 기다리는 동안 손가락이 다른 자리로 가면 굽지 않는다
      final b = await bakeRow(grid, bake, BakeCase([e.value.row]), e.value.row, persist: false, tag: ' preview', wanted: () => mounted && _previewKey == key);
      if (b == null) return;
      if (!mounted || _previewKey != key) {
        b.image.dispose();
        return;
      }
      _setPreviewRows({..._previewRows, e.key: _PreviewRow(e.value.row, b.at, b.image, b.keys, b.bookKeys)});
    }
  }

  void _setPreviewRows(Map<int, _PreviewRow> next) {
    for (final e in _previewRows.entries) {
      if (!identical(next[e.key]?.atlas, e.value.atlas)) e.value.atlas?.dispose();
    }
    final c = _case;
    setState(() {
      _previewRows = next;
      _shown = next.isEmpty || c == null
          ? null
          : (
              rows: [for (var i = 0; i < c.rows.length; i++) next[i]?.row ?? c.rows[i]],
              atlases: [for (var i = 0; i < _atlases.length; i++) next[i]?.atlas ?? _atlases[i]],
              spots: [for (var i = 0; i < _rowSpots.length; i++) next[i]?.spots ?? _rowSpots[i]],
              keys: [for (var i = 0; i < _keys.length; i++) next[i]?.keys ?? _keys[i]],
              bookKeys: [for (var i = 0; i < _bookKeys.length; i++) next[i]?.bookKeys ?? _bookKeys[i]],
            );
    });
  }

  void _clearPreview() {
    _previewBake?.cancel();
    _previewKey = null;
    if (_previewRows.isNotEmpty) _setPreviewRows(const {});
  }

  // ---------- 표지 책 머리 손잡이(지금 앱 HeadHandle·onHandle): 위아래로 끌면 뒤로 젖히기, 좌우로 끌면 돌리기 ----------
  static const _tiltPerDu = 0.35; // 머리를 1DU 밀면 0.35° 젖힘(20°에 약 57DU)
  static const _spinPerDu = 0.9; // 좌우 1DU에 0.9°
  static const _handleHit = 48.0;
  static const _handleLiftDu = 7.0; // 머리보다 이만큼 위(3D 세로)에 손잡이

  ({String id, String shelfId, double qx, FrontState start})? _head;
  FrontState? _headCur;
  ShelfLayout? _headLast;
  bool? _headTilt; // 끄는 방향(조금 움직인 뒤 한 번 정한다): true 젖히기, false 돌리기
  ({double d, double a}) _headBase = (d: 0, a: 0);
  Offset _headDrag = Offset.zero, _headOff = Offset.zero;
  bool _headStepQueued = false;

  /// 손잡이 자리(콘텐츠 좌표): 고른 표지 책 머리 앞 가운데 바로 위
  Offset? _handlePoint() {
    final id = _editId, g = _geom, c = _case, l = PlacementStore.instance.layout;
    if (!_decorating || _drag != null || id == null || g == null || c == null || l == null || placementOf(l, id)?.pose != Pose.front) return null;
    final cam = Cam(viewPitchMin);
    for (var i = 0; i < g.lockedFrom && i < g.geo.length && i < c.rows.length; i++) {
      for (final b in c.rows[i].books) {
        if (b.id != id) continue;
        final head = toWorld(b, Vec3(b.dims.t, b.dims.h, b.dims.w / 2));
        return toPx(cam, Affine(g.m.scale, g.m.originX + sideMargin * g.m.scale, g.contentTop + g.geo[i].baseline), Vec3(head.x, head.y + _handleLiftDu, head.z));
      }
    }
    return null;
  }

  int? _headPointer;

  bool _headBegin() {
    final s = PlacementStore.instance, l = s.layout, id = _editId;
    final f = l == null || id == null ? null : frontStateOf(l, s.books, id);
    final shelfId = l == null || id == null ? null : placementOf(l, id)?.shelfId;
    if (f == null || shelfId == null) return false;
    setState(() {
      _head = (id: id!, shelfId: shelfId, qx: f.qx, start: f.state);
      _headCur = f.state;
      _headLast = null;
      _headTilt = null;
      _headDrag = Offset.zero;
      _headOff = Offset.zero;
      _editMsg = null;
    });
    return true;
  }

  void _headMove(Offset d) {
    _headDrag += d;
    if (_headStepQueued) return;
    _headStepQueued = true;
    SchedulerBinding.instance.scheduleFrameCallback((_) => _headStep());
  }

  /// 끈 거리 → 원하는 각도 → 실제로 되는 각도(옆 책·벽에 막히면 거기까지). 그 줄은 미리 보기로 바로 그린다
  void _headStep() {
    _headStepQueued = false;
    final h = _head, g = _geom, s = PlacementStore.instance, l = s.layout, cur = _headCur;
    if (h == null || g == null || l == null || cur == null) return;
    if (_headTilt == null) {
      if (_headDrag.distance < 4) return;
      _headTilt = _headDrag.dy.abs() >= _headDrag.dx.abs();
      _headBase = (d: 0, a: _headTilt! ? h.start.pitch : h.start.spin);
    }
    final tilt = _headTilt!;
    final gain = tilt ? _tiltPerDu : _spinPerDu;
    final d = (tilt ? -_headDrag.dy : _headDrag.dx) / g.m.scale; // 잡은 지점에서 축 방향으로 끈 거리(DU, 위·오른쪽이 +)
    final want = _headBase.a + (d - _headBase.d) * gain;
    final r = tilt ? frontTilt(l, s.books, h.id, cur, h.qx, want) : frontSpin(l, s.books, h.id, cur, h.qx, want);
    if (r == null) return;
    final got = tilt ? r.state.pitch : r.state.spin;
    // 돌리기는 0 근처에서 살짝 붙는다(frontSpin): 그만큼은 막힌 것이 아니다
    final aim = !tilt && want.abs() < 0.8 ? 0.0 : want;
    if ((got - aim).abs() > 0.05) _headBase = (d: d, a: got);
    _headCur = r.state;
    _headLast = r.layout;
    _showPreview(r.layout, {h.shelfId}, key: 'head:${r.state.pitch}:${r.state.spin}:${r.state.depth}');
    final off = (got - (tilt ? h.start.pitch : h.start.spin)) / gain * g.m.scale;
    setState(() => _headOff = tilt ? Offset(0, -off) : Offset(off, 0));
  }

  /// 놓으면: 받침을 잃은 표지 책은 무게중심에 따라 넘어져 벽·책·바닥에서 멈춘 자세로 저장한다(끄는 동안 마지막 배치에서)
  Future<void> _headEnd() async {
    if (_headStepQueued) _headStep();
    final h = _head, last = _headLast, cur = _headCur, s = PlacementStore.instance;
    setState(() {
      _head = null;
      _headOff = Offset.zero;
    });
    if (h == null || last == null || cur == null) {
      _clearPreview();
      return;
    }
    final fin = frontRelease(last, s.books, h.id, cur, h.qx);
    if (!await _apply(fin != null ? EditResult.ok(fin) : const EditResult.fail('no-space'))) _clearPreview();
  }

  void _headCancel() {
    setState(() {
      _head = null;
      _headOff = Offset.zero;
    });
    _clearPreview();
  }

  /// 표지 책 뒤로 젖힌 각도 글자(조작부)
  String? get _anglesText {
    final s = PlacementStore.instance, l = s.layout, id = _editId;
    final pitch = _head != null ? _headCur?.pitch : (l == null || id == null ? null : frontStateOf(l, s.books, id)?.state.pitch);
    return pitch != null && pitch >= 0.5 ? '머리를 끌어 뒤로 ${jsRound(pitch).toInt()}° 젖혔어요' : null;
  }

  Future<void> _undo() async {
    await PlacementStore.instance.undo();
    if (!mounted) return;
    setState(() => _editMsg = null);
    _computePanel();
  }

  /// 책장 그림(입력이 같으면 다시 쓰고, 바뀌면 다시 그린다)
  ui.Image? _shelfImage;
  Object? _shelfKey;
  bool _frozen = false;
  Timer? _freezeTimer;

  /// 시작 사진(files/home_snapshot.png): 굳힌 책장 그림을 저장해 두고 다음에 켤 때 먼저 보인다
  ui.Image? _snap;
  static Future<File> _snapFile() => homeSnapshotFile();

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
    // 미리 보는 동안은 그대로 그린다(굳힌 그림은 끄는 책을 떠 오는 데 쓰고, 미리 보기가 끝나면 다시 굳힌다)
    if (_shown != null || !_frozen || !ShelfPainter.ready || h > 8192 || w > 8192) return CustomPaint(painter: painter);
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

  /// 지금 책장의 책 정보(줄을 다시 만들 때)
  List<Book> _libBooks = const [];

  /// 지난 굽기의 줄별 결과(굽기 열쇠 → 그림·그림자 열쇠·갈피 손실). 다음 굽기에서 바뀌지 않은 줄은 그대로 쓴다
  Map<String, _RowDone> _rowDone = {};

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
    focusBookOnShelf.addListener(_focusBook);
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
    _rebuild = true;
    _run();
  }

  /// 다음 굽기에서 줄을 서재로부터 새로 만든다(그동안 화면은 지난 줄·그림 그대로: 둘은 굽기가 끝날 때 함께 바꾼다)
  bool _rebuild = false;

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
    PlacementStore.instance.adopt(lib);
    _loadCovers([for (final b in lib.books) ?b.coverArtUri]);
    final shelves = placeShelves(lib);
    // 마지막 선반 아래 잠긴 칸(다섯 칸까지): 흐린 예시 책
    final locked = [for (var i = 0; i < lockedShelfCount(shelves.length); i++) await lockedRow(i)];
    final lockedCount = locked.length;
    final rebuild = _rebuild;
    _rebuild = false;
    final c = _case != null && !rebuild ? _case! : BakeCase([
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
    final bookKeys = <Map<String, BookKey>>[];
    final done = <String, _RowDone>{};
    for (var ri = 0; ri < c.rows.length; ri++) {
      final r = c.rows[ri];
      final probe = ri == c.rows.length - 1; // 맨 뒤는 값 확인용(시간에 넣지 않는다)
      final key = bakeKey(r);
      // 지난번과 같은 줄(책을 옮긴 줄 말고는 다 그렇다): 구운 그림·그림자 열쇠·갈피 손실을 그대로 쓴다(다시 읽거나 굽지 않는다)
      final kept = probe ? null : _rowDone[key] ?? done[key];
      if (kept != null) {
        r.tabLoss = kept.tabLoss;
        done[key] = kept;
        images.add(kept.image.clone());
        spots.add(kept.at);
        spaces.add(r.space);
        keys.add(kept.keys);
        bookKeys.add(kept.bookKeys);
        rows.add(RowRun(r.items.length, kept.image.width, kept.image.height, 0, 0));
        continue;
      }
      // 같은 값으로 구워 담아 둔 그림이 있으면 굽지 않는다(row_bake)
      final b = (await bakeRow(gridSlots, bakeSlots, c, r, probe: probe, stamp: true))!;
      images.add(b.image);
      if (probe) continue;
      final row = _RowDone(b.image.clone(), b.at, b.keys, b.bookKeys, r.tabLoss);
      done[key] = row;
      spots.add(b.at);
      spaces.add(r.space);
      keys.add(b.keys);
      bookKeys.add(b.bookKeys);
      rows.add(RowRun(r.items.length, b.image.width, b.image.height, b.gridMs, b.bakeMs));
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
      _case = c;
      _lockedCount = lockedCount;
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
      for (final e in _rowDone.entries) {
        if (!identical(done[e.key], e.value)) e.value.image.dispose();
      }
      _rowDone = done;
      _runs.add(run);
      _libBooks = lib.books;
      _state = '${_runs.length}번째';
      _busy = false;
    });
    // 새 그림이 나왔으니 미리 보기는 걷는다(미리 보는 줄은 지난 그림의 자리를 쓰고 있었다). 끄는 중이면 다음 손가락 움직임에 다시 만든다
    _dragTarget = null;
    _clearPreview();
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
          final ok = await PlacementStore.instance.addShelf();
          if (!mounted) return;
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(ok ? '선반을 열었어요.' : '지금은 바꿀 수 없어요.'), duration: const Duration(seconds: 2)));
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

  @override
  void dispose() {
    _scroll.dispose();
    _shelfImage?.dispose();
    _snap?.dispose();
    _freezeTimer?.cancel();
    _autoScroll?.cancel();
    shelfRefresh.removeListener(_refresh);
    focusBookOnShelf.removeListener(_focusBook);
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
        onDecorate: () => _enterDecorate(),
        icons: !_decorating,
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
                    // 꾸미는 동안은 아래 조작부(약 280) 뒤에 숨는 줄도 위로 밀어 볼 수 있게 끝 여백을 늘린다
                    final height = math.max(box.maxHeight, last == null ? 0.0 : contentTop + last.top + last.height + tail + (_decorating ? 280 : 0));
                    final lockedFrom = n - _lockedCount;
                    _geom = (m: m, geo: geo, contentTop: contentTop, lockedFrom: lockedFrom);
                    return NotificationListener<ScrollStartNotification>(
                      onNotification: (_) {
                        if (!_frozen) setState(() => _frozen = true);
                        return false;
                      },
                      child: SingleChildScrollView(
                        key: _viewportKey,
                        controller: _scroll,
                        physics: _head != null ? const NeverScrollableScrollPhysics() : null,
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
                                      rows: _shown?.rows ?? _case!.rows,
                                      atlases: _shown?.atlases ?? _atlases,
                                      rowSpots: _shown?.spots ?? _rowSpots,
                                      spaces: _spaces,
                                      photos: _photos,
                                      bookKeys: _shown?.bookKeys ?? _bookKeys,
                                      keys: _shown?.keys ?? _keys,
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
                              // 고른 책 윤곽 빛(지금 앱 SelectGlow): 바깥으로 흰 얇은 선과 좁은 그림자 번짐, 책 면은 덮지 않고 바닥 면 아래로 새지 않는다
                              // 겹쳐 그리는 것은 있다 없다 하므로 키를 단다(없으면 아래 누르기 층이 새로 만들어져 끌던 손가락이 끊긴다)
                              if (_drag == null ? _outlineOf(_decorating ? _editId : _popId) : null case final path?)
                                Positioned.fill(key: const ValueKey('glow'), child: IgnorePointer(child: CustomPaint(painter: _GlowPainter(path, _geom!.m.scale)))),
                              // 끄는 책: 잡은 책 윤곽이 손가락을 따라간다(놓을 수 없는 자리면 붉게)
                              if (_drag case final d?)
                                Positioned.fill(
                                  key: const ValueKey('drag'),
                                  child: IgnorePointer(
                                    child: CustomPaint(painter: _DragPainter(d.path, _dragNow - d.start, _geom!.m.scale, _dragOk, _shelfImage, MediaQuery.devicePixelRatioOf(context))),
                                  ),
                                ),
                              // 누르기: 책 정보 시트(꾸미는 중이면 고르기), 꾹 누르기: 꾸미기
                              Positioned.fill(
                                key: const ValueKey('touch'),
                                child: RawGestureDetector(
                                  behavior: HitTestBehavior.translucent,
                                  gestures: {
                                    TapGestureRecognizer: GestureRecognizerFactoryWithHandlers<TapGestureRecognizer>(
                                      TapGestureRecognizer.new,
                                      (g) => g.onTapUp = (e) => _onTap(e.localPosition),
                                    ),
                                    // 꾹 눌러(지금 앱 motion.longPress 350ms) 책을 집으면 꾸미기가 시작되고 손가락을 따라 옮긴다(놓으면 그 자리로)
                                    LongPressGestureRecognizer: GestureRecognizerFactoryWithHandlers<LongPressGestureRecognizer>(
                                      () => LongPressGestureRecognizer(duration: const Duration(milliseconds: 350)),
                                      (g) => g
                                        ..onLongPressStart = ((e) {
                                          _beginDrag(e.localPosition);
                                          _dragGlobal = e.globalPosition;
                                          _autoScroll ??= Timer.periodic(const Duration(milliseconds: 16), (_) => _autoScrollTick());
                                        })
                                        ..onLongPressMoveUpdate = ((e) {
                                          _dragGlobal = e.globalPosition;
                                          _moveDrag(e.localPosition);
                                        })
                                        ..onLongPressEnd = ((_) => _endDrag())
                                        ..onLongPressCancel = (() {
                                          _stopAutoScroll();
                                          setState(() => _drag = null);
                                          _dragTarget = null;
                                          _clearPreview();
                                        }),
                                    ),
                                  },
                                ),
                              ),
                              // 표지 책 머리 손잡이: 보이는 점은 작게, 잡는 칸은 넓게. 끄는 동안 손가락을 따라 실제로 된 각도만큼 옮겨 가고, 제자리와 가는 선으로 잇는다
                              if (_handlePoint() case final hp?) ...[
                                if (_headOff.distance >= 2)
                                  Positioned.fill(key: const ValueKey('tether'), child: IgnorePointer(child: CustomPaint(painter: _TetherPainter(hp, hp + _headOff)))),
                                Positioned(
                                  key: const ValueKey('handle'),
                                  left: hp.dx + _headOff.dx - _handleHit / 2,
                                  top: hp.dy + _headOff.dy - _handleHit / 2,
                                  width: _handleHit,
                                  height: _handleHit,
                                  child: Semantics(
                                    label: '머리 손잡이: 위아래로 끌면 뒤로 젖히기, 좌우로 끌면 돌리기',
                                    // 닿는 순간 잡는다(지금 앱 manualActivation): 손가락 이벤트를 바로 받고, 잡는 동안은 스크롤을 끈다(스크롤 끌기가 손잡이를 가로채지 않게)
                                    child: Listener(
                                      behavior: HitTestBehavior.opaque,
                                      onPointerDown: (e) {
                                        if (_headPointer == null && _headBegin()) _headPointer = e.pointer;
                                      },
                                      onPointerMove: (e) {
                                        if (e.pointer == _headPointer) _headMove(e.delta);
                                      },
                                      onPointerUp: (e) {
                                        if (e.pointer != _headPointer) return;
                                        _headPointer = null;
                                        _headEnd();
                                      },
                                      onPointerCancel: (e) {
                                        if (e.pointer != _headPointer) return;
                                        _headPointer = null;
                                        _headCancel();
                                      },
                                      child: Center(child: _Knob(scale: _geom!.m.scale)),
                                    ),
                                  ),
                                ),
                              ],
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
          if (_decorating)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: DecoratePanel(
                bookKey: _editId,
                title: _panel?.title,
                pose: _panel?.pose,
                lean: _panel?.lean ?? 0,
                canLean: _panel?.canLean ?? (left: false, right: false),
                msg: _editMsg,
                angles: _anglesText,
                spin: _panel?.spin ?? 0,
                spinMax: _panel?.spinMax ?? maxSpin,
                spinRange: _panel?.spinRange,
                depth: _panel?.depth,
                canUndo: PlacementStore.instance.canUndo,
                onPose: _editPose,
                onLean: _editLean,
                onSpin: _editSpin,
                onDepth: _editDepth,
                onUndo: _undo,
                onDone: _exitDecorate,
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

class _GlowPainter extends CustomPainter {
  _GlowPainter(this.path, this.scale);
  final ui.Path path;
  final double scale;

  @override
  void paint(Canvas canvas, Size size) {
    final b = path.getBounds();
    canvas.save();
    // 책 면은 덮지 않는다(선의 바깥 절반만), 받치는 면 아래로는 새지 않는다
    canvas.clipPath(ui.Path.combine(ui.PathOperation.difference, ui.Path()..addRect(Rect.fromLTRB(-4000, b.bottom - 4000, 8000, b.bottom)), path));
    canvas.drawPath(path, Paint()
      ..color = const Color(0x521F2533) // rgba(31,37,51,0.32)
      ..maskFilter = MaskFilter.blur(BlurStyle.outer, 3.2 * scale));
    canvas.drawPath(path, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3 * scale
      ..strokeJoin = StrokeJoin.round
      ..color = const Color(0xFFFFFFFF));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_GlowPainter old) => old.path != path || old.scale != scale;
}

/// 끄는 책: 굳힌 책장 그림(든 순간의 모습)에서 그 책 모양만 떠서 손가락을 따라 옮긴다(아래 그늘, 둘레 흰 선). 제자리는 그 줄에서 책을 빼고 다시 그린다.
/// 놓을 수 없는 자리면 붉게 덮는다. 굳힌 그림이 없으면 흰 윤곽만
class _DragPainter extends CustomPainter {
  _DragPainter(this.path, this.delta, this.scale, this.ok, this.image, this.dpr);
  final ui.Path path;
  final Offset delta;
  final double scale;
  final bool ok;
  final ui.Image? image;
  final double dpr;

  @override
  void paint(Canvas canvas, Size size) {
    final moved = path.shift(delta);
    canvas.drawPath(moved.shift(Offset(0, 4 * scale)), Paint()
      ..color = const Color(0x521F2533)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, 6 * scale));
    final img = image;
    canvas.save();
    canvas.clipPath(moved);
    if (img != null) {
      canvas.translate(delta.dx, delta.dy);
      canvas.scale(1 / dpr);
      canvas.drawImage(img, Offset.zero, Paint()..filterQuality = FilterQuality.low);
    } else {
      canvas.drawPath(moved, Paint()..color = const Color(0x66FFFFFF));
    }
    canvas.restore();
    if (!ok) canvas.drawPath(moved, Paint()..color = const Color(0x40D9534F));
    canvas.drawPath(moved, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3 * scale
      ..strokeJoin = StrokeJoin.round
      ..color = const Color(0xFFFFFFFF));
  }

  @override
  bool shouldRepaint(_DragPainter old) => old.delta != delta || old.ok != ok || old.image != image || old.path != path;
}

/// 손잡이 점(지금 앱 knob: 옅은 종이색 원, 나무색 테두리·가운데 점, 옅은 그림자)
class _Knob extends StatelessWidget {
  const _Knob({required this.scale});
  final double scale;

  @override
  Widget build(BuildContext context) => Container(
        width: 16 * scale,
        height: 16 * scale,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: const Color(0xF2FFFCF6),
          border: Border.all(color: const Color(0x8CA07858)),
          boxShadow: const [BoxShadow(color: Color(0x2E3B3330), blurRadius: 3, offset: Offset(0, 1))],
        ),
        child: Center(
          child: Container(width: 5 * scale, height: 5 * scale, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xCCA06E46))),
        ),
      );
}

/// 머리 위 제자리와 손잡이를 잇는 가는 선(무엇을 젖히거나 돌리는지 보이게)
class _TetherPainter extends CustomPainter {
  _TetherPainter(this.from, this.to);
  final Offset from, to;

  @override
  void paint(Canvas canvas, Size size) => canvas.drawLine(from, to, Paint()
    ..strokeWidth = 1.5
    ..strokeCap = StrokeCap.round
    ..color = const Color(0x8CA07858));

  @override
  bool shouldRepaint(_TetherPainter old) => old.from != from || old.to != to;
}

class _PreviewRow {
  _PreviewRow(this.row, this.spots, [this.atlas, this.keys, this.bookKeys]);
  final RowCase row;
  final List<Spot> spots;

  /// 그 배치로 구운 그림(없으면 지난 그림을 쓴다). 이 미리 보기 것: 걷을 때 버린다
  final ui.Image? atlas;
  final ({PlaneKey wall, PlaneKey floor})? keys;
  final Map<String, BookKey>? bookKeys;
}

class _RowDone {
  _RowDone(this.image, this.at, this.keys, this.bookKeys, this.tabLoss);
  final ui.Image image;
  final List<Spot> at;
  final ({PlaneKey wall, PlaneKey floor}) keys;
  final Map<String, BookKey> bookKeys;
  final Map<String, C3> tabLoss;
}

/// 책장에서 이 책을 보여 달라(책 정보 '책장 위치로 이동', 지금 앱 uiBus.focusBook): 홈이 그 줄로 넘기고 잠깐 윤곽을 빛낸다
final focusBookOnShelf = ValueNotifier<String?>(null);

/// 시작 사진 파일(굳힌 책장 그림, 다음에 켤 때 먼저 보인다)
Future<File> homeSnapshotFile() async => File('${(await imageDir()).parent.path}/home_snapshot.png');

/// 시작 사진을 버린다(스킨처럼 책장 모습이 바뀌었을 때: 다음에 켤 때 옛 모습이 먼저 뜨지 않게)
Future<void> dropHomeSnapshot() async {
  try {
    final f = await homeSnapshotFile();
    if (f.existsSync()) f.deleteSync();
  } catch (_) {
    // 못 지워도 다음 굳히기 때 덮어쓴다
  }
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
  const _Header({required this.year, required this.status, this.onLongPress, this.onDecorate, this.icons = true});
  final int year;
  final String status;
  final VoidCallback? onLongPress;
  final VoidCallback? onDecorate;

  /// 꾸미는 동안은 오른쪽 아이콘을 숨긴다(지금 앱 editing ? null)
  final bool icons;

  @override
  Widget build(BuildContext context) {
    Widget icon(String name, String label) => Semantics(
      button: true,
      label: label,
      child: _Pressable(
        onTap: name == 'decorate' && onDecorate != null
            ? onDecorate!
            : name == 'books'
                ? () => openAllBooks(context)
                : name == 'store'
                    ? () => openStore(context)
                    : name == 'add'
                        ? () => openAddBook(context)
                        : () => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text('$label: 아직 옮기는 중이에요'), duration: const Duration(seconds: 1))),
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
            child: icons ? Row(children: [icon('store', '스토어'), icon('decorate', '꾸미기'), icon('books', '전체 책'), icon('add', '책 더하기')]) : const SizedBox(height: 44),
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
