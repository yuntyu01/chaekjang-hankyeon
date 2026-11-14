// 갈피 보드(지금 앱 app/bookmark/board/[book].tsx, 2026-11-02 사용자 시안): 책 한 권의 갈피를 화면보다 넓은 보드에 흩어 붙인다. 확대는 읽기, 축소는 배치 확인.
// 빈 곳을 끌면 보드 이동, 두 손가락으로 확대·축소, 갈피를 꾹 눌러 끌면 옮겨 붙이기(다른 갈피 위에도, 화면 끝에 닿으면 보드가 넓어진다), 떼면 손잡이로 폭 바꾸기,
// 한 번 누르면 크게 읽기. '전체 보기'는 모든 갈피가 보이게, '+ 갈피'는 보던 곳의 빈 자리에. 새 갈피는 자동으로 놓이고(domain/bookmark_board)
// 옮긴 자리는 갈피 기록에 저장돼 다른 기기로 간다. 마지막 위치·배율은 기기마다 기억한다.
// 가로로 끌면 옆 책의 보드로 넘어간다(2026-11-05 사용자). 보드가 화면보다 넓으면 보드 끝까지 움직인 뒤 넘어간다. 두 손가락은 언제나 보드만 움직인다.
// 손가락 판정은 포인터를 직접 읽어 한곳에서 한다(지금 앱의 보드 끌기·두 손가락·카드 꾹 끌기·손잡이 네 몸짓이 서로 겨루지 않게)
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';

import '../../app/app_nav.dart';
import '../../db/kv_store.dart';
import '../../domain/bookmark_board.dart';
import '../../domain/color.dart' show tabColors;
import '../../domain/library.dart';
import '../../store/library_model.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../stats/stats_widgets.dart' show LinkedCover;
import 'board_card.dart';
import 'bookmark_card.dart' show hexColor;
import 'bookmark_detail_screen.dart' show PageDots, openBookmark;
import 'new_bookmark_screen.dart' show openNewBookmark;

const _reach = 2600.0; // 옮겨 붙일 수 있는 범위
const _liftScale = 1.04;
const _handle = 44.0;
// 카드를 끌다 화면 끝에 닿으면 보드가 넓어진다: 끝에서 이만큼 안쪽, 1초에 이 배율로. 글이 보일 만큼까지만(더 줄이려면 두 손가락)
const _edge = 44.0;
const _edgeZoom = 0.85;
const _edgeMinScale = 0.45;
// 책 넘기기: 이만큼 끌거나 이 속도로 튕기면 다음 책으로
const _turnAt = 0.22;
const _fling = 700.0;
const _turnMs = 240;
const _hold = Duration(milliseconds: 280);
const _slop = 6.0;
const _tapSlop = 8.0;

Future<void> openBookmarkBoard(BuildContext context, String bookId) => Navigator.of(context, rootNavigator: true)
    .push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/bookmark/board'), builder: (_) => BookmarkBoardScreen(first: bookId)));

/// 그 책의 갈피 색(보드 점·고른 테두리·테이프)
String? _ribbon(Library lib, String id) => ribbonOf(lib, id);

class BookmarkBoardScreen extends StatefulWidget {
  const BookmarkBoardScreen({super.key, required this.first});
  final String first;

  @override
  State<BookmarkBoardScreen> createState() => _BoardScreenState();
}

class _BoardScreenState extends State<BookmarkBoardScreen> with SingleTickerProviderStateMixin {
  final _model = LibraryModel.instance;
  // 넘길 책: 연 순간의 순서로 고정한다(새 갈피를 남겼다고 책 순서가 바뀌어 화면이 튀지 않게)
  late final List<String> _order = boardBookIds(_model.lib, widget.first);
  late String _id = widget.first;
  double _drag = 0; // 넘기느라 끈 거리(왼쪽으로 끌면 음수 = 다음 책)
  double _width = 0;
  bool _settling = false, _near = false;
  late final AnimationController _anim = AnimationController(vsync: this);
  Timer? _nearTimer;

  List<String> get _pages => [for (final x in _order) if (_model.lib.books.containsKey(x)) x];
  int get _index => _pages.indexOf(_id);
  bool get canPrev => _index > 0;
  bool get canNext => _index >= 0 && _index < _pages.length - 1;
  bool get settling => _settling;
  double get drag => _drag;
  set drag(double v) {
    if (v != _drag) setState(() => _drag = v);
  }

  bool get _reduce => MediaQuery.of(context).disableAnimations;

  @override
  void initState() {
    super.initState();
    _model.addListener(_changed);
    // 옆 책은 처음 화면을 그린 뒤에 붙인다(여는 순간을 늦추지 않게)
    _nearTimer = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _near = true);
    });
  }

  @override
  void dispose() {
    _model.removeListener(_changed);
    _nearTimer?.cancel();
    _anim.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _animateDrag(double to, int ms, [VoidCallback? done]) {
    _anim.stop();
    final from = _drag;
    if (_reduce || ms == 0) {
      setState(() => _drag = to);
      done?.call();
      return;
    }
    _anim.duration = Duration(milliseconds: ms);
    void tick() => setState(() => _drag = from + (to - from) * Curves.easeOutCubic.transform(_anim.value));
    _anim.addListener(tick);
    _anim.forward(from: 0).whenCompleteOrCancel(() {
      _anim.removeListener(tick);
      if (_anim.status == AnimationStatus.completed) done?.call();
    });
  }

  // 넘어간 순간 기준 칸과 끈 거리를 함께 바꾼다(그리는 자리는 그대로라 깜빡이지 않는다)
  void _go(int dir) {
    _settling = true;
    _animateDrag(-dir * _width, _turnMs, () {
      final pages = _pages, next = _index + dir;
      setState(() {
        if (next >= 0 && next < pages.length) _id = pages[next];
        _drag = 0;
        _settling = false;
      });
    });
  }

  /// 손을 뗐다: 충분히 끌었거나 튕겼으면 넘기고, 아니면 제자리로
  void settle(double vx, bool ok) {
    final d = _drag;
    if (d == 0) return;
    final dir = d < 0 ? 1 : -1;
    final can = dir > 0 ? canNext : canPrev;
    final fling = vx.abs() > _fling && (vx < 0) == (d < 0);
    if (ok && can && (d.abs() > _width * _turnAt || fling)) {
      _go(dir);
    } else {
      _animateDrag(0, 200);
    }
  }

  void _back() {
    final nav = Navigator.of(context);
    nav.maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.paddingOf(context);
    final lib = _model.lib;
    final pages = _pages, index = _index;
    final back = IconBtn(label: '뒤로', onPress: _back, child: const LucideIcon('ChevronLeft', size: 22));
    if (index < 0) {
      return ColoredBox(
        color: AppColors.bg,
        child: Padding(
          padding: EdgeInsets.only(top: insets.top),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [back, const Expanded(child: Empty(title: '책을 찾지 못했어요'))]),
        ),
      );
    }
    final title = lib.editions[lib.books[_id]?.editionId]?.title ?? '';
    return Material(
      color: AppColors.bg,
      child: Stack(children: [
        Column(children: [
          Padding(
            padding: EdgeInsets.fromLTRB(Space.page - 10, insets.top + 4, Space.page, 0),
            child: Row(children: [
              back,
              const SizedBox(width: 4),
              Semantics(header: true, child: const Text('갈피 보드', style: TextStyle(fontFamily: AppFonts.uiBold, fontSize: 19, height: 26 / 19, color: AppColors.ink))),
            ]),
          ),
          Expanded(
            child: ClipRect(
              child: LayoutBuilder(builder: (_, box) {
                _width = box.maxWidth;
                return Stack(children: [
                  for (var i = 0; i < pages.length; i++)
                    if ((i - index).abs() <= (_near ? 1 : 0))
                      Positioned(
                        key: ValueKey(pages[i]),
                        left: (i - index) * box.maxWidth + _drag,
                        width: box.maxWidth,
                        top: 0,
                        bottom: 0,
                        child: _BoardPage(id: pages[i], host: this, lib: lib),
                      ),
                ]);
              }),
            ),
          ),
        ]),
        if (pages.length > 1)
          Positioned(
            left: 0,
            right: 0,
            bottom: insets.bottom + 16,
            height: 44,
            child: Center(
              // 화면 낭독: 끌지 않고 위아래 조절 동작으로 넘긴다
              child: Semantics(
                label: '${pages.length}권 중 ${index + 1}번째 책, $title',
                onIncrease: canNext ? () => _go(1) : null,
                onDecrease: canPrev ? () => _go(-1) : null,
                child: PageDots(count: pages.length, index: index, color: hexColor(tabColors(_ribbon(lib, _id), _id).$1)),
              ),
            ),
          ),
      ]),
    );
  }
}

/// 크기를 잰 뒤 알린다(카드 실제 높이: 손잡이 자리·누르기 판정)
class _Measured extends SingleChildRenderObjectWidget {
  const _Measured({required this.onSize, super.child});
  final ValueChanged<Size> onSize;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderMeasured(onSize);

  @override
  void updateRenderObject(BuildContext context, _RenderMeasured renderObject) => renderObject.onSize = onSize;
}

class _RenderMeasured extends RenderProxyBox {
  _RenderMeasured(this.onSize);
  ValueChanged<Size> onSize;

  @override
  void performLayout() {
    super.performLayout();
    onSize(size);
  }
}

class _BoardPage extends StatefulWidget {
  const _BoardPage({required this.id, required this.host, required this.lib});
  final String id;
  final _BoardScreenState host;
  final Library lib;

  @override
  State<_BoardPage> createState() => _BoardPageState();
}

class _BoardPageState extends State<_BoardPage> with TickerProviderStateMixin {
  final _model = LibraryModel.instance;
  Size _vp = Size.zero;
  BoardView _v = const BoardView(0, 0, 1);
  bool _ready = false, _shown = false;

  // 갈피·자리(서재가 바뀔 때만 다시 계산)
  Library? _for;
  List<Bookmark> _marks = const [];
  List<BoardSpot> _spots = const [];
  Map<String, BoardSpot> _spotOf = const {};
  BoardBounds _bounds = boardBounds(const []);

  // 고른 갈피(꾹 눌렀다 떼면 고르고, 빈 곳이나 카드를 한 번 누르면 풀린다)와 끄는 갈피
  String? _picked, _held;
  double _dx = 0, _dy = 0;
  Offset _finger = Offset.zero, _grab = Offset.zero;
  double? _resizeW;
  final _heights = <String, double>{};
  late final AnimationController _lift = AnimationController(vsync: this, duration: const Duration(milliseconds: 120), reverseDuration: const Duration(milliseconds: 180))
    ..addListener(_redraw);
  late final AnimationController _place = AnimationController(vsync: this, duration: const Duration(milliseconds: 260))..addListener(_redraw);
  late final Ticker _edgeTicker = createTicker(_edgeTick);
  Duration _lastTick = Duration.zero;

  // 손가락
  final _ptrs = <int, Offset>{};
  String _mode = 'idle'; // idle · pending · pan · pinch · card · resize
  Offset _begin = Offset.zero;
  String? _pressCard;
  Timer? _press;
  bool _paging = false;
  VelocityTracker? _vt;
  double _pinchDist = 1, _pinchS = 1;
  Offset _focal = Offset.zero;

  void _redraw() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _press?.cancel();
    _edgeTicker.dispose();
    _lift.dispose();
    _place.dispose();
    super.dispose();
  }

  void _sync(Library lib) {
    if (identical(lib, _for)) return;
    _for = lib;
    _marks = lib.books[widget.id] != null ? bookmarksOf(lib, widget.id) : const [];
    _spots = boardSpots([for (final m in _marks) BoardMark.of(m)]);
    _spotOf = {for (final s in _spots) s.id: s};
    _bounds = boardBounds(_spots);
  }

  double get _bottomBar => MediaQuery.paddingOf(context).bottom + 16 + 44; // 아래 '전체 보기·+ 갈피' 줄이 덮는 높이

  // 처음 열 때: 마지막에 보던 곳, 없으면 전체 보기
  Future<void> _open() async {
    _ready = true;
    BoardView? v;
    try {
      final raw = await KvStore.get(boardViewKey(widget.id));
      final o = raw == null ? null : jsonDecode(raw);
      if (o is Map && [o['x'], o['y'], o['s']].every((n) => n is num && n.isFinite)) {
        v = boardClamp(BoardView((o['x'] as num).toDouble(), (o['y'] as num).toDouble(), (o['s'] as num).toDouble()), _bounds, _vp.width, _vp.height);
      }
    } catch (_) {
      v = null;
    }
    if (!mounted) return;
    setState(() {
      _v = v ?? boardFit(_spots, _vp.width, _vp.height, _bottomBar);
      _shown = true;
    });
  }

  void _saveView() => KvStore.set(boardViewKey(widget.id), jsonEncode({'x': _v.x, 'y': _v.y, 's': _v.s}));

  void _animateTo(BoardView to) {
    final from = _v;
    if (MediaQuery.of(context).disableAnimations) {
      setState(() => _v = to);
      return;
    }
    void tick() {
      final t = Curves.easeOutCubic.transform(_place.value);
      _v = BoardView(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.s + (to.s - from.s) * t);
    }

    _place.addListener(tick);
    _place.forward(from: 0).whenCompleteOrCancel(() => _place.removeListener(tick));
  }

  // ---------- 카드 자리 ----------
  double _widthOf(BoardSpot o) => o.id == _picked && _resizeW != null ? _resizeW! : o.w;
  double _minHeightOf(Bookmark m, double w) => boardHeightAt(w, boardTextChars(m.text), m.photoUri != null ? boardPhotoRatio(m.photoRatio) : 0);

  /// 카드 가운데(보드 좌표): 왼쪽 위는 추정 높이로 놓고, 돌리기 가운데는 실제 크기의 가운데
  ({Offset c, double w, double h}) _box(Bookmark m, BoardSpot o) {
    final w = _widthOf(o);
    final h = _heights[m.id] ?? _minHeightOf(m, w);
    final held = m.id == _held;
    return (c: Offset(o.x - o.w / 2 + w / 2 + (held ? _dx : 0), o.y - o.h / 2 + h / 2 + (held ? _dy : 0)), w: w, h: h);
  }

  Offset _toBoard(Offset p) => Offset((p.dx - _v.x) / _v.s, (p.dy - _v.y) / _v.s);
  Offset _toScreen(Offset b) => Offset(b.dx * _v.s + _v.x, b.dy * _v.s + _v.y);

  /// 그리는 차례: 나중에 만지거나 고친 갈피가 위(기기가 달라도 같은 순서), 고른 갈피, 드는 갈피가 맨 위
  List<Bookmark> get _drawOrder {
    final list = [..._marks]..sort((p, q) => p.updatedAt.compareTo(q.updatedAt));
    for (final top in [_picked, _held]) {
      final i = list.indexWhere((m) => m.id == top);
      if (i >= 0) list.add(list.removeAt(i));
    }
    return list;
  }

  String? _cardAt(Offset p) {
    final b = _toBoard(p);
    for (final m in _drawOrder.reversed) {
      final o = _spotOf[m.id];
      if (o == null) continue;
      final box = _box(m, o);
      final a = -o.rot * math.pi / 180, d = b - box.c;
      final lx = d.dx * math.cos(a) - d.dy * math.sin(a), ly = d.dx * math.sin(a) + d.dy * math.cos(a);
      if (lx.abs() <= box.w / 2 && ly.abs() <= box.h / 2) return m.id;
    }
    return null;
  }

  /// 손잡이: 돌아간 카드의 오른쪽 아래 모서리(화면 좌표)
  Offset? _handleAt() {
    final id = _picked;
    final m = id == null ? null : _marks.where((x) => x.id == id).firstOrNull;
    final o = id == null ? null : _spotOf[id];
    if (m == null || o == null) return null;
    final box = _box(m, o);
    final r = o.rot * math.pi / 180, hw = box.w / 2, hh = box.h / 2;
    return _toScreen(box.c + Offset(hw * math.cos(r) - hh * math.sin(r), hw * math.sin(r) + hh * math.cos(r)));
  }

  // ---------- 손가락 ----------
  void _down(PointerDownEvent e) {
    _ptrs[e.pointer] = e.localPosition;
    if (_ptrs.length == 1) {
      _place.stop();
      _vt = VelocityTracker.withKind(e.kind)..addPosition(e.timeStamp, e.localPosition);
      _begin = e.localPosition;
      final h = _handleAt();
      if (h != null && _held == null && (e.localPosition - h).distance <= _handle / 2 + 4) {
        _mode = 'resize';
        _resizeW = _spotOf[_picked]!.w;
        return;
      }
      _mode = 'pending';
      _pressCard = _cardAt(e.localPosition);
      _press?.cancel();
      if (_pressCard != null) _press = Timer(_hold, _startCard);
    } else if (_ptrs.length == 2 && (_mode == 'pending' || _mode == 'pan')) {
      _press?.cancel();
      if (widget.host.drag != 0) widget.host.settle(0, false);
      _paging = false;
      _mode = 'pinch';
      final p = _ptrs.values.toList();
      _pinchDist = math.max(1, (p[0] - p[1]).distance);
      _pinchS = _v.s;
      _focal = (p[0] + p[1]) / 2;
    }
  }

  void _move(PointerMoveEvent e) {
    if (!_ptrs.containsKey(e.pointer)) return;
    _ptrs[e.pointer] = e.localPosition;
    if (_ptrs.length == 1) _vt?.addPosition(e.timeStamp, e.localPosition);
    switch (_mode) {
      case 'pending':
        final d = e.localPosition - _begin;
        if (d.distance <= _slop) return;
        _press?.cancel();
        _mode = 'pan';
        // 가로로 시작한 한 손가락 끌기만 책을 넘긴다. 세로 끌기와 두 손가락은 보드만 움직인다
        final host = widget.host;
        _paging = !host.settling && (host.canPrev || host.canNext) && _ptrs.length <= 1 && d.dx.abs() > d.dy.abs();
        _panBy(e.localDelta);
      case 'pan':
        _panBy(e.localDelta);
      case 'pinch':
        if (_ptrs.length < 2) return;
        final p = _ptrs.values.take(2).toList();
        final focal = (p[0] + p[1]) / 2;
        final next = math.max(boardMinScale, math.min(boardMaxScale, _pinchS * (p[0] - p[1]).distance / _pinchDist));
        final k = next / _v.s;
        final moved = focal - _focal;
        _focal = focal;
        setState(() {
          _v = boardClamp(BoardView(focal.dx - (focal.dx - _v.x) * k + moved.dx, focal.dy - (focal.dy - _v.y) * k + moved.dy, next), _bounds, _vp.width, _vp.height);
        });
      case 'card':
        setState(() {
          _finger = e.localPosition;
          _followFinger();
        });
      case 'resize':
        final d = e.localDelta.dx.abs() >= e.localDelta.dy.abs() ? e.localDelta.dx : e.localDelta.dy;
        setState(() => _resizeW = math.max(boardMinW, math.min(boardMaxW, _resizeW! + d / _v.s)));
    }
  }

  void _panBy(Offset delta) {
    final host = widget.host;
    var dx = delta.dx;
    if (_paging) {
      // 넘기다 되돌아오면 책이 제자리에 온 뒤에야 보드가 움직인다
      final d = host.drag;
      if (d != 0) {
        final nd = d + dx;
        if (nd * d > 0) {
          host.drag = math.max(-_vp.width, math.min(_vp.width, nd));
          return;
        }
        host.drag = 0;
        dx = nd;
      }
      final slide = boardPageSlide(_v.x, dx, _v.s, (x0: _bounds.x0, x1: _bounds.x1), _vp.width);
      if (slide.left != 0 && (slide.left < 0 ? host.canNext : host.canPrev)) host.drag = slide.left;
      dx = slide.x - _v.x;
    }
    setState(() => _v = boardClamp(BoardView(_v.x + dx, _v.y + (host.drag != 0 ? 0 : delta.dy), _v.s), _bounds, _vp.width, _vp.height));
  }

  void _up(PointerEvent e, {required bool ok}) {
    if (!_ptrs.containsKey(e.pointer)) return;
    final at = _ptrs.remove(e.pointer)!;
    switch (_mode) {
      case 'pending':
        _press?.cancel();
        _mode = 'idle';
        if (ok && (at - _begin).distance <= _tapSlop) _tap(_pressCard);
      case 'pan':
      case 'pinch':
        if (_ptrs.length == 1) {
          // 두 손가락 중 하나를 뗐다: 남은 손가락으로 보드만 움직인다
          _mode = 'pan';
          _paging = false;
          return;
        }
        if (_ptrs.isNotEmpty) return;
        _mode = 'idle';
        _saveView();
        final vx = _vt?.getVelocity().pixelsPerSecond.dx ?? 0;
        widget.host.settle(vx, ok);
      case 'card':
        _mode = 'idle';
        _drop(ok);
      case 'resize':
        _mode = 'idle';
        _commitWidth(ok);
    }
  }

  void _tap(String? card) {
    if (_picked != null) {
      setState(() => _picked = null);
    } else if (card != null) {
      openBookmark(context, card);
    }
  }

  void _startCard() {
    if (_mode != 'pending' || _pressCard == null || !mounted) return;
    _mode = 'card';
    setState(() {
      _held = _pressCard;
      _dx = 0;
      _dy = 0;
      _finger = _ptrs.values.first;
      _grab = _toBoard(_finger);
    });
    _lift.forward();
    _lastTick = Duration.zero;
    _edgeTicker.start();
  }

  // 끄는 자리는 손가락 위치로 바로 계산한다(끌다가 화면 끝에 닿아 보드가 넓어져도 카드가 손가락 아래에 남는다)
  void _followFinger() {
    final b = _toBoard(_finger);
    _dx = b.dx - _grab.dx;
    _dy = b.dy - _grab.dy;
  }

  void _edgeTick(Duration now) {
    final dt = _lastTick == Duration.zero ? 16 : (now - _lastTick).inMicroseconds / 1000;
    _lastTick = now;
    final f = _finger;
    final near = f.dx < _edge || f.dx > _vp.width - _edge || f.dy < _edge || f.dy > _vp.height - _edge;
    if (!near || _v.s <= _edgeMinScale) return;
    final k = math.max(_edgeMinScale / _v.s, math.pow(_edgeZoom, dt / 1000).toDouble());
    setState(() {
      _v = boardZoomAt(_v, k, _vp.width / 2, _vp.height / 2);
      _followFinger();
    });
  }

  List<({String id, double x, double y, double rot})> get _spotList => [for (final s in _spots) (id: s.id, x: s.x, y: s.y, rot: s.rot)];

  void _drop(bool ok) {
    _edgeTicker.stop();
    _lift.reverse();
    _saveView();
    final id = _held!, o = _spotOf[id]!;
    if (ok && _dx.abs() + _dy.abs() >= 2) {
      final nx = math.max(-_reach, math.min(_reach, o.x + _dx)).roundToDouble();
      final ny = math.max(-_reach, math.min(_reach, o.y + _dy)).roundToDouble();
      _model.updateBoard(_spotList, id, x: nx, y: ny, rot: o.rot);
    }
    setState(() {
      _held = null;
      _dx = 0;
      _dy = 0;
      if (ok) _picked = id;
    });
  }

  // 손잡이: 폭이 바뀌면 글은 그 폭에 맞춰 다시 줄 바꿈된다. 왼쪽 위 모서리는 그대로
  void _commitWidth(bool ok) {
    final id = _picked, nw = _resizeW;
    final m = id == null ? null : _marks.where((x) => x.id == id).firstOrNull;
    final o = id == null ? null : _spotOf[id];
    if (ok && m != null && o != null && nw != null && nw.round() != o.w) _resize(m, o, nw.roundToDouble());
    setState(() => _resizeW = null);
  }

  void _resize(Bookmark m, BoardSpot o, double width) {
    final r = boardResized(BoardMark.of(m), o, width);
    _model.updateBoard(_spotList, m.id, x: r.boardX, y: r.boardY, rot: r.boardRot, w: r.boardW);
  }

  void _fit() {
    final v = boardFit(_spots, _vp.width, _vp.height, _bottomBar);
    _animateTo(v);
    KvStore.set(boardViewKey(widget.id), jsonEncode({'x': v.x, 'y': v.y, 's': v.s}));
  }

  void _addHere() {
    final size = boardCardSize(text: '갈피에 남길 문장 두 줄 정도');
    final spot = boardFreeSpot(boardRects(_spots), _v, _vp.width, _vp.height, size);
    openNewBookmark(context, book: widget.id, boardX: spot.x, boardY: spot.y);
  }

  // ---------- 그리기 ----------
  Widget _card(Bookmark m, BoardSpot o, String? color, Color ring) {
    final w = _widthOf(o);
    final held = m.id == _held;
    final lift = held || (_held == null && m.id == _picked) ? _lift.value : 0.0;
    final page = m.page != null && m.page != 0 ? ', ${m.page}쪽' : '';
    return Positioned(
      key: ValueKey(m.id),
      left: o.x - o.w / 2,
      top: o.y - o.h / 2,
      width: w,
      child: Transform.translate(
        offset: held ? Offset(_dx, _dy) : Offset.zero,
        child: Transform.rotate(
          angle: o.rot * math.pi / 180,
          child: Transform.scale(
            scale: 1 + (_liftScale - 1) * lift,
            child: Semantics(
              button: true,
              label: '${m.text.trim().isEmpty ? '사진 갈피' : m.text.trim()}$page',
              hint: '눌러서 크게 읽기, 꾹 눌러 옮기기',
              onTap: () => openBookmark(context, m.id),
              child: _Measured(
                onSize: (s) {
                  final old = _heights[m.id];
                  _heights[m.id] = s.height;
                  // 고른 갈피의 높이가 바뀌면 손잡이 자리도 다시
                  if (m.id == _picked && old != null && (old - s.height).abs() > 0.5) WidgetsBinding.instance.addPostFrameCallback((_) => _redraw());
                },
                child: Stack(clipBehavior: Clip.none, children: [
                  // 들어 올린 동안만 깊은 그림자
                  if (lift > 0.01)
                    Positioned.fill(
                      child: Opacity(
                        opacity: lift,
                        child: const DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.all(Radius.circular(4)),
                            boxShadow: [BoxShadow(color: Color.fromRGBO(60, 50, 45, 0.28), offset: Offset(0, 12), blurRadius: 24)],
                          ),
                        ),
                      ),
                    ),
                  BoardCard(mark: m, color: color, minHeight: _minHeightOf(m, w)),
                  if (m.id == _picked)
                    Positioned(
                      left: -3,
                      top: -3,
                      right: -3,
                      bottom: -3,
                      child: DecoratedBox(decoration: BoxDecoration(border: Border.all(color: ring, width: 1.5), borderRadius: BorderRadius.circular(5))),
                    ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lib = widget.lib;
    _sync(lib);
    final b = lib.books[widget.id];
    final e = b == null ? null : lib.editions[b.editionId];
    if (b == null || e == null) return const SizedBox.shrink();
    final insets = MediaQuery.paddingOf(context);
    final color = _ribbon(lib, b.id);
    final ring = hexColor(tabColors(color, b.id).$1);
    final handle = _held == null ? _handleAt() : null;
    return Stack(children: [
      Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Space.page, 6, Space.page, 10),
          child: Row(children: [
            SizedBox(width: 34, child: Center(child: LinkedCover(lib: lib, id: widget.id, width: 34))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
                Text([if (e.authors.isNotEmpty) e.authors.first, '갈피 ${_marks.length}개'].join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub),
              ]),
            ),
            const SizedBox(width: 12),
            Btn(
              label: '목록 보기',
              kind: 'secondary',
              size: 's',
              onPress: () {
                Navigator.of(context).popUntil((r) => r.isFirst);
                AppNav.instance.goBookmarks(widget.id);
              },
            ),
          ]),
        ),
        Expanded(
          child: LayoutBuilder(builder: (_, box) {
            final vp = box.biggest;
            if (vp != _vp) {
              _vp = vp;
              if (!_ready && _spots.isNotEmpty && vp.width > 0) WidgetsBinding.instance.addPostFrameCallback((_) => _open());
            }
            return Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: _down,
              onPointerMove: _move,
              onPointerUp: (e) => _up(e, ok: true),
              onPointerCancel: (e) => _up(e, ok: false),
              child: ClipRect(
                child: Stack(children: [
                  if (_marks.isEmpty)
                    const Center(child: Empty(title: '아직 남긴 갈피가 없어요', body: '이 책에 남긴 문장과 사진을 여기에 붙여 둘 수 있어요.'))
                  else
                    Positioned.fill(
                      child: Opacity(
                        opacity: _shown ? 1 : 0,
                        child: Transform(
                          transform: Matrix4.translationValues(_v.x, _v.y, 0)..scaleByDouble(_v.s, _v.s, 1, 1),
                          child: Stack(clipBehavior: Clip.none, children: [
                            for (final m in _drawOrder)
                              if (_spotOf[m.id] case final o?) _card(m, o, color, ring),
                          ]),
                        ),
                      ),
                    ),
                  // 손잡이는 확대·축소와 상관없이 같은 크기로
                  if (handle != null && _shown)
                    Positioned(
                      left: handle.dx - _handle / 2,
                      top: handle.dy - _handle / 2,
                      width: _handle,
                      height: _handle,
                      child: Semantics(
                        slider: true,
                        label: '갈피 크기',
                        onIncrease: () => _resizeBy(24),
                        onDecrease: () => _resizeBy(-24),
                        child: Center(
                          child: Container(
                            width: 26,
                            height: 26,
                            decoration: BoxDecoration(color: AppColors.bg, shape: BoxShape.circle, border: Border.all(color: ring, width: 1.5)),
                            child: const Center(child: LucideIcon('MoveDiagonal2', size: 14)),
                          ),
                        ),
                      ),
                    ),
                ]),
              ),
            );
          }),
        ),
      ]),
      Positioned(
        left: 16,
        right: 16,
        bottom: insets.bottom + 16,
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Btn(label: '전체 보기', kind: 'secondary', size: 's', disabled: _marks.isEmpty, onPress: _fit),
          Btn(label: '갈피', kind: 'secondary', size: 's', icon: const LucideIcon('Plus', size: 18), onPress: _addHere),
        ]),
      ),
    ]);
  }

  void _resizeBy(double d) {
    final id = _picked;
    final m = id == null ? null : _marks.where((x) => x.id == id).firstOrNull;
    final o = id == null ? null : _spotOf[id];
    if (m == null || o == null) return;
    final nw = math.max(boardMinW, math.min(boardMaxW, o.w + d));
    if (nw.round() != o.w) _resize(m, o, nw.roundToDouble());
  }
}
