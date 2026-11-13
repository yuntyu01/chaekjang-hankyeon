// 읽기(지금 앱 domain/reading-list.ts·library.ts addSessionTo·sessionRound·newId, store/reading-store.ts 순수 규칙, BookPicker recentBookIds를 옮긴 것).
// 같은지는 test/reading_matches_app_test.dart(tool/dump_reading.test.ts가 지금 앱 함수로 뽑은 값)
library;

import 'dart:math' as math;

import 'library.dart';

// ---------- 읽기 탭 목록 ----------

/// 오늘(기기 날짜, 세션 시작 시각 기준) 저장된 독서 시간: 전체·책마다·책 없이. 지금 재는 시간은 화면이 더한다
class TodayRead {
  const TodayRead(this.total, this.byBook, this.noBook);
  final num total;
  final Map<String, num> byBook;
  final num noBook;
}

TodayRead todayRead(Library lib, String day) {
  final byBook = <String, num>{};
  num total = 0, noBook = 0;
  for (final s in lib.sessions.values) {
    if (sessionDay(s) != day) continue;
    total += s.durationMs;
    if (s.myBookId != null && lib.books[s.myBookId] != null) {
      byBook[s.myBookId!] = (byBook[s.myBookId!] ?? 0) + s.durationMs;
    } else {
      noBook += s.durationMs;
    }
  }
  return TodayRead(total, byBook, noBook);
}

/// 책 없이 읽기 줄을 추가해 둔 표시(설정 readList)
const noBook = '~none';

int _cmp(String a, String b) => a.compareTo(b);

/// 줄에 오르는 책: 넘겨받은 책 → 지금 재는 책 → 마지막으로 읽은 때가 가까운 책 → 읽기 시작한(바뀐) 때가 가까운 책 → 추가해 둔 책(추가한 순서)
List<String> readListIds(Library lib, {required String day, String? activeId, String? focusId, List<String> added = const []}) {
  bool shown(String? id) => id != null && lib.books[id] != null && lib.books[id]!.hiddenAt == null;
  final last = <String, String>{};
  for (final s in lib.sessions.values) {
    if (s.myBookId != null && _cmp(last[s.myBookId!] ?? '', s.startedAt) < 0) last[s.myBookId!] = s.startedAt;
  }
  final todayBy = todayRead(lib, day).byBook;
  final rest = [for (final (i, b) in lib.books.values.indexed) if (shown(b.id) && (b.status == ReadStatus.reading || todayBy.containsKey(b.id))) (i, b)]
    ..sort((x, y) {
      var c = _cmp(last[y.$2.id] ?? '', last[x.$2.id] ?? '');
      if (c == 0) c = _cmp(y.$2.updatedAt, x.$2.updatedAt);
      return c != 0 ? c : x.$1.compareTo(y.$1); // 지금 앱 sort는 안정 정렬
    });
  final out = <String>{};
  for (final id in [focusId, activeId]) {
    if (shown(id)) out.add(id!);
  }
  out.addAll(rest.map((x) => x.$2.id));
  out.addAll(added.where(shown));
  return out.toList();
}

String _p2(int n) => n.toString().padLeft(2, '0');

/// 시간 글자: 공부 타이머처럼 늘 '시:분:초'(0:00:00)
String hms(num ms) {
  final t = math.max(0, (ms / 1000).floor());
  return '${t ~/ 3600}:${_p2((t % 3600) ~/ 60)}:${_p2(t % 60)}';
}

/// 경과 시계: 한 시간이 안 되면 '분:초'
String clock(num ms) {
  final t = (ms / 1000).floor();
  final h = t ~/ 3600, m = (t % 3600) ~/ 60, s = t % 60;
  return h > 0 ? '$h:${_p2(m)}:${_p2(s)}' : '${_p2(m)}:${_p2(s)}';
}

/// 책 고르기 차례: 최근 읽은 책(읽는 중인데 기록이 없으면 바뀐 때)
List<String> recentBookIds(Library lib) {
  final last = <String, String>{};
  for (final s in lib.sessions.values) {
    if (s.myBookId != null && lib.books[s.myBookId] != null && _cmp(last[s.myBookId!] ?? '', s.startedAt) < 0) last[s.myBookId!] = s.startedAt;
  }
  for (final b in lib.books.values) {
    if (b.status == ReadStatus.reading && !last.containsKey(b.id)) last[b.id] = b.updatedAt;
  }
  final e = [for (final (i, x) in last.entries.indexed) (i, x)]
    ..sort((a, b) {
      final c = _cmp(b.$2.value, a.$2.value);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  return [for (final x in e) x.$2.key];
}

// ---------- 새 id·독서 저장 ----------

final _rnd = math.Random();

/// 지금 앱 newId: `${prefix}_${Date.now() 36진수}${무작위 6자}`
String newId(String prefix) {
  final r = StringBuffer();
  while (r.length < 6) {
    r.write(_rnd.nextInt(36).toRadixString(36));
  }
  return '${prefix}_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}$r';
}

/// 기록을 저장할 때 그 책의 회차 확보: 있으면 마지막 회차, 없으면 1회차를 열고 읽기 전이면 읽는 중으로
({Library lib, String? roundId}) sessionRound(Library lib, String myBookId, String day, String now, {String Function()? roundId}) {
  final book = lib.books[myBookId];
  if (book == null) return (lib: lib, roundId: null);
  final last = currentRound(lib, myBookId);
  if (last != null) return (lib: lib, roundId: last.id);
  final id = (roundId ?? () => newId('rd'))();
  final r = Round(id: id, myBookId: myBookId, index: 1, startedAt: day, createdAt: now, updatedAt: now, paused: book.status == ReadStatus.paused);
  final status = book.status == ReadStatus.want ? ReadStatus.reading : book.status;
  return (
    lib: lib.copy(rounds: {...lib.rounds, id: r}, books: {...lib.books, myBookId: book.copyWith(status: status, updatedAt: now)}),
    roundId: id,
  );
}

class SessionInput {
  const SessionInput({required this.startedAt, required this.endedAt, required this.durationMs, this.id, this.myBookId, this.startPage, this.pagesRead, this.memo});
  final String? id, myBookId, memo;
  final String startedAt, endedAt;
  final num durationMs;
  final num? startPage, pagesRead;
}

/// 독서 기록 저장: 같은 id(타이머 id)로 다시 저장해도 하나로 남는다. 책이 있으면 회차를 먼저 확보해 연결하고,
/// 적은 쪽수는 현재 쪽수를 앞으로만 옮긴다. 책 없이 시간만도 저장한다
({Library lib, String id}) addSessionTo(Library lib, SessionInput input, String now, {String Function()? sessionId, String Function()? roundId}) {
  final prev = input.id == null ? null : lib.sessions[input.id];
  var next = lib;
  String? rid;
  final linked = input.myBookId != null && lib.books[input.myBookId] != null;
  if (linked) {
    final r = sessionRound(lib, input.myBookId!, today(DateTime.parse(input.startedAt)), now, roundId: roundId);
    next = r.lib;
    rid = r.roundId;
  }
  final id = input.id ?? (sessionId ?? () => newId('ss'))();
  final s = Session(
    id: id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    myBookId: linked ? input.myBookId : null,
    roundId: rid,
    startPage: input.startPage,
    pagesRead: input.pagesRead,
    memo: input.memo,
  );
  next = next.copy(sessions: {...next.sessions, id: s});
  final b = s.myBookId == null ? null : next.books[s.myBookId];
  if (b != null && input.pagesRead != null && input.pagesRead != 0) {
    next = next.copy(books: {...next.books, b.id: b.copyWith(currentPage: math.max(b.currentPage ?? 0, input.pagesRead!), updatedAt: now)});
  }
  return (lib: next, id: id);
}

// ---------- 진행 중 독서(타이머) ----------

/// 진행 중 독서: 시각(벽시계)만 저장하고 경과는 계산한다. JSON 모양은 지금 앱 저장본과 같다
class Active {
  const Active({required this.id, required this.startedAt, required this.accumulatedMs, required this.runningSince, required this.lastBeat, this.myBookId, this.interruptedAt, this.startPage});
  final String id;
  final String? myBookId;
  final String startedAt;
  final num accumulatedMs;
  final num? runningSince;
  final num lastBeat;
  final num? interruptedAt;
  final num? startPage;

  static const _keep = Object();
  Active copyWith({Object? myBookId = _keep, num? accumulatedMs, Object? runningSince = _keep, num? lastBeat, Object? interruptedAt = _keep, Object? startPage = _keep}) => Active(
        id: id,
        startedAt: startedAt,
        myBookId: identical(myBookId, _keep) ? this.myBookId : myBookId as String?,
        accumulatedMs: accumulatedMs ?? this.accumulatedMs,
        runningSince: identical(runningSince, _keep) ? this.runningSince : runningSince as num?,
        lastBeat: lastBeat ?? this.lastBeat,
        interruptedAt: identical(interruptedAt, _keep) ? this.interruptedAt : interruptedAt as num?,
        startPage: identical(startPage, _keep) ? this.startPage : startPage as num?,
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'myBookId': ?myBookId,
        'startedAt': startedAt,
        'accumulatedMs': accumulatedMs,
        'runningSince': runningSince,
        'lastBeat': lastBeat,
        'interruptedAt': ?interruptedAt,
        'startPage': ?startPage,
      };

  static Active fromJson(Map<String, Object?> j) => Active(
        id: j['id']! as String,
        myBookId: j['myBookId'] as String?,
        startedAt: j['startedAt']! as String,
        accumulatedMs: j['accumulatedMs']! as num,
        runningSince: j['runningSince'] as num?,
        lastBeat: j['lastBeat']! as num,
        interruptedAt: j['interruptedAt'] as num?,
        startPage: j['startPage'] as num?,
      );
}

/// 강제 종료 뒤 복구: 마지막 확인 시각까지 센 시간과 그 뒤 지난 시간
class Interrupted {
  const Interrupted(this.active, this.countedMs, this.lastBeat, this.gapMs);
  final Active active;
  final num countedMs, lastBeat, gapMs;
}

/// 종료 화면에 적는 중인 값(입력 그대로의 글자)
class FinishNotes {
  const FinishNotes({this.startPage, this.pages, this.memo});
  final String? startPage, pages, memo;
  Map<String, Object?> toJson() => {'startPage': ?startPage, 'pages': ?pages, 'memo': ?memo};
  static FinishNotes fromJson(Map<String, Object?> j) => FinishNotes(startPage: j['startPage'] as String?, pages: j['pages'] as String?, memo: j['memo'] as String?);
}

/// 끝낸 뒤 종료 화면이 저장·버리기를 정할 값(id = 타이머 id = 저장할 세션 id)
class FinishDraft {
  const FinishDraft({required this.id, required this.startedAt, required this.endedAt, required this.durationMs, this.myBookId, this.startPage, this.notes});
  final String id, startedAt, endedAt;
  final String? myBookId;
  final num durationMs;
  final num? startPage;
  final FinishNotes? notes;

  Map<String, Object?> toJson() => {
        'id': id,
        'myBookId': ?myBookId,
        'startedAt': startedAt,
        'endedAt': endedAt,
        'durationMs': durationMs,
        'startPage': ?startPage,
        if (notes != null) 'notes': notes!.toJson(),
      };

  static FinishDraft fromJson(Map<String, Object?> j) => FinishDraft(
        id: j['id']! as String,
        myBookId: j['myBookId'] as String?,
        startedAt: j['startedAt']! as String,
        endedAt: j['endedAt']! as String,
        durationMs: j['durationMs']! as num,
        startPage: j['startPage'] as num?,
        notes: j['notes'] == null ? null : FinishNotes.fromJson((j['notes']! as Map).cast<String, Object?>()),
      );
}

num elapsedMs(Active a, num now) => a.accumulatedMs + (a.runningSince != null ? math.max(0, now - a.runningSince!) : 0);

/// 저장본을 다시 읽을 때: 달리는 상태로 남아 있으면 앱이 꺼진 것 → 마지막 확인 시각까지만 세고 일시정지로
({Active? active, Interrupted? interrupted}) recoverOnLoad(Active? saved, num now) {
  if (saved == null) return (active: null, interrupted: null);
  if (saved.runningSince != null) {
    final lastBeat = math.max(saved.runningSince!, saved.lastBeat);
    final counted = saved.accumulatedMs + (lastBeat - saved.runningSince!);
    final active = saved.copyWith(accumulatedMs: counted, runningSince: null, lastBeat: lastBeat, interruptedAt: lastBeat);
    return (active: active, interrupted: Interrupted(active, counted, lastBeat, math.max(0, now - lastBeat)));
  }
  if (saved.interruptedAt != null) {
    return (active: saved, interrupted: Interrupted(saved, saved.accumulatedMs, saved.interruptedAt!, math.max(0, now - saved.interruptedAt!)));
  }
  return (active: saved, interrupted: null);
}

String isoOf(num ms) => DateTime.fromMillisecondsSinceEpoch(ms.toInt(), isUtc: true).toIso8601String();

/// 끝내기: endAt을 주면 그 시각에 끝낸 것으로(달리는 중일 때만 의미가 있다)
FinishDraft finishActive(Active a, num now, [num? endAt]) {
  final t = endAt ?? now;
  final running = a.runningSince != null;
  final duration = running ? a.accumulatedMs + math.max(0, t - a.runningSince!) : a.accumulatedMs;
  final end = running ? t : (a.interruptedAt ?? math.max(a.lastBeat, DateTime.parse(a.startedAt).millisecondsSinceEpoch));
  return FinishDraft(id: a.id, myBookId: a.myBookId, startedAt: a.startedAt, endedAt: isoOf(end), durationMs: duration, startPage: a.startPage);
}

// ---------- 읽기 상태·다시 읽기(지금 앱 domain/library.ts applyStatus·rereadRound) ----------

/// 상태 변경 규칙(사용자가 정한다. 타이머 시간으로 자동 완독 판정하지 않는다). day는 기기 현지 날짜.
/// 같은 상태면 그대로. 읽는 중·보류로: 열린 회차를 이어 가거나(보류 해제/설정) 없으면 새 회차(완독 뒤면 다시 읽기, 진도 0쪽부터).
/// 완독으로: 열린 회차를 닫고(완독일 오늘), 회차가 없으면 만들고 바로 닫는다. 읽기 전으로: 날짜 없는 빈 열린 회차만 지운다
Library applyStatus(Library lib, String myBookId, ReadStatus status, String now, {String? day, String Function()? roundId}) {
  final book = lib.books[myBookId];
  if (book == null || book.status == status) return lib;
  final d = day ?? today(DateTime.parse(now));
  final rounds = {...lib.rounds};
  final last = currentRound(lib, myBookId);
  final open = last != null && last.finishedAt == null ? last : null;
  Round make() => Round(id: (roundId ?? () => newId('rd'))(), myBookId: myBookId, index: (last?.index ?? 0) + 1, startedAt: d, createdAt: now, updatedAt: now);
  Object? page = book.currentPage;
  if (status == ReadStatus.reading || status == ReadStatus.paused) {
    final paused = status == ReadStatus.paused;
    if (open != null) {
      rounds[open.id] = open.copyWith(paused: paused, startedAt: open.startedAt ?? d, updatedAt: now);
    } else {
      final r = make();
      rounds[r.id] = paused ? r.copyWith(paused: true, updatedAt: now) : r;
      if (last != null) page = null; // 다시 읽기: 진도는 0쪽부터
    }
  } else if (status == ReadStatus.read) {
    if (open != null) {
      rounds[open.id] = open.copyWith(paused: false, finishedAt: d, updatedAt: now);
    } else if (last == null) {
      final r = make();
      rounds[r.id] = r.copyWith(finishedAt: d, updatedAt: now);
    }
  } else if (open != null && open.startedAt == null && open.finishedAt == null) {
    rounds.remove(open.id);
  }
  return lib.copy(rounds: rounds, books: {...lib.books, myBookId: book.patch(status: status, currentPage: page, updatedAt: now)});
}

/// 다시 읽기(명시적): 지난 회차는 그대로 두고 새 회차를 연다(진도 0쪽부터). 열린 회차가 있으면 그대로
Library rereadRound(Library lib, String myBookId, String now, {String? day, String Function()? roundId}) {
  final book = lib.books[myBookId];
  if (book == null) return lib;
  final last = currentRound(lib, myBookId);
  if (last != null && last.finishedAt == null) return lib;
  final d = day ?? today(DateTime.parse(now));
  final r = Round(id: (roundId ?? () => newId('rd'))(), myBookId: myBookId, index: (last?.index ?? 0) + 1, startedAt: d, createdAt: now, updatedAt: now);
  return lib.copy(rounds: {...lib.rounds, r.id: r}, books: {...lib.books, myBookId: book.patch(status: ReadStatus.reading, currentPage: null, updatedAt: now)});
}
