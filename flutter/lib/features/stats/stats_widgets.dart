// 기록 화면 부품: 달력(날마다 읽은 책 표지를 겹쳐), 막대 그래프(말풍선), 작은 막대(시간대·길이·요일), 책 한 권 기록.
// 지금 앱 features/stats/ReadingCalendar·ReadingChart·MiniBars·BookRecord와 ui/BookVisual LinkedCover를 옮긴 것
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/cover_url.dart';
import '../../domain/library.dart';
import '../../services/cover_cache.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'chart_data.dart';

const _small = TextStyle(fontFamily: AppFonts.ui, fontSize: 13, height: 18 / 13, color: AppColors.inkSoft, fontFeatures: [FontFeature.tabularFigures()]);

Color _hex(String hex) => Color(0xFF000000 | int.parse(hex.replaceAll('#', ''), radix: 16));

/// 표지 그림(기기에 받아 둔 것). 없거나 못 받으면 책 색 바탕
class CoverImage extends StatefulWidget {
  const CoverImage({super.key, required this.uris, required this.color, required this.width, required this.height, this.radius = 2.5});
  final List<String?> uris;
  final Color color;
  final double width;
  final double height;
  final double radius;

  @override
  State<CoverImage> createState() => _CoverImageState();
}

class _CoverImageState extends State<CoverImage> {
  RawImage? _img;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    for (final u in {...widget.uris.whereType<String>()}) {
      final img = coverInMemory(u) ?? await loadCover(u);
      if (img != null) {
        if (mounted) setState(() => _img = RawImage(image: img, fit: BoxFit.cover, width: widget.width, height: widget.height));
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(widget.radius),
        child: Container(width: widget.width, height: widget.height, color: widget.color, child: _img),
      );
}

/// 서재 책의 표지: 실제 표지가 있으면 그것, 없으면 책 색 대체 표지(제목)
class LinkedCover extends StatelessWidget {
  const LinkedCover({super.key, required this.lib, required this.id, required this.width});
  final Library lib;
  final String id;
  final double width;

  @override
  Widget build(BuildContext context) {
    final b = lib.books[id];
    final e = b == null ? null : lib.editions[b.editionId];
    final color = (b?.bindingId != null ? lib.bindings[b!.bindingId]?.spineColor : null) ?? '#F2F4F6';
    if (e?.coverUri != null) {
      return Semantics(
        label: '${e!.title} 표지',
        child: CoverImage(uris: [coverAtSize(e.coverUri, 'M'), e.coverUri], color: AppColors.surface, width: width, height: width / 0.68, radius: 3),
      );
    }
    return RealCover(title: e?.title ?? '', color: color, width: width);
  }
}

// ---------- 달력 ----------
const _maxLayers = 4, _stepX = 4.0, _stepY = 2.0, _coverH = 46.0, _coverRatio = 1.42, _numH = 24.0;

class ReadingCalendar extends StatelessWidget {
  const ReadingCalendar({super.key, required this.lib, required this.y, required this.m, required this.days, required this.selected, required this.today, required this.onSelect});
  final Library lib;
  final int y, m;
  final Map<String, DayBooks> days;
  final String? selected;
  final String today;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: LayoutBuilder(builder: (context, c) {
          final cell = c.maxWidth / 7;
          return Column(children: [
            Container(
              padding: const EdgeInsets.only(bottom: 8),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.track, width: 0.5))),
              child: Row(children: [for (final d in weekdays) SizedBox(width: cell, child: Text(d, textAlign: TextAlign.center, style: _small))]),
            ),
            for (final week in calendarWeeks(y, m))
              Container(
                padding: const EdgeInsets.symmetric(vertical: 6),
                decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.line, width: 0.5))),
                child: Row(children: [
                  for (final day in week)
                    day == null
                        ? SizedBox(width: cell)
                        : _DayCell(lib: lib, day: day, row: days[day], cell: cell, selected: selected == day, today: today == day, onSelect: onSelect),
                ]),
              ),
          ]);
        }),
      );
}

class _DayCell extends StatelessWidget {
  const _DayCell({required this.lib, required this.day, required this.row, required this.cell, required this.selected, required this.today, required this.onSelect});
  final Library lib;
  final String day;
  final DayBooks? row;
  final double cell;
  final bool selected, today;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final n = int.parse(day.substring(8));
    final w = math.min((_coverH / _coverRatio).roundToDouble(), math.max(16.0, cell - 4));
    final side = (cell - w) / 2;
    final ids = (row?.books ?? const <String>[]).where((id) => lib.books.containsKey(id)).take(_maxLayers).toList();
    final titles = [for (final id in ids) lib.editions[lib.books[id]!.editionId]?.title].whereType<String>().toList();
    final label = row != null
        ? '$n일, ${titles.isNotEmpty ? '${titles.first}${row!.books.length > 1 ? ' 외 ${row!.books.length - 1}권' : ''}, ' : ''}${formatDuration(row!.ms)}'
        : '$n일, 기록 없음';
    return Semantics(
      button: true,
      selected: selected,
      enabled: row != null,
      label: label,
      child: Pressable(
        onPress: row == null ? null : () => onSelect(day),
        child: SizedBox(
          width: cell,
          child: Column(children: [
            SizedBox(
              height: _numH,
              child: Center(
                child: Container(
                  constraints: const BoxConstraints(minWidth: _numH),
                  height: _numH,
                  decoration: BoxDecoration(color: selected ? AppColors.accent : null, borderRadius: BorderRadius.circular(_numH / 2)),
                  alignment: Alignment.center,
                  child: Text('$n',
                      style: _small.copyWith(
                        fontFamily: selected || today ? AppFonts.uiBold : AppFonts.ui,
                        color: selected ? AppColors.onAccent : today ? AppColors.ink : AppColors.inkSoft,
                      )),
                ),
              ),
            ),
            const SizedBox(height: 2),
            SizedBox(
              height: _coverH + (_maxLayers - 1) * _stepY,
              child: Stack(children: [
                // 뒤 책부터 그린다
                for (final id in ids.reversed)
                  Positioned(
                    right: side + ids.indexOf(id) * _stepX,
                    top: ids.indexOf(id) * _stepY,
                    child: _Paper(lib: lib, id: id, w: w, h: _coverH),
                  ),
                if (ids.isEmpty && row != null) Positioned(right: side, top: 0, child: _Paper(w: w, h: _coverH)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// 달력 칸 표지(흰 표지도 바탕과 갈리게 얇은 선 + 옅은 그림자)
class _Paper extends StatelessWidget {
  const _Paper({this.lib, this.id, required this.w, required this.h});
  final Library? lib;
  final String? id;
  final double w, h;

  @override
  Widget build(BuildContext context) {
    final b = id == null ? null : lib!.books[id];
    final e = b == null ? null : lib!.editions[b.editionId];
    final color = (b?.bindingId != null ? lib!.bindings[b!.bindingId]?.spineColor : null);
    return Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(2.5),
        border: Border.all(color: const Color(0x24191F28), width: 0.5),
        boxShadow: const [BoxShadow(color: Color(0x1F000000), offset: Offset(0, 1), blurRadius: 2)],
      ),
      child: CoverImage(uris: [coverAtSize(e?.coverUri, 'M'), e?.coverUri], color: color != null ? _hex(color) : AppColors.input, width: w, height: h),
    );
  }
}

// ---------- 막대 그래프 ----------
const _plotH = 170.0, _tipH = 44.0, _axisW = 38.0, _labelH = 26.0;

class ReadingChart extends StatelessWidget {
  const ReadingChart({super.key, required this.bars, required this.selected, required this.unit, required this.onSelect});
  final List<Bar> bars;
  final String? selected;
  final String unit;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: _tipH + _plotH + _labelH,
        child: LayoutBuilder(builder: (context, c) {
          final w = c.maxWidth;
          final max = bars.fold<num>(0, (a, b) => math.max(a, b.ms));
          final ticks = yTicks(max);
          double scale(num ms) => max > 0 ? ms / max * (_plotH - 6) : 0;
          final plotW = math.max(0.0, w - _axisW);
          final cell = bars.isEmpty ? 0.0 : plotW / bars.length;
          final barW = math.max(3.0, math.min(unit == '월' ? 14.0 : 7.0, cell * 0.6));
          double cx(int i) => _axisW + cell * (i + 0.5);
          final sel = bars.indexWhere((b) => b.key == selected && b.ms > 0);
          const base = _tipH + _plotH;
          double barH(num ms) => math.max(barW, scale(ms));
          final tip = sel < 0 ? null : '${bars[sel].label}$unit · ${formatDuration(bars[sel].ms)}';
          // 말풍선 폭(글자 폭 + 좌우 10)
          final tipW = tip == null
              ? 0.0
              : (TextPainter(
                    text: TextSpan(children: [
                      TextSpan(text: '${bars[sel].label}$unit · ', style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 14, height: 20 / 14)),
                      TextSpan(text: formatDuration(bars[sel].ms), style: const TextStyle(fontFamily: AppFonts.uiBold, fontSize: 14, height: 20 / 14)),
                    ]),
                    textDirection: TextDirection.ltr,
                    textScaler: MediaQuery.textScalerOf(context), // 그릴 때와 같은 글자 크기(RnTextScaler)로 잰다
                  )..layout())
                      .width +
                  20;
          final tipLeft = sel < 0 ? 0.0 : (cx(sel) + tipW / 2 > w ? w - tipW : math.max(0.0, cx(sel) - tipW / 2).roundToDouble());
          final barTop = sel >= 0 ? base - barH(bars[sel].ms) : 0.0;
          var tipBase = barTop;
          for (var i = 0; i < bars.length; i++) {
            final b = bars[i];
            if (b.ms > 0 && cx(i) + barW / 2 >= tipLeft && cx(i) - barW / 2 <= tipLeft + tipW) tipBase = math.min(tipBase, base - barH(b.ms));
          }
          return Stack(clipBehavior: Clip.none, children: [
            CustomPaint(
              size: Size(w, base + 6),
              painter: _ChartPainter(bars: bars, ticks: [for (final t in ticks) base - scale(t * 60000)], w: w, base: base, cx: cx, barW: barW, barH: barH, sel: sel),
            ),
            for (final t in ticks) Positioned(left: 0, width: _axisW - 6, top: base - scale(t * 60000) - 9, child: Text(tickLabel(t), style: _small)),
            const Positioned(left: 0, width: _axisW - 6, top: base - 9, child: Text('0', style: _small)),
            for (final n in xLabels(bars.length))
              Positioned(left: cx(n - 1) - 15, width: 30, top: base + 6, child: Text('$n', textAlign: TextAlign.center, style: _small)),
            for (var i = 0; i < bars.length; i++)
              Positioned(
                left: _axisW + cell * i,
                width: cell,
                top: _tipH,
                height: _plotH + _labelH,
                child: Semantics(
                  button: bars[i].ms > 0,
                  selected: i == sel,
                  label: '${bars[i].label}$unit ${formatDuration(bars[i].ms)}',
                  child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: bars[i].ms > 0 ? () => onSelect(bars[i].key) : null),
                ),
              ),
            if (sel >= 0) ...[
              if (tipBase < barTop) Positioned(left: cx(sel) - 0.5, top: tipBase - 12, width: 1, height: barTop - tipBase + 12, child: const ColoredBox(color: AppColors.accent)),
              Positioned(
                left: tipLeft,
                top: tipBase - 42,
                height: 30,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: AppColors.accent, borderRadius: BorderRadius.circular(8)),
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: '${bars[sel].label}$unit · ', style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 14, height: 20 / 14, color: AppColors.onAccent)),
                    TextSpan(text: formatDuration(bars[sel].ms), style: const TextStyle(fontFamily: AppFonts.uiBold, fontSize: 14, height: 20 / 14, color: AppColors.onAccent)),
                  ])),
                ),
              ),
              Positioned(
                left: cx(sel) - 5,
                top: tipBase - 17,
                child: Transform.rotate(angle: math.pi / 4, child: const SizedBox(width: 10, height: 10, child: ColoredBox(color: AppColors.accent))),
              ),
            ],
          ]);
        }),
      );
}

class _ChartPainter extends CustomPainter {
  _ChartPainter({required this.bars, required this.ticks, required this.w, required this.base, required this.cx, required this.barW, required this.barH, required this.sel});
  final List<Bar> bars;
  final List<double> ticks;
  final double w, base, barW;
  final double Function(int) cx;
  final double Function(num) barH;
  final int sel;

  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..color = AppColors.line
      ..strokeWidth = 1;
    for (final y in ticks) {
      for (var x = _axisW; x < w; x += 8) {
        canvas.drawLine(Offset(x, y), Offset(math.min(x + 4, w), y), line);
      }
    }
    canvas.drawLine(Offset(_axisW, base), Offset(w, base), line);
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].ms <= 0) continue;
      final h = barH(bars[i].ms);
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(cx(i) - barW / 2, base - h, barW, h), Radius.circular(barW / 2)),
        Paint()..color = i == sel ? AppColors.accent : AppColors.track,
      );
    }
  }

  @override
  bool shouldRepaint(_ChartPainter old) => true;
}

// ---------- 작은 막대 ----------
class MiniBar {
  const MiniBar(this.key, this.name, this.value);
  final String key;
  final String name;
  final num value;
}

const _miniPlotH = 110.0, _miniLabelH = 24.0, _miniBarMax = 26.0;

class MiniBars extends StatefulWidget {
  const MiniBars({super.key, required this.title, required this.bars, required this.labels, required this.emptyText, required this.summary, required this.valueText});
  final String title;
  final List<MiniBar> bars;
  final List<(int, String)> labels;
  final String emptyText;
  final String Function(MiniBar peak) summary;
  final String Function(MiniBar bar) valueText;

  @override
  State<MiniBars> createState() => _MiniBarsState();
}

class _MiniBarsState extends State<MiniBars> {
  String? _picked;

  @override
  Widget build(BuildContext context) {
    final bars = widget.bars;
    final max = bars.fold<num>(0, (a, b) => math.max(a, b.value));
    final peak = max > 0 ? bars.firstWhere((b) => b.value == max) : null;
    final chosen = bars.where((b) => b.key == _picked && b.value > 0).firstOrNull;
    final shown = chosen ?? peak;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Semantics(header: true, child: Text(widget.title, style: AppType.section)),
      Padding(
        padding: const EdgeInsets.only(top: 2, bottom: 14),
        child: Text(shown == null ? widget.emptyText : chosen != null ? '${chosen.name} · ${widget.valueText(chosen)}' : widget.summary(shown), style: AppType.sub),
      ),
      SizedBox(
        height: _miniPlotH + _miniLabelH,
        child: LayoutBuilder(builder: (context, c) {
          final w = c.maxWidth;
          final cell = bars.isEmpty ? 0.0 : w / bars.length;
          final barW = math.max(3.0, math.min(_miniBarMax, cell * 0.62));
          double barH(num v) => math.max(barW, v / max * (_miniPlotH - 6));
          return Stack(clipBehavior: Clip.none, children: [
            CustomPaint(
              size: Size(w, _miniPlotH + 2),
              painter: _MiniPainter(bars: bars, cell: cell, barW: barW, barH: barH, shownKey: shown?.key),
            ),
            for (final (at, text) in widget.labels)
              Positioned(left: cell * (at + 0.5) - 24, width: 48, top: _miniPlotH + 6, child: Text(text, maxLines: 1, textAlign: TextAlign.center, style: _small)),
            for (var i = 0; i < bars.length; i++)
              Positioned(
                left: cell * i,
                width: cell,
                top: 0,
                height: _miniPlotH + _miniLabelH,
                child: Semantics(
                  button: bars[i].value > 0,
                  selected: shown != null && bars[i].key == shown.key,
                  label: '${bars[i].name} ${widget.valueText(bars[i])}',
                  child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: bars[i].value > 0 ? () => setState(() => _picked = bars[i].key) : null),
                ),
              ),
          ]);
        }),
      ),
    ]);
  }
}

class _MiniPainter extends CustomPainter {
  _MiniPainter({required this.bars, required this.cell, required this.barW, required this.barH, required this.shownKey});
  final List<MiniBar> bars;
  final double cell, barW;
  final double Function(num) barH;
  final String? shownKey;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawLine(Offset(0, _miniPlotH), Offset(size.width, _miniPlotH), Paint()
      ..color = AppColors.line
      ..strokeWidth = 1);
    for (var i = 0; i < bars.length; i++) {
      final b = bars[i];
      if (b.value <= 0) continue;
      final bh = barH(b.value);
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(cell * (i + 0.5) - barW / 2, _miniPlotH - bh, barW, bh), Radius.circular(math.min(barW / 2, 6))),
        Paint()..color = b.key == shownKey ? AppColors.accent : AppColors.track,
      );
    }
  }

  @override
  bool shouldRepaint(_MiniPainter old) => true;
}

// ---------- 책 한 권 기록 ----------
class StatNumber extends StatelessWidget {
  const StatNumber({super.key, required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Semantics(
          label: '$label $value',
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: AppType.caption),
            const SizedBox(height: Space.xs),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value,
                  maxLines: 1,
                  style: const TextStyle(fontFamily: AppFonts.uiBold, fontSize: 20, height: 28 / 20, color: AppColors.ink, fontFeatures: [FontFeature.tabularFigures()])),
            ),
          ]),
        ),
      );
}

class BookRecordView extends StatelessWidget {
  const BookRecordView({super.key, required this.lib, required this.id});
  final Library lib;
  final String id;

  @override
  Widget build(BuildContext context) {
    final r = bookRecord(lib, id);
    final title = lib.editions[lib.books[id]?.editionId]?.title ?? '';
    String dot(String d) => d.replaceAll('-', '.');
    final span = r.firstDay != null ? (r.firstDay == r.lastDay ? dot(r.firstDay!) : '${dot(r.firstDay!)} ~ ${dot(r.lastDay!)}') : '아직 기록이 없어요';
    return Padding(
      padding: const EdgeInsets.only(top: Space.s),
      child: Column(children: [
        Row(children: [
          SizedBox(width: 40, child: Center(child: LinkedCover(lib: lib, id: id, width: 40))),
          const SizedBox(width: Space.m),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
              Padding(padding: const EdgeInsets.only(top: 2), child: Text(span, maxLines: 1, style: AppType.sub)),
            ]),
          ),
        ]),
        const SizedBox(height: Space.l),
        Row(children: [
          StatNumber(label: '총 독서 시간', value: formatDuration(r.readMs)),
          const SizedBox(width: Space.m),
          StatNumber(label: '읽은 날', value: '${r.days}일'),
          const SizedBox(width: Space.m),
          StatNumber(label: '완독', value: '${r.finished}회'),
        ]),
        if (r.pagesPerMin != null) ...[
          const SizedBox(height: Space.l),
          Row(children: [
            StatNumber(label: '읽는 속도', value: '분당 ${r.pagesPerMin!.toStringAsFixed(1)}쪽'),
            const SizedBox(width: Space.m),
            if (r.remainingMs != null) StatNumber(label: '다 읽기까지', value: '약 ${formatDuration(r.remainingMs!)}') else const Spacer(),
            const SizedBox(width: Space.m),
            const Spacer(),
          ]),
        ],
        const SectionBand(),
      ]),
    );
  }
}
