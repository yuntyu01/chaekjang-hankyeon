// 독서 기록 수정(지금 앱 domain/session-edit.ts·library.ts updateSessionIn): 화면 입력 → 바꿀 필드만 담은 수정.
// 화면은 날짜·시작 시각을 분 단위, 독서 시간을 분으로 보여 주지만, 사용자가 그 칸을 고치지 않았으면 저장된 값(초·일시정지 구간)을 그대로 둔다.
// - 날짜·시각을 고치면 시작·끝을 같은 만큼 옮긴다(시작~끝 사이 일시정지 구간 길이 보존, 초 단위 그대로).
// - 독서 시간을 고치면 실제 독서 시간만 바꾸고, 끝 시각은 시작 + 새 시간이 기존 끝보다 늦을 때만 늦춘다.
// - 책: 고르지 않았으면 키를 넣지 않고(그대로), 연결을 끊었으면 myBookId: null(명시적 해제)
library;

import 'library.dart';

typedef SessionForm = ({String? bookId, String day, String time, String minutes, String startPage, String pages, String memo});

/// 바꿀 필드만(키가 있으면 그 값으로, null이면 비운다). 키: myBookId·startedAt·endedAt·durationMs·startPage·pagesRead·memo
typedef SessionPatch = Map<String, Object?>;

String _pad(int n) => n.toString().padLeft(2, '0');

SessionForm sessionFormOf(Session s) {
  final d = DateTime.parse(s.startedAt).toLocal();
  return (
    bookId: s.myBookId,
    day: '${d.year}-${_pad(d.month)}-${_pad(d.day)}',
    time: '${_pad(d.hour)}:${_pad(d.minute)}',
    minutes: '${(s.durationMs / 60000).round() < 1 ? 1 : (s.durationMs / 60000).round()}',
    startPage: s.startPage != null && s.startPage != 0 ? '${s.startPage}' : '',
    pages: s.pagesRead != null && s.pagesRead != 0 ? '${s.pagesRead}' : '',
    memo: s.memo ?? '',
  );
}

bool validDay(String v) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v);
bool validTime(String v) => RegExp(r'^\d{1,2}:\d{2}$').hasMatch(v);

int _localMs(String day, String time) {
  final d = day.split('-').map(int.parse).toList();
  final t = time.split(':').map(int.parse).toList();
  return DateTime(d[0], d[1], d[2], t[0], t[1]).millisecondsSinceEpoch;
}

String _iso(int ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true).toIso8601String();

int? _positive(String v) {
  final n = num.tryParse(v.trim());
  return v.trim().isNotEmpty && n != null && n.isFinite && n > 0 ? n.round() : null;
}

/// 고친 칸만 수정에 넣는다. 고친 칸이 형식에 맞지 않으면 null(저장 막기)
SessionPatch? sessionEditPatch(Session s, SessionForm initial, SessionForm form) {
  final patch = <String, Object?>{};
  if (form.bookId != initial.bookId) patch['myBookId'] = form.bookId;
  var start = DateTime.parse(s.startedAt).millisecondsSinceEpoch;
  var end = DateTime.parse(s.endedAt).millisecondsSinceEpoch;
  if (form.day != initial.day || form.time != initial.time) {
    if (!validDay(form.day) || !validTime(form.time)) return null;
    final delta = _localMs(form.day, form.time) - _localMs(initial.day, initial.time);
    if (delta != 0) {
      start += delta;
      end += delta;
      patch['startedAt'] = _iso(start);
      patch['endedAt'] = _iso(end);
    }
  }
  if (form.minutes.trim() != initial.minutes.trim()) {
    final m = num.tryParse(form.minutes.trim());
    if (m == null || !m.isFinite || m <= 0) return null;
    final durationMs = (m * 60000).round();
    if (durationMs != s.durationMs) {
      patch['durationMs'] = durationMs;
      if (start + durationMs > end) patch['endedAt'] = _iso(start + durationMs);
    }
  }
  if (form.pages.trim() != initial.pages.trim()) patch['pagesRead'] = _positive(form.pages);
  if (form.startPage.trim() != initial.startPage.trim()) patch['startPage'] = _positive(form.startPage);
  if (form.memo.trim() != initial.memo.trim()) patch['memo'] = form.memo.trim().isEmpty ? null : form.memo.trim();
  return patch;
}

/// 독서 기록 수정: 준 필드만 바꾼다. myBookId 키가 있으면 연결을 바꾸거나(값) 끊는다(null) — 키가 없으면 그대로.
/// 연결이 바뀌면 회차도 새 책의 회차로(없으면 비움, 지난 기록 수정으로 회차를 새로 만들지 않는다). 다른 책의 회차는 남기지 않는다
Library updateSessionIn(Library lib, String id, SessionPatch patch, String now) {
  final s = lib.sessions[id];
  if (s == null) return lib;
  final cur = <String, Object?>{
    'myBookId': s.myBookId,
    'startedAt': s.startedAt,
    'endedAt': s.endedAt,
    'durationMs': s.durationMs,
    'startPage': s.startPage,
    'pagesRead': s.pagesRead,
    'memo': s.memo,
  };
  final changed = [for (final k in patch.keys) if (cur.containsKey(k) && patch[k] != cur[k]) k];
  if (changed.isEmpty) return lib;
  final v = {...cur, for (final k in changed) k: patch[k]};
  var bookId = v['myBookId'] as String?;
  var roundId = s.roundId;
  if (changed.contains('myBookId')) {
    bookId = bookId != null && lib.books.containsKey(bookId) ? bookId : null;
    roundId = bookId == null ? null : currentRound(lib, bookId)?.id;
  } else if (roundId != null && lib.rounds[roundId]?.myBookId != bookId) {
    roundId = null;
  }
  final next = Session(
    id: s.id,
    startedAt: v['startedAt']! as String,
    endedAt: v['endedAt']! as String,
    durationMs: v['durationMs']! as num,
    createdAt: s.createdAt,
    updatedAt: now,
    myBookId: bookId,
    roundId: roundId,
    startPage: v['startPage'] as num?,
    pagesRead: v['pagesRead'] as num?,
    memo: v['memo'] as String?,
  );
  return lib.copy(sessions: {...lib.sessions, id: next});
}

/// 기록을 지우면 그 기록에 연결된 갈피는 연결만 비운다(갈피 원문은 그대로)
Library deleteSessionIn(Library lib, String id, String now) {
  if (!lib.sessions.containsKey(id)) return lib;
  final marks = {...lib.bookmarks};
  for (final m in lib.bookmarks.values) {
    if (m.sessionId == id) marks[m.id] = m.withoutSession(now);
  }
  return lib.copy(sessions: {...lib.sessions}..remove(id), bookmarks: marks);
}
