// 독서 실행 화면(지금 앱 features/reading/ReadingScreen.tsx): 장면이 화면 대부분, 아래 조작부는 위에서부터 연결된 책 · 시간 · [분위기 | 재생/일시정지 | 목표] 한 줄.
// 분위기 = 장면+환경음 한 세트. 조작부를 접으면 [스피커 · 밝은 시간 · 재생·일시정지]가 남는다(다시 열어도 타이머는 멈추지 않는다).
// 스피커를 누르면 그 줄 위에 왼쪽부터 차는 소리 막대가 열리고, 한 번 더 누르거나 막대를 맨 왼쪽까지 내리면 음소거.
// 장면은 옆으로 밀어 바꾼다(접었을 때 아래 점이 지금 장면). 소리만 듣기(soundOnly)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';

import '../../domain/library.dart';
import '../../domain/reading.dart';
import '../../services/ambient.dart';
import '../../store/finish_reading.dart';
import '../../store/library_model.dart';
import '../../store/reading_store.dart';
import '../../store/settings_store.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart';
import '../stats/stats_widgets.dart';
import 'finish_screen.dart';
import 'play_icons.dart';
import 'read_list.dart' show bookTitle;

const _light = NightColors.ink;
const _goals = [15, 30, 60];
const _tabular = [FontFeature.tabularFigures()];
const _shade = [Shadow(color: NightColors.shade, offset: Offset(0, 1), blurRadius: 6)];

const scenePosters = {'rain': 'assets/scenes/rain-window-poster.jpg', 'fire': 'assets/scenes/fireplace-poster.jpg'};
const _videos = {'rain': 'assets/scenes/rain-window.mp4', 'fire': 'assets/scenes/fireplace.mp4'};

/// 장면 화면 열기(앱 맨 위에 꽉 차게)
Future<void> openReadingScene(BuildContext context, {String? bookId, bool soundOnly = false}) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(builder: (_) => ReadingScreen(initialBookId: bookId, soundOnly: soundOnly)));

class ReadingScreen extends StatefulWidget {
  const ReadingScreen({super.key, this.initialBookId, this.soundOnly = false});
  final String? initialBookId;
  final bool soundOnly;

  @override
  State<ReadingScreen> createState() => _ReadingScreenState();
}

class _ReadingScreenState extends State<ReadingScreen> with WidgetsBindingObserver {
  final _lib = LibraryModel.instance;
  final _reading = ReadingStore.instance;
  final _settings = SettingsStore.instance;
  final _audio = Ambient.instance;
  bool _open = true;
  bool _volOpen = false;
  double? _dragVolume;
  String? _draftBookId;
  bool _appActive = true;
  double _panelHeight = 310;
  final _panelKey = GlobalKey();
  final _rowKey = GlobalKey();
  double _rowW = 0;
  double _swipeDx = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _draftBookId = widget.initialBookId;
    for (final n in [_lib, _reading, _settings, _audio]) {
      n.addListener(_changed);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final n in [_lib, _reading, _settings, _audio]) {
      n.removeListener(_changed);
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => setState(() => _appActive = state == AppLifecycleState.resumed);

  void _changed() {
    if (!mounted) return;
    // 재는 것도 소리도 없으면 조작부를 펼친다
    if (_reading.active == null && !widget.soundOnly && !_audio.playing) _open = true;
    setState(() {});
  }

  Library get lib => _lib.lib;
  String? get _bookId {
    final a = _reading.active;
    final id = a != null ? a.myBookId : _draftBookId;
    return id != null && lib.books[id] != null ? id : null;
  }

  // 읽는 중에 다른 책을 골랐을 때: '이 기록의 책 정정'과 '다른 책 읽기 시작'을 나눈다
  void _askSwitch(String? nextId) {
    final cur = _reading.active;
    if (cur == null) return;
    String title(String? id) => bookTitle(lib, id) ?? '책 없음';
    appAlert(context, '읽는 책을 바꿀까요?', '지금 ‘${title(cur.myBookId)}’를 읽는 중이에요.', [
      const AlertButton('계속 읽기', style: AlertStyle.cancel),
      AlertButton('이 기록의 책을 바꾸기', onPress: () {
        setState(() => _draftBookId = nextId);
        _reading.setBook(nextId, nextId == null ? null : lib.books[nextId]?.currentPage);
      }),
      AlertButton('지금까지 저장하고 새로 읽기', onPress: () {
        setState(() => _draftBookId = nextId);
        saveAndStartOther(nextId).catchError((Object e) {
          if (mounted) appAlert(context, '저장하지 못했어요', '$e');
          return null;
        });
      }),
    ]);
  }

  void _finish() {
    if (_reading.active == null) return;
    _reading.finish();
    Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => const FinishScreen()));
  }

  void _leave() => Navigator.of(context).maybePop();

  void _start() {
    if (_reading.active != null || _reading.pending != null) {
      if (_reading.pending != null) Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const FinishScreen()));
      return;
    }
    final id = _draftBookId != null && lib.books[_draftBookId] != null ? _draftBookId : null;
    _reading.start(id, id == null ? null : lib.books[id]?.currentPage);
    _audio.play(_settings.scene);
  }

  bool get _playing => widget.soundOnly ? _audio.playing : _reading.running;

  void _playPause() {
    if (widget.soundOnly) {
      _audio.playing ? _audio.pause() : _audio.play(_settings.scene);
    } else if (_reading.active == null) {
      _start();
    } else {
      _reading.running ? _reading.pause() : _reading.resume();
    }
  }

  // 장면 고르기: 배경과 환경음이 함께 바뀐다(소리가 나는 중이면 새 장면 소리로 바로 바꾼다)
  void _chooseScene(String id) {
    _settings.set({'scene': id});
    if (_audio.playing) _audio.play(id);
  }

  void _stepScene(int dir) {
    final i = scenes.indexWhere((x) => x.id == _settings.scene);
    _chooseScene(scenes[(i + dir + scenes.length) % scenes.length].id);
  }

  // 스피커: 닫혀 있으면 막대를 연다(음소거였으면 소리를 켠다), 열려 있으면 음소거하고 닫는다
  void _tapSpeaker() {
    if (!_volOpen) {
      if (_settings.muted) _settings.set({'muted': false});
      setState(() => _volOpen = true);
    } else {
      _settings.set({'muted': true});
      setState(() => _volOpen = false);
    }
  }

  String get _volumeText => _settings.muted && _dragVolume == null ? '음소거' : '${((_dragVolume ?? _settings.volume) * 100).round()}%';
  String get _playLabel => widget.soundOnly
      ? (_audio.playing ? '소리 멈추기' : '소리 재생')
      : _reading.active == null
          ? '독서 시작'
          : _reading.running
              ? '일시정지'
              : '다시 읽기';

  Future<void> _pickBook() async {
    final r = await pickBook(context, lib, allowNone: true);
    if (!r.picked || !mounted) return;
    final a = _reading.active;
    if (a != null && a.myBookId != r.id) {
      _askSwitch(r.id);
    } else {
      setState(() => _draftBookId = r.id);
    }
  }

  void _goalSheet() => showSheet<void>(
        context,
        title: '목표 시간',
        description: '목표를 바꿔도 읽은 시간은 유지돼요.',
        scroll: true,
        maxHeight: 0.85,
        builder: (ctx) {
          void pick(int? min) {
            _settings.set({'goalMin': min});
            Navigator.pop(ctx);
          }

          final big = MediaQuery.textScalerOf(ctx).scale(10) >= 16 || MediaQuery.sizeOf(ctx).width < 330;
          final goal = _settings.goalMin;
          final tiles = [for (final m in _goals) Choice(label: '$m분', compact: !big, selected: goal == m, onPress: () => pick(m))];
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Choice(label: '목표 없이 읽기', selected: goal == null, onPress: () => pick(null)),
            const SizedBox(height: Space.s),
            if (big)
              for (final (i, t) in tiles.indexed) ...[if (i > 0) const SizedBox(height: Space.s), t]
            else
              Row(children: [for (final (i, t) in tiles.indexed) ...[if (i > 0) const SizedBox(width: Space.s), Expanded(child: t)]]),
          ]);
        },
      );

  void _moodSheet() => showSheet<void>(
        context,
        title: '분위기',
        description: '장면과 소리가 함께 바뀌어요.',
        scroll: true,
        maxHeight: 0.88,
        builder: (ctx) => ListenableBuilder(
          listenable: Listenable.merge([_settings, _audio, _reading]),
          builder: (ctx, _) {
            final size = MediaQuery.sizeOf(ctx);
            final oneColumn = size.width < 340 || MediaQuery.textScalerOf(ctx).scale(10) >= 15;
            final tileW = oneColumn ? size.width - 48 : (size.width - 48 - 12) / 2;
            final posterW = tileW - 16 - 3;
            final active = _reading.active != null;
            Widget tile(SceneInfo sc) {
              final on = _settings.scene == sc.id;
              return Semantics(
                selected: on,
                button: true,
                label: sceneName(sc.id),
                child: GestureDetector(
                  onTap: () => _chooseScene(sc.id),
                  child: Container(
                    width: tileW,
                    padding: const EdgeInsets.fromLTRB(Space.s, Space.s, Space.s, Space.m),
                    decoration: BoxDecoration(
                      color: AppColors.bg,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: on ? AppColors.accent : AppColors.line, width: 1.5),
                    ),
                    child: Stack(children: [
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.asset(scenePosters[sc.id]!, width: posterW, height: (posterW / (oneColumn ? 2 : 4 / 3)).roundToDouble(), fit: BoxFit.cover),
                        ),
                        Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(sceneName(sc.id), style: AppType.button.copyWith(color: AppColors.ink))),
                      ]),
                      if (on)
                        Positioned(
                          top: 14 - Space.s - 1.5,
                          right: 14 - Space.s - 1.5,
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: const BoxDecoration(color: AppColors.accent, shape: BoxShape.circle),
                            child: const Center(child: LucideIcon('Check', size: 13, color: AppColors.onAccent, stroke: 3)),
                          ),
                        ),
                    ]),
                  ),
                ),
              );
            }

            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
              if (oneColumn)
                for (final (i, sc) in scenes.indexed) ...[if (i > 0) const SizedBox(height: Space.m), tile(sc)]
              else
                Row(children: [for (final (i, sc) in scenes.indexed) ...[if (i > 0) const SizedBox(width: Space.m), tile(sc)]]),
              Padding(
                padding: const EdgeInsets.only(top: Space.xl),
                child: Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                  Expanded(child: Text('소리 크기', style: AppType.label)),
                  Text(_volumeText, style: AppType.sub.copyWith(fontFeatures: _tabular)),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.only(top: Space.xs),
                child: Row(children: [
                  Semantics(
                    button: true,
                    selected: _settings.muted,
                    label: _settings.muted ? '음소거 해제' : '음소거',
                    child: Pressable(
                      onPress: () => _settings.set({'muted': !_settings.muted}),
                      child: Container(
                        width: Space.touch,
                        height: Space.touch,
                        decoration: BoxDecoration(shape: BoxShape.circle, border: _settings.muted ? Border.all(color: AppColors.track) : null),
                        child: Center(child: LucideIcon(_settings.muted ? 'VolumeX' : 'Volume2', color: _settings.muted ? AppColors.accent : AppColors.ink)),
                      ),
                    ),
                  ),
                  const SizedBox(width: Space.s),
                  Expanded(
                    child: AppSlider(
                      label: '소리 크기',
                      value: _dragVolume ?? _settings.volume,
                      dim: _settings.muted && _dragVolume == null,
                      valueText: _volumeText,
                      onChange: (v) {
                        setState(() => _dragVolume = v);
                        _audio.preview(v);
                      },
                      onCommit: (v) {
                        setState(() => _dragVolume = null);
                        _settings.set({'volume': (v * 100).round() / 100, 'muted': false});
                      },
                    ),
                  ),
                ]),
              ),
              // 소리 묶음: 회색 상자 대신 위 얇은 선과 여백으로 나눈다
              Container(
                margin: const EdgeInsets.only(top: Space.xl),
                padding: const EdgeInsets.only(top: Space.xl),
                decoration: BoxDecoration(border: Border(top: BorderSide(color: AppColors.line, width: 1 / MediaQuery.devicePixelRatioOf(ctx)))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(active ? '소리' : '소리만 듣기', style: AppType.label),
                  Padding(
                    padding: const EdgeInsets.only(top: Space.xs),
                    child: Text(active ? '소리는 독서 타이머와 따로 켜고 꺼요. 읽은 시간은 그대로예요.' : '시간을 재지 않고 소리만 들어요. 독서 시간에는 쌓이지 않아요.', style: AppType.sub),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: Space.m),
                    child: Btn(
                      label: _audio.playing ? (active ? '소리 끄기' : '소리 멈추기') : active ? '소리 켜기' : '소리만 듣기',
                      kind: 'secondary',
                      onPress: () => _audio.playing ? _audio.pause() : _audio.play(_settings.scene),
                    ),
                  ),
                ]),
              ),
            ]);
          },
        ),
      );

  void _measure() {
    final p = _panelKey.currentContext?.size?.height;
    final r = _rowKey.currentContext?.size?.width;
    if ((p != null && _open && (p - _panelHeight).abs() > 0.5) || (r != null && (r - _rowW).abs() > 0.5)) {
      setState(() {
        if (p != null && _open) _panelHeight = p;
        if (r != null) _rowW = r;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _measure();
    });
    final insets = MediaQuery.paddingOf(context);
    final size = MediaQuery.sizeOf(context);
    final vh = size.height;
    final active = _reading.active;
    final running = _reading.running;
    final scene = _settings.scene;
    final reduce = _settings.reduceMotion == 'on' || (_settings.reduceMotion == 'system' && MediaQuery.disableAnimationsOf(context));
    final animate = _appActive && !reduce && (ModalRoute.of(context)?.isCurrent ?? true);
    final ticking = _appActive && running;
    final goalMin = _settings.goalMin;
    final goalMs = goalMin == null ? null : goalMin * 60000;
    final soundOnly = widget.soundOnly;
    final bookId = _bookId;
    final sceneH = _open ? math.max(vh * 0.3, vh - _panelHeight + 22) : vh;

    final top = Positioned(
      left: 0,
      right: 0,
      top: 0,
      child: Padding(
        padding: EdgeInsets.fromLTRB(12, insets.top + 6, 12, 16),
        child: Column(children: [
          Row(children: [
            Semantics(
              button: true,
              label: active != null ? '나가기(독서는 계속)' : '책장으로',
              child: Pressable(onPress: _leave, child: const SizedBox(width: 52, height: Space.touch, child: Center(child: LucideIcon('ChevronLeft', size: 28, color: _light)))),
            ),
            Expanded(child: Text(soundOnly ? '소리 듣기' : '읽기', textAlign: TextAlign.center, style: AppType.title.copyWith(color: _light, shadows: _shade))),
            Semantics(
              button: true,
              label: soundOnly ? '소리 끄고 나가기' : active != null ? '독서 끝내기' : '닫기',
              child: Pressable(
                onPress: soundOnly
                    ? () {
                        _audio.stop();
                        _leave();
                      }
                    : active != null
                        ? _finish
                        : _leave,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 52, minHeight: Space.touch),
                  child: Center(child: Text(active != null || soundOnly ? '끝내기' : '닫기', style: AppType.button.copyWith(fontSize: 15, color: _light, shadows: _shade))),
                ),
              ),
            ),
          ]),
          // 왼쪽 지금 장면(소리), 오른쪽 읽는 책 이름
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
            child: Row(children: [
              const LucideIcon('AudioLines', size: 18, color: _light, stroke: 1.9),
              const SizedBox(width: 8),
              Text(sceneName(scene), style: AppType.sub.copyWith(color: _light, shadows: _shade)),
              const SizedBox(width: Space.m),
              Expanded(
                child: !soundOnly && bookId != null
                    ? Text(bookTitle(lib, bookId) ?? '', textAlign: TextAlign.right, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub.copyWith(color: _light, shadows: _shade))
                    : const SizedBox.shrink(),
              ),
            ]),
          ),
        ]),
      ),
    );

    final panel = Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: Offstage(
        offstage: !_open,
        child: Container(
          key: _panelKey,
          constraints: BoxConstraints(maxHeight: vh * 0.65),
          decoration: const BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.vertical(top: Radius.circular(Shape.sheet))),
          clipBehavior: Clip.antiAlias,
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(Space.page, Space.m, Space.page, insets.bottom + Space.m),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              // 1) 연결된 책(실제 표지·제목). 누르면 바꾸기, 책 없이 시작해도 된다
              Row(children: [
                Expanded(
                  child: Semantics(
                    button: true,
                    label: bookId != null ? '책 변경' : '책 연결하기',
                    child: Pressable(
                      onPress: _pickBook,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(minHeight: 60),
                        child: Row(children: [
                          if (!soundOnly && bookId != null)
                            IgnorePointer(child: LinkedCover(lib: lib, id: bookId, width: 44))
                          else
                            Container(
                              width: 44,
                              height: 56,
                              decoration: BoxDecoration(
                                color: AppColors.surface,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: AppColors.line, width: 2 / MediaQuery.devicePixelRatioOf(context)),
                              ),
                              child: const Center(child: LucideIcon('BookOpen', color: AppColors.inkSoft)),
                            ),
                          const SizedBox(width: Space.m),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(soundOnly ? '소리와 함께 쉬어 가요' : bookTitle(lib, bookId) ?? '책 연결하기', maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
                              const SizedBox(height: Space.xs),
                              Text(soundOnly ? '독서 시간은 기록하지 않아요' : bookId != null ? '책 변경' : '책 없이 시작해도 좋아요', style: AppType.caption),
                            ]),
                          ),
                        ]),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: Space.s),
                Semantics(
                  button: true,
                  label: '조작부 접기',
                  child: Pressable(
                    onPress: () => setState(() => _open = false),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: Space.touch, minHeight: 48),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        const LucideIcon('ChevronDown', color: AppColors.inkSoft),
                        const SizedBox(height: 2),
                        Text('접기', style: AppType.caption),
                      ]),
                    ),
                  ),
                ),
              ]),
              // 2) 시간(가장 크게, 숫자 폭 고정). 아래 한 줄은 자리를 늘 지켜 멈춰도 시간이 위아래로 흔들리지 않는다
              if (!soundOnly)
                Semantics(
                  button: true,
                  label: '목표 시간 설정, ${goalMin != null ? '$goalMin분' : '자유롭게 시간 재기'}',
                  child: GestureDetector(
                    onTap: _goalSheet,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: Space.l),
                      child: Column(children: [
                        _Elapsed(
                          running: ticking,
                          builder: (ms) => Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
                            Text(clock(ms), style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 48, height: 56 / 48, color: AppColors.ink, fontFeatures: _tabular)),
                            Positioned(
                              left: -100,
                              right: -100,
                              bottom: -19, // 지금 앱: 시간 칸 아래 여백(16) 안에 겹쳐 칸 바닥보다 3 아래
                              child: Text(
                                active != null && !running
                                    ? '일시정지'
                                    : goalMs != null
                                        ? (ms >= goalMs ? '목표 $goalMin분을 채웠어요' : '목표 $goalMin분')
                                        : ' ',
                                textAlign: TextAlign.center,
                                style: AppType.caption,
                              ),
                            ),
                          ]),
                        ),
                        if (_reading.error != null)
                          Text('독서 시간을 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.', textAlign: TextAlign.center, style: AppType.caption.copyWith(color: AppColors.danger)),
                      ]),
                    ),
                  ),
                ),
              // 3) [분위기 | 재생·일시정지 | 목표]
              Padding(
                padding: const EdgeInsets.only(top: Space.xs),
                child: Row(children: [
                  Expanded(
                    child: _Side(
                      icon: 'AudioLines',
                      text: sceneName(scene),
                      label: '분위기 고르기, ${sceneName(scene)}, ${_settings.muted ? '음소거' : '소리 ${(_settings.volume * 100).round()}%'}',
                      onPress: _moodSheet,
                    ),
                  ),
                  _Round(playing: _playing, label: _playLabel, onPress: _playPause),
                  Expanded(
                    child: soundOnly
                        ? const SizedBox.shrink()
                        : _Side(icon: 'Timer', text: goalMin != null ? '목표 $goalMin분' : '목표 없음', label: '목표 시간, ${goalMin != null ? '$goalMin분' : '목표 없음'}', onPress: _goalSheet),
                  ),
                ]),
              ),
              if (_audio.error != null) Padding(padding: const EdgeInsets.only(top: Space.m), child: Text(_audio.error!, style: AppType.sub.copyWith(color: AppColors.danger))),
              // 소리만 듣다가 기록 시작: 같은 장면에 타이머를 띄운다
              if (soundOnly)
                Padding(
                  padding: const EdgeInsets.only(top: Space.s),
                  child: Btn(
                    label: '지금부터 독서 기록',
                    kind: 'ghost',
                    onPress: () {
                      _start();
                      Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => const ReadingScreen()));
                    },
                  ),
                ),
            ]),
          ),
        ),
      ),
    );

    // 접었을 때: 장면 아래쪽을 어둡게 물들이고 그 위에 장면 점, [스피커 · 밝은 시간 · 재생·일시정지]. 시간을 누르면 조작부가 다시 열린다
    final folded = <Widget>[
      Positioned(
        left: 0,
        right: 0,
        bottom: 0,
        height: (vh * 0.42).roundToDouble(),
        child: const IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x00100D0B), Color(0x66100D0B), Color(0xC2100D0B)],
                stops: [0, 0.5, 1],
              ),
            ),
          ),
        ),
      ),
      if (_volOpen) Positioned.fill(child: Semantics(label: '소리 크기 닫기', child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => setState(() => _volOpen = false)))),
      Positioned(
        left: 0,
        right: 0,
        bottom: insets.bottom + 18,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          // 장면 점(지금 장면). 점을 눌러도 바뀐다
          Semantics(
            label: '장면, ${sceneName(scene)}',
            hint: '옆으로 밀어 장면을 바꿔요',
            onIncrease: () => _stepScene(1),
            onDecrease: () => _stepScene(-1),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                for (final (i, sc) in scenes.indexed) ...[
                  if (i > 0) const SizedBox(width: 10),
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => _chooseScene(sc.id),
                    child: Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: sc.id == scene ? NightColors.ink : const Color.fromRGBO(246, 239, 230, 0.42)),
                    ),
                  ),
                ],
              ]),
            ),
          ),
          // 소리 막대: 스피커 줄과 같은 폭으로 그 위에, 왼쪽(스피커 쪽)부터 찬다. 맨 왼쪽까지 내리면 음소거
          if (_volOpen && _rowW > 0)
            Padding(
              padding: const EdgeInsets.only(top: Space.s),
              child: SizedBox(
                width: _rowW + 2 * Space.s,
                child: AppSlider(
                  night: true,
                  label: '소리 크기',
                  value: _dragVolume ?? (_settings.muted ? 0 : _settings.volume),
                  valueText: _volumeText,
                  onChange: (v) {
                    setState(() => _dragVolume = v);
                    _audio.preview(v);
                  },
                  onCommit: (v) {
                    setState(() => _dragVolume = null);
                    _settings.set(v <= 0.02 ? {'muted': true} : {'volume': (v * 100).round() / 100, 'muted': false});
                  },
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(top: Space.s),
            child: Row(key: _rowKey, mainAxisSize: MainAxisSize.min, children: [
              Semantics(
                button: true,
                expanded: _volOpen,
                label: _settings.muted
                    ? '소리 꺼짐, 눌러서 소리 켜기'
                    : _volOpen
                        ? '소리 ${(_settings.volume * 100).round()}%, 눌러서 음소거'
                        : '소리 ${(_settings.volume * 100).round()}%, 눌러서 크기 조절',
                child: Pressable(
                  onPress: _tapSpeaker,
                  child: SizedBox(
                    width: Space.touch,
                    height: Space.touch,
                    child: Center(child: LucideIcon(_settings.muted ? 'VolumeX' : 'Volume2', size: 26, color: _settings.muted ? NightColors.inkSoft : NightColors.ink)),
                  ),
                ),
              ),
              const SizedBox(width: Space.xl),
              Semantics(
                button: true,
                label: '조작부 열기',
                child: Pressable(
                  onPress: () => setState(() {
                    _volOpen = false;
                    _open = true;
                  }),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: Space.touch),
                    child: Center(
                      child: soundOnly
                          ? Text('조작부 열기', style: _dockTime)
                          : _Elapsed(running: ticking, builder: (ms) => Text(clock(ms), style: _dockTime)),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: Space.xl),
              Semantics(
                button: true,
                label: _playLabel,
                child: Pressable(
                  onPress: _playPause,
                  child: SizedBox(
                    width: Space.touch,
                    height: Space.touch,
                    child: Center(child: _playing ? const PauseIcon(width: 5, height: 24, gap: 6, color: NightColors.ink) : const PlayIcon(size: 30, color: NightColors.ink)),
                  ),
                ),
              ),
            ]),
          ),
        ]),
      ),
    ];

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Material(
        color: const Color(0xFF182C44),
        child: Stack(children: [
          Positioned(left: 0, top: 0, width: size.width, height: sceneH, child: SceneVideo(id: scene, play: animate)),
          // 옆으로 밀어 장면 바꾸기: 왼쪽으로 밀면 다음 장면, 끝에서는 처음으로 돈다
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onHorizontalDragStart: (_) => _swipeDx = 0,
              onHorizontalDragUpdate: (d) => _swipeDx += d.delta.dx,
              onHorizontalDragEnd: (d) {
                final v = d.primaryVelocity ?? 0;
                if (_swipeDx.abs() > 60 || v.abs() > 500) _stepScene((_swipeDx != 0 ? _swipeDx : v) < 0 ? 1 : -1);
              },
            ),
          ),
          top,
          panel,
          if (!_open) ...folded,
        ]),
      ),
    );
  }
}

const _dockTime = TextStyle(fontFamily: AppFonts.ui, fontSize: 34, height: 42 / 34, color: NightColors.ink, fontFeatures: _tabular, shadows: _shade);

/// 1초마다 바뀌는 시간 글자만 다시 그린다(장면·조작부까지 매초 다시 그리지 않게)
class _Elapsed extends StatefulWidget {
  const _Elapsed({required this.running, required this.builder});
  final bool running;
  final Widget Function(num ms) builder;

  @override
  State<_Elapsed> createState() => _ElapsedState();
}

class _ElapsedState extends State<_Elapsed> {
  Timer? _t;

  void _sync() {
    if (widget.running) {
      _t ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else {
      _t?.cancel();
      _t = null;
    }
  }

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(_Elapsed old) {
    super.didUpdateWidget(old);
    _sync();
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(ReadingStore.instance.elapsed);
}

/// 조작부 양옆 칸(분위기·목표): 아이콘 + 두 줄까지 글자
class _Side extends StatelessWidget {
  const _Side({required this.icon, required this.text, required this.label, required this.onPress});
  final String icon, text, label;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: Pressable(
          onPress: onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 60),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.xs),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                LucideIcon(icon, size: 26),
                const SizedBox(height: Space.xs),
                Text(text, maxLines: 2, textAlign: TextAlign.center, style: AppType.caption.copyWith(color: AppColors.ink)),
              ]),
            ),
          ),
        ),
      );
}

/// 가운데 둥근 재생 단추(단색 원): 누르는 동안 조금 작아지고 짙어진다
class _Round extends StatefulWidget {
  const _Round({required this.playing, required this.label, required this.onPress});
  final bool playing;
  final String label;
  final VoidCallback onPress;

  @override
  State<_Round> createState() => _RoundState();
}

class _RoundState extends State<_Round> {
  bool _down = false;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: widget.label,
        excludeSemantics: true,
        child: GestureDetector(
          onTapDown: (_) => setState(() => _down = true),
          onTapCancel: () => setState(() => _down = false),
          onTapUp: (_) => setState(() => _down = false),
          onTap: widget.onPress,
          child: Transform.scale(
            scale: _down ? 0.96 : 1,
            child: Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(shape: BoxShape.circle, color: _down ? AppColors.accentPressed : AppColors.accent),
              child: Center(child: widget.playing ? const PauseIcon(width: 7, height: 26, gap: 8, color: AppColors.onAccent) : const PlayIcon(size: 34, color: AppColors.onAccent)),
            ),
          ),
        ),
      );
}

/// 독서 장면 영상: 720×1280 세로 영상을 칸에 꽉 채운다(넘치는 위아래는 잘림). 영상 소리는 끄고 환경음과 섞는다.
/// 보이는 동안만 재생한다(나가거나 동작 줄이기면 멈춘 한 장면). 영상이 준비되기 전에는 같은 장면의 정지 그림
class SceneVideo extends StatefulWidget {
  const SceneVideo({super.key, required this.id, required this.play});
  final String id;
  final bool play;

  @override
  State<SceneVideo> createState() => _SceneVideoState();
}

class _SceneVideoState extends State<SceneVideo> {
  VideoPlayerController? _c;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(SceneVideo old) {
    super.didUpdateWidget(old);
    if (old.id != widget.id) {
      _c?.dispose();
      _c = null;
      _ready = false;
      _load();
    } else if (old.play != widget.play) {
      widget.play ? _c?.play() : _c?.pause();
    }
  }

  Future<void> _load() async {
    final c = VideoPlayerController.asset(_videos[widget.id]!, videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true));
    _c = c;
    try {
      await c.initialize();
      if (!identical(_c, c)) {
        await c.dispose();
        return;
      }
      await c.setLooping(true);
      await c.setVolume(0);
      if (widget.play) await c.play();
      if (mounted) setState(() => _ready = true);
    } catch (_) {
      // 영상을 못 열면 정지 그림으로 둔다
    }
  }

  @override
  void dispose() {
    _c?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return IgnorePointer(
      child: ClipRect(
        child: Stack(fit: StackFit.expand, children: [
          Image.asset(scenePosters[widget.id]!, fit: BoxFit.cover),
          if (_ready && c != null)
            FittedBox(fit: BoxFit.cover, clipBehavior: Clip.hardEdge, child: SizedBox(width: c.value.size.width, height: c.value.size.height, child: VideoPlayer(c))),
        ]),
      ),
    );
  }
}
