// 기록 화면 자료(막대·시간대·요일·길이 칸·많이 읽은 책·달력·눈금·글자·책 기록)가 지금 앱과 같은지 본다
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/features/stats/chart_data.dart';
import 'package:chaekjang/store/library_read.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final lj = jsonDecode(File('test/fixtures/library_cases.json').readAsStringSync()) as Map<String, dynamic>;
  final lib = libraryFromRows({for (final e in (lj['rows'] as Map<String, dynamic>).entries) e.key: (e.value as List).cast<Map<String, Object?>>()});
  final c = (jsonDecode(File('test/fixtures/chart_cases.json').readAsStringSync()) as Map<String, dynamic>)['charts'] as Map<String, dynamic>;
  final ms = periodStats(lib, monthPeriod(2026, 11)).sessions;
  final ys = periodStats(lib, yearPeriod(2026)).sessions;
  List<num> nums(Object? v) => (v as List).cast<num>();

  test('막대·시간대·요일·길이 칸·요약', () {
    final mb = monthBars(ms, 2026, 11);
    final tb = (c['monthBars'] as List).cast<Map<String, dynamic>>();
    expect(mb.map((b) => b.key).toList(), tb.map((b) => b['key']).toList());
    expect(mb.map((b) => b.ms).toList(), tb.map((b) => b['ms']).toList());
    expect(yearBars(ys, 2026).map((b) => b.ms).toList(), (c['yearBars'] as List).map((b) => (b as Map)['ms']).toList());
    final hb = hourBars(ys), th = nums(c['hourBars']);
    for (var i = 0; i < 24; i++) {
      expect(hb[i], closeTo(th[i], 1e-6), reason: '시간대 $i');
    }
    expect(weekdayBars(ys), nums(c['weekdayBars']));
    expect(lengthBins(ys), nums(c['lengthBins']));
    final sm = sessionSummary(ys), ts = c['summary'] as Map<String, dynamic>;
    expect(sm.averageMs, closeTo(ts['averageMs'] as num, 1e-6));
    expect(sm.longestMs, ts['longestMs']);
    expect(sm.count, ts['count']);
  });

  test('많이 읽은 책·날마다 책·달력', () {
    expect(topBooks(ys, 5).map((x) => [x.id, x.ms]).toList(), (c['topBooks'] as List).map((x) => [(x as Map)['id'], x['ms']]).toList());
    final bd = booksByDay(ms), td = c['booksByDay'] as Map<String, dynamic>;
    expect(bd.keys.toList()..sort(), td.keys.toList()..sort());
    for (final k in td.keys) {
      expect(bd[k]!.books, (td[k]['books'] as List).cast<String>(), reason: k);
      expect(bd[k]!.loose, td[k]['loose'], reason: k);
      expect(bd[k]!.ms, td[k]['ms'], reason: k);
    }
    final cals = [calendarWeeks(2026, 11), calendarWeeks(2026, 2), calendarWeeks(2027, 8)];
    final tc = c['calendar'] as List;
    for (var i = 0; i < 3; i++) {
      expect(cals[i], (tc[i] as List).map((w) => (w as List).cast<String?>()).toList(), reason: '달력 $i');
    }
  });

  test('눈금·글자', () {
    expect([0, 59000, 120000, 4200000, 36000000, 400000000].map(yTicks).toList(), (c['yTicks'] as List).map((x) => (x as List).cast<int>()).toList());
    expect([5, 60, 120, 150, 180].map(tickLabel).toList(), (c['tickLabels'] as List).cast<String>());
    expect([xLabels(12), xLabels(30), xLabels(31)], (c['xLabels'] as List).map((x) => (x as List).cast<int>()).toList());
    expect(['2026-10-31', '2026-11-13', '2027-01-01'].map(dayTitle).toList(), (c['dayTitles'] as List).cast<String>());
    expect(ys.take(8).map((x) => timeRange(x.startedAt, x.endedAt)).toList(), (c['timeRanges'] as List).cast<String>());
    expect(ys.take(8).map(hasPause).toList(), (c['hasPause'] as List).cast<bool>());
    expect([0, 9, 12, 21].map(hourLabel).toList(), (c['hourLabels'] as List).cast<String>());
  });

  test('책 기록', () {
    for (final t in (c['bookRecords'] as List).cast<Map<String, dynamic>>()) {
      final r = bookRecord(lib, t['id'] as String);
      expect(r.readMs, t['readMs'], reason: '${t['id']} 시간');
      expect(r.days, t['days']);
      expect(r.firstDay, t['firstDay']);
      expect(r.lastDay, t['lastDay']);
      expect(r.finished, t['finished']);
      expect(r.pagesPerMin == null, t['pagesPerMin'] == null);
      if (r.pagesPerMin != null) expect(r.pagesPerMin, closeTo(t['pagesPerMin'] as num, 1e-9));
      expect(r.remainingMs, t['remainingMs']);
    }
  });
}
