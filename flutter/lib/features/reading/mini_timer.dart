// 공통 작은 타이머(지금 앱 features/reading/MiniTimer.tsx): 진행 중이거나 일시정지된 독서가 있을 때 화면 오른쪽 아래에 작은 원(누적 시간만).
// 원을 누르면 오른쪽 끝(시간 자리)은 그대로 두고 왼쪽으로 늘어나 '읽기 화면 바로가기'와 '재생/일시정지'가 나온다.
// 시간을 다시 누르거나 바깥을 누르면 접힌다(타이머·환경음 상태는 그대로). 시간은 같은 누적 값을 1초마다 다시 그릴 뿐 따로 재지 않는다.
// 읽기 화면·읽기 탭(책마다 흐르는 시간이 보인다)에서는 띄우지 않는다. 하단 탭·키보드·안전 영역과 겹치지 않게 둔다
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../domain/reading.dart';
import '../../store/mini_timer_store.dart';
import '../../store/reading_store.dart';
import '../../store/settings_store.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'reading_screen.dart';

const _actionsW = 112.0; // 펼친 왼쪽 부분(바로가기 + 재생/일시정지)
const _gap = 12.0;
const _tabs = ['/', '/bookmarks', '/stats', '/community', '/me'];

bool miniTimerHidden(String path) => path == '/read' || path.startsWith('/reading');

String _speak(num ms) {
  final t = (ms / 1000).floor();
  final h = t ~/ 3600, m = (t % 3600) ~/ 60, s = t % 60;
  return '${h > 0 ? '$h시간 ' : ''}$m분 $s초';
}

class MiniTimer extends StatefulWidget {
  const MiniTimer({super.key, required this.navigator});
  final GlobalKey<NavigatorState> navigator;

  @override
  State<MiniTimer> createState() => _MiniTimerState();
}

class _MiniTimerState extends State<MiniTimer> {
  final _reading = ReadingStore.instance;
  final _place = MiniTimerPlace.instance;
  bool _open = false;
  Timer? _tick;
  String _lastKey = '';

  @override
  void initState() {
    super.initState();
    _reading.addListener(_changed);
    _place.addListener(_changed);
  }

  @override
  void dispose() {
    _reading.removeListener(_changed);
    _place.removeListener(_changed);
    _tick?.cancel();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _sync(bool tick) {
    if (tick) {
      _tick ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else {
      _tick?.cancel();
      _tick = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final keyboard = mq.viewInsets.bottom > 0;
    final path = _place.path;
    final hidden = _reading.active == null || miniTimerHidden(path) || _place.hidden || _place.modal || keyboard;
    // 화면이 바뀌거나 숨으면 접어 둔다(다시 나타날 때 늘 원)
    final key = '$path|$hidden';
    if (key != _lastKey) {
      _lastKey = key;
      _open = false;
    }
    final running = _reading.running;
    _sync(!hidden && running);
    if (hidden) return const SizedBox.shrink();
    final ms = _reading.elapsed;
    final label = clock(ms);
    // 한 시간을 넘으면 숫자가 길어져 원 대신 같은 높이의 캡슐로 넓힌다
    final timeW = label.length > 5 ? miniTimerSize + 24 : miniTimerSize;
    final s = SettingsStore.instance;
    final reduce = s.reduceMotion == 'on' || (s.reduceMotion == 'system' && mq.disableAnimations);
    final onTabs = _place.route == '/' && _tabs.contains(path);
    final bottom = (onTabs ? TabBarStyle.navHeight + mq.padding.bottom : _place.bottom ?? mq.padding.bottom) + _gap;
    final hair = 2 / mq.devicePixelRatio;
    Widget divider() => Container(width: hair, height: 22, color: AppColors.line);
    return Stack(children: [
      // 펼친 동안 바깥을 누르면 접는다(아래 화면은 눌리지 않는다)
      if (_open) Positioned.fill(child: Semantics(label: '미니 타이머 접기', child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => setState(() => _open = false)))),
      Positioned(
        right: 16,
        bottom: bottom,
        height: miniTimerSize,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.bg,
            borderRadius: BorderRadius.circular(miniTimerSize / 2),
            border: Border.all(color: AppColors.line, width: hair),
            boxShadow: const [Shape.floatShadow],
          ),
          clipBehavior: Clip.antiAlias,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            AnimatedContainer(
              duration: reduce ? Duration.zero : const Duration(milliseconds: 180),
              width: _open ? _actionsW : 0,
              child: AnimatedOpacity(
                duration: reduce ? Duration.zero : const Duration(milliseconds: 180),
                opacity: _open ? 1 : 0,
                child: IgnorePointer(
                  ignoring: !_open,
                  child: ClipRect(
                    child: OverflowBox(
                      alignment: Alignment.centerRight,
                      minWidth: _actionsW,
                      maxWidth: _actionsW,
                      child: Row(children: [
                        Semantics(
                          button: true,
                          label: '읽기 화면으로 가기',
                          child: Pressable(
                            onPress: () {
                              setState(() => _open = false);
                              // 쌓아서 연다: 지금 화면은 그대로 남는다
                              final nav = widget.navigator.currentContext;
                              if (nav != null) openReadingScene(nav);
                            },
                            child: const SizedBox(width: 52, height: miniTimerSize, child: Center(child: LucideIcon('BookOpen'))),
                          ),
                        ),
                        divider(),
                        Semantics(
                          button: true,
                          label: running ? '독서 일시정지' : '독서 다시 시작',
                          child: Pressable(
                            onPress: () => running ? _reading.pause() : _reading.resume(),
                            child: SizedBox(
                              width: 52,
                              height: miniTimerSize,
                              child: Center(
                                child: running
                                    ? Row(mainAxisSize: MainAxisSize.min, children: [
                                        for (final (i, _) in [0, 1].indexed) ...[
                                          if (i > 0) const SizedBox(width: 5),
                                          Container(width: 3.5, height: 16, decoration: BoxDecoration(color: AppColors.ink, borderRadius: BorderRadius.circular(1.5))),
                                        ],
                                      ])
                                    : const Padding(padding: EdgeInsets.only(left: 2), child: LucideIcon('Play', size: 20, fill: AppColors.ink)),
                              ),
                            ),
                          ),
                        ),
                        divider(),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
            Semantics(
              container: true,
              button: true,
              expanded: _open,
              label: '독서 시간 ${_speak(ms)}${running ? '' : ', 일시정지'}. 눌러서 ${_open ? '접기' : '펼치기'}',
              onTap: () => setState(() => _open = !_open),
              excludeSemantics: true,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => setState(() => _open = !_open),
                child: SizedBox(
                  width: timeW - hair * 2,
                  height: miniTimerSize - hair * 2,
                  child: Center(
                    child: Text(label,
                        maxLines: 1,
                        style: const TextStyle(fontFamily: AppFonts.uiBold, fontSize: 15, color: AppColors.ink, fontFeatures: [FontFeature.tabularFigures()])),
                  ),
                ),
              ),
            ),
          ]),
        ),
      ),
    ]);
  }
}
