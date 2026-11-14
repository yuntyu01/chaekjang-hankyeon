// 홈 책장 넘기기·모아 보기(지금 앱 features/home/YearPager.tsx, 2026-11-07 사용자 '왼쪽으로 화면 넘기면 전년도 책장, 양손으로 화면 줄이면 옆에 보이게').
// 쪽 0 = 지금 책장, k = k년 전 책장. 지난 책장은 오른쪽에 이어 있어 손가락을 왼쪽으로 밀면 한 해 전으로 간다.
// 두 손가락으로 줄이면 모든 쪽이 함께 작아져 옆 해 책장이 나란히 보이고(모아 보기), 한 쪽을 누르거나 벌리면 그 쪽으로 돌아온다.
// 꾸미는 중·책을 끄는 중에는 넘기지 않는다(blocked). 책 꾹 눌러 끌기와는 먼저 시작한 쪽이 이긴다(가로로 먼저 움직이면 넘기기)
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../../domain/bookcase.dart';
import '../../ui/engraved_year.dart';
import '../../ui/theme.dart';
import 'home_screen.dart' show homeHeaderHeight;
import 'year_shelf.dart';

const overviewZoom = 0.46; // 모아 보기 배율: 두 해 책장이 한 화면에 나란히
const _slideMs = 300;
const _overMargin = 8.0; // 모아 보기에서 맨 끝 쪽과 화면 가장자리 사이
const _labelSize = 30.0;

double _clamp(double v, double lo, double hi) => math.max(lo, math.min(hi, v));

class YearPager extends StatefulWidget {
  const YearPager({super.key, required this.bookcases, required this.current, required this.blocked, required this.onPinch});

  /// 남긴 연도 책장(오래된 해부터)
  final List<Bookcase> bookcases;

  /// 지금 책장 쪽(머리글 불투명도)
  final Widget Function(double headerOpacity) current;
  final bool blocked;

  /// 두 손가락으로 줄이는 동안(그동안 세로 스크롤을 끈다)
  final ValueChanged<bool> onPinch;

  @override
  State<YearPager> createState() => YearPagerState();
}

class YearPagerState extends State<YearPager> with SingleTickerProviderStateMixin {
  double _at = 0, _zoom = 1;
  int _page = 0;
  bool _wide = false; // 모아 보기를 시작했거나 그 중: 모든 쪽을 그린다
  // 옆 쪽은 첫 화면이 뜨고 조금 뒤 미리 그려 둔다(넘기기 시작할 때 그리면 굽는 동안 손가락을 못 따라간다). 한 번 그리면 내리지 않는다
  bool _engaged = false;
  Timer? _engageTimer;
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: _slideMs));
  double _w = 1;

  // 끌기·줄이기 시작 값
  double _startAt = 0, _startZ = 1, _dragDx = 0, _u = 0, _d0 = 1;
  bool _pinching = false;
  // 이번 손가락 묶음에서 줄이기를 했으면 가로 끌기는 무시한다: 손을 뗄 때 끌기 끝이 줄이기 끝보다 늦게 와서 모아 보기를 한 쪽 보기로 되돌렸다
  bool _pinched = false;
  final _ptrs = <int, Offset>{};

  int get _count => widget.bookcases.length;

  /// 지금 멈춘 쪽(0 = 지금 책장)
  int get page => _page;

  @override
  void initState() {
    super.initState();
    _engageTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _engaged = true);
    });
  }

  @override
  void didUpdateWidget(YearPager oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 지난 책장이 줄면 없는 쪽에 머물지 않게
    if (_page > _count) goTo(_count);
  }

  @override
  void dispose() {
    _engageTimer?.cancel();
    _anim.dispose();
    super.dispose();
  }

  bool get _reduce => MediaQuery.of(context).disableAnimations;

  void _animate(double at, double zoom) {
    _anim.stop();
    final a0 = _at, z0 = _zoom;
    if (_reduce) {
      setState(() {
        _at = at;
        _zoom = zoom;
      });
      return;
    }
    void tick() {
      final t = Curves.easeOutCubic.transform(_anim.value);
      setState(() {
        _at = a0 + (at - a0) * t;
        _zoom = z0 + (zoom - z0) * t;
      });
    }

    _anim.addListener(tick);
    _anim.forward(from: 0).whenCompleteOrCancel(() => _anim.removeListener(tick));
  }

  // 모아 보기에서 가운데에 둘 수 있는 자리(쪽 번호). 모든 쪽이 화면에 들어가면 한가운데, 아니면 양 끝 쪽이 가장자리에서 여백 안으로
  (double, double) _overRange() {
    const z = overviewZoom;
    if ((_count * _w + _w) * z + 2 * _overMargin <= _w) return (_count / 2, _count / 2);
    final lo = (_w / 2 - _overMargin - _w * z / 2) / (_w * z);
    return (lo, _count - lo);
  }

  // 손을 떼면 멈출 쪽·배율로 간다. 한 쪽 보기는 쪽 번호(정수), 모아 보기는 화면을 채우는 범위 안 아무 자리
  void _settle(double want, double z) {
    final (lo, hi) = _overRange();
    final k = z < 1 ? _clamp(want, lo, hi) : _clamp(want.roundToDouble(), 0, _count.toDouble());
    _animate(k, z);
    setState(() {
      _page = k.round();
      _wide = z < 1;
    });
  }

  /// 그 쪽으로(0 = 지금 책장)
  void goTo(int k) {
    final t = _clamp(k.toDouble(), 0, _count.toDouble());
    if (t > 0) _engaged = true;
    _animate(t, 1);
    setState(() {
      _page = t.round();
      _wide = false;
    });
  }

  // ---------- 가로 끌기 ----------
  void _dragStart(DragStartDetails _) {
    if (_pinching || _pinched) return;
    _anim.stop();
    setState(() => _engaged = true);
    _startAt = _at;
    _startZ = _zoom;
    _dragDx = 0;
  }

  void _dragUpdate(DragUpdateDetails d) {
    if (_pinching || _pinched) return;
    _dragDx += d.delta.dx;
    final n = _count.toDouble();
    final raw = _startAt - _dragDx / (_w * _startZ);
    // 끝 너머는 손가락의 1/3만 따라간다
    setState(() => _at = raw < 0 ? raw / 3 : raw > n ? n + (raw - n) / 3 : raw);
  }

  void _dragEnd(DragEndDetails d) {
    if (_pinching || _pinched) return;
    final z = _startZ;
    final v = -d.velocity.pixelsPerSecond.dx / (_w * z); // 쪽/초
    // 한 쪽 보기에서는 한 번에 한 해씩: 빠르게 밀었거나 4분의 1 넘게 밀었으면 그 쪽으로. 모아 보기에서는 민 만큼 미끄러진다
    if (z > 0.99) {
      final base = _startAt.roundToDouble();
      final moved = _at - base;
      final dir = v.abs() > 0.8 ? v.sign : (moved.abs() > 0.25 ? moved.sign : 0.0);
      _settle(base + dir, 1);
    } else {
      _settle(_at + v * 0.25, overviewZoom);
    }
  }

  // ---------- 두 손가락 ----------
  void _down(PointerDownEvent e) {
    _ptrs[e.pointer] = e.localPosition;
    if (_ptrs.length == 1) _pinched = false;
    if (_ptrs.length != 2 || widget.blocked || _count < 1) return;
    _anim.stop();
    final p = _ptrs.values.toList();
    _d0 = math.max(1, (p[0] - p[1]).distance);
    _startZ = _zoom;
    // 손가락 가운데 아래의 쪽 자리(줄이기 전 단위)가 그대로 손가락 아래에 남게 한다
    final fx = (p[0].dx + p[1].dx) / 2 - _w / 2;
    _u = _at * _w + fx / _zoom;
    _pinching = true;
    _pinched = true;
    widget.onPinch(true);
    setState(() {
      _wide = true;
      _engaged = true;
    });
  }

  void _move(PointerMoveEvent e) {
    if (!_ptrs.containsKey(e.pointer)) return;
    _ptrs[e.pointer] = e.localPosition;
    if (!_pinching || _ptrs.length < 2) return;
    final p = _ptrs.values.take(2).toList();
    final z = _clamp(_startZ * (p[0] - p[1]).distance / _d0, 0.3, 1.08);
    final fx = (p[0].dx + p[1].dx) / 2 - _w / 2;
    setState(() {
      _zoom = z;
      _at = _clamp((_u - fx / z) / _w, -0.3, _count + 0.3);
    });
  }

  void _up(PointerEvent e) {
    _ptrs.remove(e.pointer);
    if (!_pinching || _ptrs.length >= 2) return;
    _pinching = false;
    widget.onPinch(false);
    // 한 쪽에서 조금만 줄여도 모아 보기로, 모아 보기에서 조금만 벌려도 한 쪽으로
    final over = _startZ > 0.99 ? _zoom < 0.9 : _zoom < overviewZoom + 0.1;
    _settle(_at, over ? overviewZoom : 1);
  }

  // 모아 보기에서 한 쪽을 누르면 그 책장으로
  void _pick(TapUpDetails d) => _settle(_at + (d.localPosition.dx - _w / 2) / (_w * _zoom), 1);

  String _yearOf(int k) => k == 0 ? '${DateTime.now().year}' : '${widget.bookcases[_count - k].year}';

  @override
  Widget build(BuildContext context) {
    final pad = MediaQuery.paddingOf(context);
    final on = _count > 0 && !widget.blocked;
    final headerOpacity = _zoom >= 1 ? 1.0 : _clamp((_zoom - 0.82) / 0.18, 0, 1);
    final show = _clamp((0.9 - _zoom) / (0.9 - overviewZoom), 0, 1);
    return LayoutBuilder(builder: (context, box) {
      _w = box.maxWidth;
      final h = box.maxHeight;
      Matrix4 frame(int k) => Matrix4.identity()
        ..translateByDouble(_w / 2, h / 2, 0, 1)
        ..scaleByDouble(_zoom, _zoom, 1, 1)
        ..translateByDouble(-_w / 2 + (k - _at) * _w, -h / 2, 0, 1);
      final pages = <Widget>[];
      for (var k = 0; k <= _count; k++) {
        final near = (k - _at).abs() < (_engaged ? 1.999 : 0.999);
        if (!_wide && !near && k != _page) continue;
        final active = k == _page && _zoom >= 0.99 && (_at - k).abs() < 0.01;
        final child = k == 0
            ? widget.current(headerOpacity)
            : YearShelf(key: ValueKey(widget.bookcases[_count - k].id), bookcase: widget.bookcases[_count - k], active: active, headerOpacity: headerOpacity);
        pages.add(Positioned.fill(
          key: ValueKey('page-$k'),
          child: Transform(
            transform: frame(k),
            // 보이지 않는 쪽은 누를 수 없고 화면 읽기에서도 뺀다
            child: IgnorePointer(ignoring: !active, child: ExcludeSemantics(excluding: !active, child: ColoredBox(color: AppColors.bg, child: child))),
          ),
        ));
      }
      final labelH = engravedHeight(context, _labelSize);
      return Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: _down,
        onPointerMove: _move,
        onPointerUp: _up,
        onPointerCancel: _up,
        child: RawGestureDetector(
          behavior: HitTestBehavior.translucent,
          gestures: {
            if (on)
              HorizontalDragGestureRecognizer: GestureRecognizerFactoryWithHandlers<HorizontalDragGestureRecognizer>(
                HorizontalDragGestureRecognizer.new,
                (g) => g
                  ..onStart = _dragStart
                  ..onUpdate = _dragUpdate
                  ..onEnd = _dragEnd,
              ),
          },
          child: Stack(children: [
            ...pages,
            // 모아 보기: 책장 위 벽에 새긴 해 숫자(머리글이 있던 띠 가운데)
            if (show > 0)
              for (var k = 0; k <= _count; k++)
                Positioned(
                  key: ValueKey('label-$k'),
                  left: 0,
                  right: 0,
                  top: h / 2 + (pad.top + homeHeaderHeight / 2 - h / 2) * _zoom - labelH / 2,
                  child: IgnorePointer(
                    child: Opacity(
                      opacity: show,
                      child: Transform.translate(offset: Offset((k - _at) * _w * _zoom, 0), child: Center(child: EngravedYear(label: _yearOf(k), size: _labelSize))),
                    ),
                  ),
                ),
            if (_zoom < 0.99) Positioned.fill(key: const ValueKey('pick'), child: GestureDetector(behavior: HitTestBehavior.translucent, onTapUp: _pick)),
          ]),
        ),
      );
    });
  }
}
