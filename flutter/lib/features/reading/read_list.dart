// 읽기 탭(지금 앱 features/reading/ReadList.tsx): 맨 위 오늘 날짜와 오늘 읽은 시간, 아래 책마다 [표지·재생 단추 · 책 이름(밑에 지은이) · 오늘 읽은 시간 · ⋮].
// 재생을 누르면 그 책으로 타이머가 시작되고 분위기 장면으로 넘어간다. 장면에서 뒤로 나오면 이 목록이다(타이머는 계속 돈다).
// 다른 책을 재는 중에 재생을 누르면 묻는다(앞 책 시간이 설명 없이 새 책으로 옮겨 가지 않게).
// 맨 아래 '+ 책 추가'는 여러 권을 골라 '완료'하면 목록에 더하기만 한다(시작은 재생 단추로). 추가해 둔 책은 기기에 남고 ⋮에서 뺀다
library;

import 'dart:async';

import 'package:flutter/material.dart';

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
import '../stats/stats_screen.dart';
import '../stats/stats_widgets.dart';
import 'finish_screen.dart';
import 'play_icons.dart';
import 'reading_screen.dart';

const _week = ['일', '월', '화', '수', '목', '금', '토'];
const _coverW = 42.0; // 표지 폭(높이는 표지 비율대로 약 62)
const _badge = 26.0; // 표지 위 재생 단추 지름
const _tabular = [FontFeature.tabularFigures()];

String? bookTitle(Library lib, String? id) {
  final b = id == null ? null : lib.books[id];
  return b == null ? null : lib.editions[b.editionId]?.title;
}

/// 아직 옮기지 않은 화면(분위기 장면·책 정보)
Future<void> _pending(BuildContext context, String title) => Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => Screen(title: title, children: const [Empty(title: '준비 중이에요', body: '이 화면은 다음 단계에서 옮겨요.')]),
    ));

class ReadList extends StatefulWidget {
  const ReadList({super.key, this.handoff});

  /// 책 정보·책장·기록에서 '읽기'로 넘겨받은 책
  final String? handoff;

  @override
  State<ReadList> createState() => _ReadListState();
}

class _ReadListState extends State<ReadList> {
  final _lib = LibraryModel.instance;
  final _reading = ReadingStore.instance;
  final _settings = SettingsStore.instance;
  String? _focusId;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    for (final n in [_lib, _reading, _settings]) {
      n.addListener(_changed);
    }
    _lib.load().then((_) => _takeHandoff());
    _reading.load().catchError((_) {});
    _settings.load();
    _sync();
  }

  @override
  void dispose() {
    for (final n in [_lib, _reading, _settings]) {
      n.removeListener(_changed);
    }
    _tick?.cancel();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    _sync();
    setState(() {});
  }

  // 재는 동안만 1초마다 다시 그린다
  void _sync() {
    if (_reading.running) {
      _tick ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else {
      _tick?.cancel();
      _tick = null;
    }
  }

  // 넘겨받은 책은 목록 맨 앞에 두고 추가해 둔다(시작은 재생을 눌러서)
  void _takeHandoff() {
    final h = widget.handoff;
    final b = h == null ? null : _lib.lib.books[h];
    if (b == null || !mounted) return;
    setState(() => _focusId = h);
    if (b.status != ReadStatus.reading) _addToList([h!]);
  }

  void _addToList(List<String> more) {
    final cur = _settings.readList;
    final next = [...cur, ...more.where((id) => !cur.contains(id))];
    if (next.length != cur.length) _settings.set({'readList': next});
  }

  void _openScene() => openReadingScene(context);

  void _startNew(String? id) {
    _reading.start(id, id == null ? null : _lib.lib.books[id]?.currentPage);
    Ambient.instance.play(_settings.scene);
    _openScene();
  }

  // 재생 단추(책마다): 재는 책이면 일시정지·다시 시작, 아니면 그 책으로 시작하고 장면으로
  void _begin(String? id) {
    if (_reading.pending != null) {
      Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/reading/finish'), builder: (_) => const FinishScreen())); // 끝냈지만 저장하지 않은 기록부터
      return;
    }
    final cur = _reading.active;
    if (cur == null) return _startNew(id);
    if (cur.myBookId == id) {
      if (cur.runningSince != null) return _reading.pause();
      _reading.resume();
      return _openScene();
    }
    final lib = _lib.lib;
    String title(String? b) => bookTitle(lib, b) ?? '책 없이 읽기';
    appAlert(context, '이 책을 읽을까요?', '지금 ‘${title(cur.myBookId)}’ 시간을 재는 중이에요.', [
      const AlertButton('계속 읽기', style: AlertStyle.cancel),
      AlertButton('이 기록의 책을 바꾸기', onPress: () {
        _reading.setBook(id, id == null ? null : lib.books[id]?.currentPage);
        _openScene();
      }),
      AlertButton('지금까지 저장하고 새로 읽기', onPress: () {
        saveAndStartOther(id).then((_) => _openScene(), onError: (Object e) {
          if (mounted) appAlert(context, '저장하지 못했어요', '$e');
        });
      }),
    ]);
  }

  // 줄을 누르면: 재는 책은 장면으로 돌아가고, 아니면 재생과 같다
  void _tapRow(String? id) => _reading.active != null && _reading.active!.myBookId == id ? _openScene() : _begin(id);

  void _menu(String id, String title, bool removable) => showSheet<void>(
        context,
        title: title,
        builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (id != noBook) ...[
            ListItem(label: '책 정보', chevron: true, onPress: () {
              Navigator.pop(ctx);
              _pending(context, '책 정보');
            }),
            ListItem(label: '이 책 독서 기록', chevron: true, onPress: () {
              Navigator.pop(ctx);
              Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => StatsScreen(tab: false, initialBook: id)));
            }),
          ],
          if (removable)
            ListItem(label: '목록에서 빼기', onPress: () {
              Navigator.pop(ctx);
              _settings.set({'readList': _settings.readList.where((x) => x != id).toList()});
              if (_focusId == id) setState(() => _focusId = null);
            }),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final lib = _lib.lib;
    final active = _reading.active;
    final running = _reading.running;
    final added = _settings.readList;
    final now = DateTime.now();
    final day = today(now);
    final liveMs = _reading.elapsed;
    final saved = todayRead(lib, day);
    final ids = readListIds(lib, day: day, activeId: active?.myBookId, focusId: _focusId, added: added);
    // 지금 재는 시간은 시작한 날의 몫으로 더한다(자정을 넘겨도 끝낼 때 시작 날짜로 저장되는 것과 같게)
    final activeToday = active != null && today(DateTime.parse(active.startedAt)) == day ? liveMs : 0;
    final total = saved.total + activeToday;
    num msOf(String id) => (saved.byBook[id] ?? 0) + (active?.myBookId == id ? activeToday : 0);
    final noBookActive = active != null && active.myBookId == null;
    final showNoBook = noBookActive || saved.noBook > 0 || added.contains(noBook);
    // 목록에서 빼기: 추가해 둔 줄만(읽는 중인 책·오늘 읽은 책·재는 책은 그 까닭으로 목록에 있어 빼도 남는다)
    bool removable(String id) =>
        added.contains(id) &&
        (id == noBook ? !noBookActive && saved.noBook == 0 : lib.books[id]?.status != ReadStatus.reading && !saved.byBook.containsKey(id) && active?.myBookId != id);

    Widget row(String? id) {
      final isActive = active != null && active.myBookId == id;
      final playing = isActive && running;
      final title = id != null ? bookTitle(lib, id) ?? '' : '책 없이 읽기';
      final ed = id == null ? null : lib.editions[lib.books[id]?.editionId ?? ''];
      final author = ed != null && ed.authors.isNotEmpty ? ed.authors.join(', ') : '';
      final ms = id != null ? msOf(id) : saved.noBook + (noBookActive ? activeToday : 0);
      final showMore = id != null || removable(noBook);
      return Semantics(
        key: ValueKey(id ?? '~none'),
        button: true,
        label: '$title${author.isNotEmpty ? ', $author' : ''}, 오늘 ${hms(ms)}${isActive ? (playing ? ', 읽는 중' : ', 일시정지') : ''}',
        child: Pressable(
          onPress: () => _tapRow(id),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 84),
            child: Row(children: [
              Semantics(
                button: true,
                label: playing ? '$title 일시정지' : '$title 읽기 시작',
                child: Pressable(
                  onPress: () => _begin(id),
                  pressedOpacity: 0.7,
                  child: SizedBox(
                    width: _coverW + 6,
                    child: Stack(clipBehavior: Clip.none, children: [
                      IgnorePointer(
                        child: id != null
                            ? LinkedCover(lib: lib, id: id, width: _coverW)
                            : Container(
                                width: _coverW,
                                height: (_coverW / 0.68).roundToDouble(),
                                decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(4)),
                                child: const Center(child: LucideIcon('BookOpen', color: AppColors.inkSoft)),
                              ),
                      ),
                      // 재생 단추: 표지 오른쪽 아래에 걸친 작은 원(대표색 + 흰 테두리, 2026-11-14 사용자 '대표색으로'). 재생·일시정지는 안의 모양으로 가른다
                      Positioned(
                        right: 0,
                        bottom: -4,
                        child: Container(
                          width: _badge,
                          height: _badge,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: AppColors.accent,
                            border: Border.all(color: AppColors.white, width: 2),
                          ),
                          child: Center(
                            child: playing ? const PauseIcon(width: 3.5, height: 11, gap: 3.5, color: AppColors.onAccent) : const PlayIcon(size: 15, color: AppColors.onAccent),
                          ),
                        ),
                      ),
                    ]),
                  ),
                ),
              ),
              const SizedBox(width: Space.m),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: isActive ? AppType.row.copyWith(fontFamily: AppFonts.uiBold) : AppType.row),
                  if (author.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(author, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 14, height: 20 / 14, color: AppColors.inkSoft)),
                    ),
                ]),
              ),
              const SizedBox(width: Space.m),
              Text(hms(ms),
                  style: TextStyle(fontFamily: AppFonts.ui, fontSize: 18, height: 26 / 18, color: ms == 0 && !isActive ? AppColors.inkSoft : AppColors.ink, fontFeatures: _tabular)),
              const SizedBox(width: Space.m - Space.s),
              SizedBox(
                width: 28 - Space.s,
                height: Space.touch,
                child: OverflowBox(
                  maxWidth: 28,
                  alignment: Alignment.centerLeft,
                  child: showMore
                      ? Semantics(
                          button: true,
                          label: '$title 더 보기',
                          child: Pressable(
                            onPress: () => _menu(id ?? noBook, id == null ? '책 없이 읽기' : title, removable(id ?? noBook)),
                            child: const SizedBox(width: 28, height: Space.touch, child: Center(child: LucideIcon('MoreVertical', color: AppColors.inkSoft))),
                          ),
                        )
                      : const SizedBox(width: 28),
                ),
              ),
            ]),
          ),
        ),
      );
    }

    final hasRows = ids.isNotEmpty || showNoBook;
    Future<void> openPicker() async {
      final picked = await pickBooks(context, lib, MultiPick(fixed: showNoBook ? [...ids, noBook] : ids, none: noBook), allowNone: true);
      if (picked.isNotEmpty) _addToList(picked);
    }

    return Screen(
      back: false,
      bottomPad: TabBarStyle.contentPad - Space.section,
      children: [
        // 머리: 가운데 오늘 날짜, 오른쪽 소리만 듣기(시간을 재지 않는 분위기 장면)
        Padding(
          padding: const EdgeInsets.only(top: Space.xs),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: Row(children: [
              const SizedBox(width: 56),
              Expanded(
                child: Semantics(header: true, child: Text('${now.month}. ${now.day} (${_week[now.weekday % 7]})', textAlign: TextAlign.center, style: AppType.navTitle)),
              ),
              SizedBox(
                width: 56,
                child: Align(
                  alignment: Alignment.centerRight,
                  child: IconBtn(label: '소리만 듣기', onPress: () => openReadingScene(context, soundOnly: true), child: const LucideIcon('AudioLines')),
                ),
              ),
            ]),
          ),
        ),
        // 오늘 읽은 시간(모든 책 + 책 없이)
        Padding(
          padding: const EdgeInsets.only(top: Space.xl, bottom: Space.xxl),
          child: Column(children: [
            Semantics(
              label: '오늘 읽은 시간 ${hms(total)}',
              child: Text(hms(total), style: const TextStyle(fontFamily: AppFonts.uiTitle, fontSize: 56, height: 64 / 56, color: AppColors.ink, fontFeatures: _tabular)),
            ),
            Padding(
              padding: const EdgeInsets.only(top: Space.s),
              child: Text(active != null ? (running ? '읽는 중' : '일시정지') : '오늘 읽은 시간', style: AppType.caption),
            ),
          ]),
        ),
        SizedBox(
          height: 1 / MediaQuery.devicePixelRatioOf(context),
          child: OverflowBox(maxWidth: double.infinity, child: Container(width: MediaQuery.sizeOf(context).width, color: AppColors.line)),
        ),
        if (hasRows)
          Padding(
            padding: const EdgeInsets.only(top: Space.s),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final id in ids) row(id), if (showNoBook) row(null)]),
          )
        else
          Padding(
            padding: const EdgeInsets.only(top: Space.xxl, bottom: Space.m),
            child: Column(children: [
              Text('타이머에 책을 추가해 보세요', style: AppType.heading),
              Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: Text('읽을 책을 여러 권 골라 두고\n재생 단추로 시간을 재요.', textAlign: TextAlign.center, style: AppType.sub),
              ),
            ]),
          ),
        // 목록에 없는 책(읽을 책·다 읽은 책)이나 책 없이 읽기를 여러 개 골라 더한다
        if (hasRows)
          Semantics(
            button: true,
            label: '책 추가',
            child: Pressable(
              onPress: openPicker,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 84),
                child: Row(children: [
                  const SizedBox(width: _coverW + 6, child: Padding(padding: EdgeInsets.only(left: 9), child: Align(alignment: Alignment.centerLeft, child: LucideIcon('Plus', color: AppColors.inkSoft)))),
                  const SizedBox(width: Space.m),
                  Expanded(child: Text('책 추가', style: AppType.row.copyWith(color: AppColors.inkSoft))),
                ]),
              ),
            ),
          )
        else
          Padding(padding: const EdgeInsets.only(top: Space.l), child: Btn(label: '책 추가', onPress: openPicker)),
      ],
    );
  }
}
