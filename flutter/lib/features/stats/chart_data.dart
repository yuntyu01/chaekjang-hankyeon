// 내 기록 막대그래프 자료(순수): 기간의 독서 기록을 날(월 보기)·달(연도 보기)별로 더하고, 눈금·글자를 만든다.
// 지금 앱 features/stats/chart-data.ts를 옮긴 것(값이 같은지는 test/chart_data_matches_app_test.dart)
library;

import 'dart:math' as math;

import '../../domain/library.dart';

class Bar {
  Bar(this.key, this.label, this.ms);
  final String key;
  final int label;
  num ms;
}

String _p2(int n) => n.toString().padLeft(2, '0');

List<Bar> monthBars(List<Session> sessions, int y, int m) {
  final days = DateTime(y, m + 1, 0).day;
  final bars = [for (var i = 0; i < days; i++) Bar('$y-${_p2(m)}-${_p2(i + 1)}', i + 1, 0)];
  final at = {for (final b in bars) b.key: b};
  for (final s in sessions) {
    at[sessionDay(s)]?.ms += s.durationMs;
  }
  return bars;
}

List<Bar> yearBars(List<Session> sessions, int y) {
  final bars = [for (var i = 0; i < 12; i++) Bar('$y-${_p2(i + 1)}', i + 1, 0)];
  final at = {for (final b in bars) b.key: b};
  for (final s in sessions) {
    at[sessionDay(s).substring(0, 7)]?.ms += s.durationMs;
  }
  return bars;
}

DateTime _local(String iso) => DateTime.parse(iso).toLocal();

/// 읽은 시간대: 하루 24칸(기기 시간)에 나눠 더한다. 여러 시간에 걸치면 걸친 길이 비율로
List<double> hourBars(List<Session> sessions) {
  final out = List<double>.filled(24, 0);
  for (final s in sessions) {
    final a = _local(s.startedAt).millisecondsSinceEpoch, b = _local(s.endedAt).millisecondsSinceEpoch;
    if (!(b > a)) {
      out[DateTime.fromMillisecondsSinceEpoch(a).hour] += s.durationMs;
      continue;
    }
    var t = a;
    while (t < b) {
      final d = DateTime.fromMillisecondsSinceEpoch(t);
      final next = DateTime(d.year, d.month, d.day, d.hour + 1).millisecondsSinceEpoch;
      final end = math.min(next, b);
      out[d.hour] += s.durationMs * (end - t) / (b - a);
      t = end;
    }
  }
  return out;
}

/// 0 → '밤 12시', 9 → '오전 9시', 12 → '낮 12시', 21 → '오후 9시'
String hourLabel(int h) {
  if (h == 0) return '밤 12시';
  if (h == 12) return '낮 12시';
  return h < 12 ? '오전 $h시' : '오후 ${h - 12}시';
}

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

/// 요일별 읽은 시간(일~토, 시작한 날 기준)
List<num> weekdayBars(List<Session> sessions) {
  final out = List<num>.filled(7, 0);
  for (final s in sessions) {
    out[_local(s.startedAt).weekday % 7] += s.durationMs;
  }
  return out;
}

/// 한 번에 읽는 길이 칸
const lengthBinsDef = [
  (key: 'm10', name: '10분 미만', short: '~10분', max: 10.0),
  (key: 'm30', name: '10~30분', short: '~30분', max: 30.0),
  (key: 'm60', name: '30분~1시간', short: '~1시간', max: 60.0),
  (key: 'm120', name: '1~2시간', short: '~2시간', max: 120.0),
  (key: 'more', name: '2시간 이상', short: '2시간+', max: double.infinity),
];

List<int> lengthBins(List<Session> sessions) {
  final out = List<int>.filled(lengthBinsDef.length, 0);
  for (final s in sessions) {
    out[lengthBinsDef.indexWhere((b) => s.durationMs / 60000 < b.max)]++;
  }
  return out;
}

({num averageMs, num longestMs, int count}) sessionSummary(List<Session> sessions) {
  final total = sessions.fold<num>(0, (a, s) => a + s.durationMs);
  return (
    averageMs: sessions.isEmpty ? 0 : total / sessions.length,
    longestMs: sessions.fold<num>(0, (a, s) => math.max(a, s.durationMs)),
    count: sessions.length,
  );
}

const _speedMinMs = 5 * 60000;
const _speedMinPages = 3;
const _fiveMin = 5 * 60000;

class BookRecordData {
  const BookRecordData(this.readMs, this.days, this.firstDay, this.lastDay, this.finished, this.pagesPerMin, this.remainingMs);
  final num readMs;
  final int days;
  final String? firstDay;
  final String? lastDay;
  final int finished;
  final double? pagesPerMin;
  final num? remainingMs;
}

/// 책 한 권의 기록 전체. 쪽은 시작 쪽과 도달 쪽이 모두 적힌 독서만 세고, 너무 적으면 속도를 내지 않는다
BookRecordData bookRecord(Library lib, String id) {
  final sessions = [for (final s in lib.sessions.values) if (s.myBookId == id) s];
  final days = sessions.map(sessionDay).toSet().toList()..sort();
  num pages = 0, pagedMs = 0;
  for (final s in sessions) {
    if (s.startPage == null || s.pagesRead == null || s.pagesRead! <= s.startPage!) continue;
    pages += s.pagesRead! - s.startPage!;
    pagedMs += s.durationMs;
  }
  final pagesPerMin = pagedMs >= _speedMinMs && pages >= _speedMinPages ? pages / (pagedMs / 60000) : null;
  final b = lib.books[id];
  final total = b == null ? null : lib.editions[b.editionId]?.pageCount;
  final left = total != null && total != 0 && b != null && b.status != ReadStatus.read ? total - (b.currentPage ?? 0) : 0;
  return BookRecordData(
    sessions.fold<num>(0, (a, s) => a + s.durationMs),
    days.length,
    days.isEmpty ? null : days.first,
    days.isEmpty ? null : days.last,
    lib.rounds.values.where((r) => r.myBookId == id && r.finishedAt != null).length,
    pagesPerMin?.toDouble(),
    pagesPerMin != null && pagesPerMin > 0 && left > 0
        ? math.max(_fiveMin, ((left / pagesPerMin * 60000) / _fiveMin + 0.5).floor() * _fiveMin)
        : null,
  );
}

/// 많이 읽은 책(책 없는 기록은 빼고 오래 읽은 순)
List<({String id, num ms})> topBooks(List<Session> sessions, int limit) {
  final per = <String, num>{};
  for (final s in sessions) {
    if (s.myBookId != null) per[s.myBookId!] = (per[s.myBookId!] ?? 0) + s.durationMs;
  }
  final list = per.entries.toList();
  // 지금 앱 sort는 안정 정렬(같은 시간이면 처음 나온 차례)
  final indexed = [for (final (i, e) in list.indexed) (i, e)]..sort((a, b) {
      final c = b.$2.value.compareTo(a.$2.value);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  return [for (final e in indexed.take(limit)) (id: e.$2.key, ms: e.$2.value)];
}

/// 달력(일요일 시작): 주마다 7칸, 그달이 아닌 칸은 null
List<List<String?>> calendarWeeks(int y, int m) {
  final days = DateTime(y, m + 1, 0).day;
  final cells = <String?>[for (var i = 0; i < DateTime(y, m, 1).weekday % 7; i++) null];
  for (var d = 1; d <= days; d++) {
    cells.add('$y-${_p2(m)}-${_p2(d)}');
  }
  while (cells.length % 7 != 0) {
    cells.add(null);
  }
  return [for (var i = 0; i < cells.length ~/ 7; i++) cells.sublist(i * 7, i * 7 + 7)];
}

/// 날마다 그날 읽은 책(오래 읽은 책이 앞). 책 없이 읽은 시간은 있었는지만
class DayBooks {
  const DayBooks(this.books, this.loose, this.ms);
  final List<String> books;
  final bool loose;
  final num ms;
}

Map<String, DayBooks> booksByDay(List<Session> sessions) {
  final acc = <String, ({Map<String, num> per, bool loose, num ms})>{};
  for (final s in sessions) {
    final day = sessionDay(s);
    final row = acc[day] ?? (per: <String, num>{}, loose: false, ms: 0);
    if (s.myBookId != null) row.per[s.myBookId!] = (row.per[s.myBookId!] ?? 0) + s.durationMs;
    acc[day] = (per: row.per, loose: row.loose || s.myBookId == null, ms: row.ms + s.durationMs);
  }
  return {
    for (final e in acc.entries)
      e.key: DayBooks(
        () {
          final l = [for (final (i, x) in e.value.per.entries.indexed) (i, x)]..sort((a, b) {
              final c = b.$2.value.compareTo(a.$2.value);
              return c != 0 ? c : a.$1.compareTo(b.$1);
            });
          return [for (final x in l) x.$2.key];
        }(),
        e.value.loose,
        e.value.ms,
      ),
  };
}

/// 세로 눈금(분): 최댓값 아래로 두 칸(1·2배)
const _nice = [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3000, 6000];
List<int> yTicks(num maxMs) {
  final max = maxMs / 60000;
  var step = 0;
  for (final n in _nice) {
    if (n * 2 <= max) step = n;
  }
  return step == 0 ? const [] : [step, step * 2];
}

String tickLabel(int min) => min >= 120 && min % 60 == 0 ? '${min ~/ 60}시간' : '$min분';

/// 가로 글자: 월 보기 1·5·10·15·20·25·마지막 날, 연도 보기 1·3·5·7·9·11·12월
List<int> xLabels(int count) => count == 12 ? const [1, 3, 5, 7, 9, 11, 12] : [1, 5, 10, 15, 20, 25, count];

const _week = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/// '2026-10-31' → '10월 31일 토요일'
String dayTitle(String day) {
  final p = day.split('-').map(int.parse).toList();
  return '${p[1]}월 ${p[2]}일 ${_week[DateTime(p[0], p[1], p[2]).weekday % 7]}';
}

({String noon, String text}) _clock(String iso) {
  final t = _local(iso);
  final h = t.hour;
  return (noon: h < 12 ? '오전' : '오후', text: '${h % 12 == 0 ? 12 : h % 12}:${_p2(t.minute)}');
}

/// '오후 9:10 – 10:00'(오전·오후가 같으면 한 번만)
String timeRange(String startIso, String endIso) {
  final a = _clock(startIso), b = _clock(endIso);
  return a.noon == b.noon ? '${a.noon} ${a.text} – ${b.text}' : '${a.noon} ${a.text} – ${b.noon} ${b.text}';
}

/// 시작~끝 사이가 실제 독서 시간보다 1분 넘게 길면(일시정지가 있었으면)
bool hasPause(Session s) => _local(s.endedAt).millisecondsSinceEpoch - _local(s.startedAt).millisecondsSinceEpoch - s.durationMs >= 60000;
