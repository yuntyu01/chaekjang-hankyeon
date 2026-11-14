// 기록 탭: 캘린더(날마다 읽은 책) · 기록(기간 독서 시간·시간대·한 번 길이·요일·많이 읽은 책·완독·갈피). 지금 앱 features/stats/StatsScreen.tsx를 옮긴 것.
// 책을 고르면 달력·그래프·숫자가 그 책만으로 바뀐다. 오늘이 든 달(해) 다음으로는 가지 않는다
library;

import 'package:flutter/material.dart';

import '../../domain/library.dart' hide today;
import '../../domain/library.dart' as lib_d show today;
import '../../store/library_model.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'session_edit_screen.dart' show openSessionEdit;
import 'chart_data.dart';
import 'stats_widgets.dart';

const _coverW = 52.0;
String _shortMs(num ms) => ms < 60000 ? formatDurationPrecise(ms) : formatDuration(ms);

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key, this.tab = true, this.initialBook});

  /// 하단 '기록' 탭(뒤로 없음, 탭 바만큼 아래를 비운다)
  final bool tab;
  final String? initialBook;

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  final _model = LibraryModel.instance;
  Library? get _lib => _model.loaded ? _model.lib : null;
  String _view = 'calendar';
  bool _yearly = false;
  late int _y;
  late int _m;
  String? _book;
  String? _picked;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _y = now.year;
    _m = now.month;
    _book = widget.initialBook;
    _model.addListener(_changed);
    _model.load();
  }

  @override
  void dispose() {
    _model.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  bool get _monthly => _view == 'calendar' || !_yearly;

  void _shift(int k) => setState(() {
        _picked = null;
        if (!_monthly) {
          _y += k;
          return;
        }
        var mm = _m + k, yy = _y;
        if (mm < 1) {
          mm = 12;
          yy--;
        } else if (mm > 12) {
          mm = 1;
          yy++;
        }
        _m = mm;
        _y = yy;
      });

  @override
  Widget build(BuildContext context) {
    final lib = _lib;
    if (lib == null) return const Screen(back: false, title: '기록', children: [Loading()]);
    final now = DateTime.now();
    final monthly = _monthly;
    final book = _book != null && lib.books.containsKey(_book) ? _book : null;
    final period = monthly ? monthPeriod(_y, _m) : yearPeriod(_y);
    final st0 = periodStats(lib, period, book);
    final sessions = st0.sessions;
    final bars = monthly ? monthBars(sessions, _y, _m) : yearBars(sessions, _y);
    final days = booksByDay(sessions);
    final lastKey = bars.reversed.where((b) => b.ms > 0).firstOrNull?.key;
    final selected = _picked != null && bars.any((b) => b.key == _picked && b.ms > 0) ? _picked : lastKey;
    final selMs = bars.where((b) => b.key == selected).firstOrNull?.ms ?? 0;
    final activeDays = sessions.map(sessionDay).toSet().length;
    final selSessions = [for (final s in sessions) if (selected != null && sessionDay(s).startsWith(selected)) s];
    String? title(String? id) => id == null ? null : lib.editions[lib.books[id]?.editionId]?.title;
    final thisPeriod = monthly ? _y == now.year && _m == now.month : _y == now.year;
    final periodName = thisPeriod ? (monthly ? '이번 달' : '올해') : monthly ? '$_m월' : '$_y년';
    final today = lib_d.today(now);
    Widget cover(String? id) => id != null && lib.books.containsKey(id)
        ? LinkedCover(lib: lib, id: id, width: _coverW)
        : const RealCover(title: '책 없음', color: '#F2F4F6', width: _coverW, ratio: 0.7);
    const rowValue = TextStyle(fontFamily: AppFonts.uiBold, fontSize: 19, height: 26 / 19, color: AppColors.ink, fontFeatures: [FontFeature.tabularFigures()]);
    Widget row({required String? id, required String label, required Widget middle, required Widget right, VoidCallback? onPress}) => Semantics(
          button: onPress != null,
          label: label,
          child: Pressable(
            onPress: onPress,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: Space.m),
              child: Row(children: [
                SizedBox(width: _coverW, child: Center(child: cover(id))),
                const SizedBox(width: Space.l),
                Expanded(child: middle),
                const SizedBox(width: Space.l),
                right,
              ]),
            ),
          ),
        );

    final children = <Widget>[
      Padding(
        padding: EdgeInsets.only(top: widget.tab ? Space.s : 0),
        child: Segmented<String>(
          items: const [('calendar', '캘린더'), ('records', '기록')],
          value: _view,
          onChange: (v) => setState(() {
            _view = v;
            _picked = null;
          }),
        ),
      ),
      // 책 선택은 두 칸 모두 같은 자리: 달력·그래프·숫자가 함께 바뀐다
      Padding(
        padding: const EdgeInsets.only(top: Space.s),
        child: Align(alignment: Alignment.centerRight, child: FilterButton(plain: true, label: title(book) ?? '모든 책', active: book != null, onPress: () => _pickBook(lib))),
      ),
      if (_view == 'records' && book != null) BookRecordView(lib: lib, id: book),
      Padding(
        padding: const EdgeInsets.only(top: Space.s, bottom: Space.l),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          IconBtn(label: monthly ? '이전 달' : '이전 해', onPress: () => _shift(-1), child: const LucideIcon('ChevronLeft')),
          const SizedBox(width: Space.l),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 168),
            child: Semantics(
              header: true,
              child: Text(monthly ? '$_y년 $_m월' : '$_y년', textAlign: TextAlign.center, style: AppType.title.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
            ),
          ),
          const SizedBox(width: Space.l),
          IconBtn(
            label: monthly ? '다음 달' : '다음 해',
            disabled: monthly ? _y * 12 + _m >= now.year * 12 + now.month : _y >= now.year,
            onPress: () => _shift(1),
            child: const LucideIcon('ChevronRight'),
          ),
        ]),
      ),
      if (_view == 'records')
        Padding(
          padding: const EdgeInsets.only(bottom: Space.l),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            AppChip(label: '월별', on: !_yearly, onPress: () => setState(() {
              _yearly = false;
              _picked = null;
            })),
            const SizedBox(width: Space.s),
            AppChip(label: '연도별', on: _yearly, onPress: () => setState(() {
              _yearly = true;
              _picked = null;
            })),
          ]),
        ),
      if (_view == 'calendar')
        ReadingCalendar(lib: lib, y: _y, m: _m, days: days, selected: selected, today: today, onSelect: (d) => setState(() => _picked = d))
      else
        ReadingChart(bars: bars, selected: selected, unit: monthly ? '일' : '월', onSelect: (k) => setState(() => _picked = k)),
      if (_view == 'records') ..._records(lib, st0, sessions, activeDays, periodName, title, row, rowValue),
      if (_view == 'calendar')
        if (selected != null) ...[
          const SectionBand(),
          Padding(
            padding: const EdgeInsets.only(bottom: Space.s),
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.only(bottom: Space.s),
                child: Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                  Expanded(child: Semantics(header: true, child: Text(monthly ? dayTitle(selected) : '$_y년 ${int.parse(selected.substring(5))}월', style: AppType.section))),
                  Text(formatDuration(selMs), style: AppType.sub),
                ]),
              ),
              for (final s in selSessions)
                row(
                  id: s.myBookId,
                  onPress: () => openSessionEdit(context, s.id),
                  label: '${title(s.myBookId) ?? '책 없음'}, ${timeRange(s.startedAt, s.endedAt)}, ${_shortMs(s.durationMs)}',
                  middle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title(s.myBookId) ?? '책 없음', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
                    Padding(padding: const EdgeInsets.only(top: 2), child: Text(timeRange(s.startedAt, s.endedAt), maxLines: 1, style: AppType.sub)),
                  ]),
                  right: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(_shortMs(s.durationMs), style: rowValue),
                    if (hasPause(s)) Text('실제 독서', style: AppType.caption),
                  ]),
                ),
            ]),
          ),
        ] else
          Empty(
            title: '$periodName에는 독서 기록이 없어요',
            body: book != null && title(book) != null ? '${title(book)} 기준이에요.' : thisPeriod ? '책을 읽으면 그날이 달력에 칠해져요.' : null,
          ),
    ];
    return Screen(
      back: !widget.tab,
      title: widget.tab ? null : '내 기록',
      // 떠 있는 하단바 아래까지 내용이 내려가게
      bottomPad: widget.tab ? TabBarStyle.contentPad - Space.section : 0,
      children: children,
    );
  }

  List<Widget> _records(Library lib, PeriodStats st0, List<Session> sessions, int activeDays, String periodName, String? Function(String?) title,
      Widget Function({required String? id, required String label, required Widget middle, required Widget right, VoidCallback? onPress}) row, TextStyle rowValue) {
    final summary = sessionSummary(sessions);
    final hours = hourBars(sessions), lengths = lengthBins(sessions), wd = weekdayBars(sessions);
    final top = topBooks(sessions, 3).where((r) => lib.books.containsKey(r.id)).toList();
    const empty = '이 기간에는 기록이 없어요.';
    return [
      Padding(
        padding: const EdgeInsets.only(top: Space.l, bottom: Space.s),
        child: Semantics(header: true, child: Text('$periodName 독서', maxLines: 1, style: AppType.row)),
      ),
      Semantics(
        label: '$periodName 독서 ${formatDuration(st0.readMs)}, 일시정지 제외, 읽은 날 $activeDays일, 독서 ${sessions.length}회',
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(formatDuration(st0.readMs),
              style: const TextStyle(fontFamily: AppFonts.uiTitle, fontSize: 36, height: 44 / 36, color: AppColors.ink, fontFeatures: [FontFeature.tabularFigures()])),
          Padding(padding: const EdgeInsets.only(top: Space.xs), child: Text('읽은 날 $activeDays일 · 독서 ${sessions.length}회', style: AppType.sub)),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.only(top: Space.l),
        child: Row(children: [
          StatNumber(label: '한 번 평균', value: summary.count > 0 ? _shortMs(summary.averageMs) : '-'),
          const SizedBox(width: Space.m),
          StatNumber(label: '가장 길게', value: summary.count > 0 ? _shortMs(summary.longestMs) : '-'),
        ]),
      ),
      const SectionBand(),
      MiniBars(
        title: '읽은 시간대',
        bars: [for (var h = 0; h < 24; h++) MiniBar('$h', hourLabel(h), hours[h])],
        labels: [for (final h in const [0, 6, 12, 18]) (h, '$h시')],
        emptyText: empty,
        summary: (p) => '${p.name}에 가장 많이 읽었어요 · ${formatDuration(p.value)}',
        valueText: (b) => formatDuration(b.value),
      ),
      const SectionBand(),
      MiniBars(
        title: '한 번에 읽는 길이',
        bars: [for (var i = 0; i < lengths.length; i++) MiniBar(lengthBinsDef[i].key, lengthBinsDef[i].name, lengths[i])],
        labels: [for (var i = 0; i < lengthBinsDef.length; i++) (i, lengthBinsDef[i].short)],
        emptyText: empty,
        summary: (p) => '${p.name}로 가장 자주 읽었어요 · ${p.value}번',
        valueText: (b) => '${b.value}번',
      ),
      const SectionBand(),
      MiniBars(
        title: '요일별',
        bars: [for (var i = 0; i < 7; i++) MiniBar(weekdays[i], '${weekdays[i]}요일', wd[i])],
        labels: [for (var i = 0; i < 7; i++) (i, weekdays[i])],
        emptyText: empty,
        summary: (p) => '${p.name}에 가장 많이 읽었어요 · ${formatDuration(p.value)}',
        valueText: (b) => formatDuration(b.value),
      ),
      if (top.isNotEmpty) ...[
        const SectionBand(),
        Padding(padding: const EdgeInsets.only(bottom: Space.s), child: Semantics(header: true, child: Text('많이 읽은 책', style: AppType.section))),
        for (final r in top)
          row(
            id: r.id,
            label: '${title(r.id)}, ${formatDuration(r.ms)}',
            middle: Text(title(r.id) ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
            right: Text(_shortMs(r.ms), style: rowValue),
          ),
      ],
      const SectionBand(),
      ListGroup(children: [
        ListItem(
          label: '완독',
          sub: st0.completedRounds > st0.completedCount || st0.rereads > 0 ? '완독 ${st0.completedRounds}회 · 재독 ${st0.rereads}회' : null,
          value: '${st0.completedCount}권',
        ),
        ListItem(label: '남긴 갈피', value: '${st0.bookmarkCount}개'),
      ]),
    ];
  }

  Future<void> _pickBook(Library lib) async {
    final withSessions = <String>[];
    for (final s in lib.sessions.values) {
      final id = s.myBookId;
      if (id != null && lib.books.containsKey(id) && !withSessions.contains(id)) withSessions.add(id);
    }
    String? title(String id) => lib.editions[lib.books[id]?.editionId]?.title;
    Widget pick(String? id, String label, {Widget? lead}) => Semantics(
          button: true,
          selected: _book == id,
          label: label,
          child: Pressable(
            onPress: () {
              setState(() {
                _book = id;
                _picked = null;
              });
              Navigator.pop(context);
            },
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 60),
              child: Row(children: [
                if (lead != null) ...[SizedBox(width: 36, child: lead), const SizedBox(width: Space.m)],
                Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.row)),
                if (_book == id) const LucideIcon('Check', size: 20, color: AppColors.accent, stroke: 2.2),
              ]),
            ),
          ),
        );
    await showSheet<void>(
      context,
      title: '책 선택',
      scroll: true,
      builder: (_) => Column(children: [
        pick(null, '모든 책'),
        for (final id in withSessions) pick(id, title(id) ?? '', lead: LinkedCover(lib: lib, id: id, width: 36)),
      ]),
    );
  }
}
