// 읽기 탭 규칙이 지금 앱과 같은지(tool/dump_reading.test.ts가 지금 앱 함수로 뽑은 값)
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/domain/reading.dart';
import 'package:flutter_test/flutter_test.dart';

typedef J = Map<String, dynamic>;

MyBook _book(J j) => MyBook(
      id: j['id'],
      editionId: j['editionId'],
      status: readStatusOf(j['status']),
      createdAt: j['createdAt'],
      updatedAt: j['updatedAt'],
      rating: j['rating'],
      note: j['note'],
      ribbonColor: j['ribbonColor'],
      currentPage: j['currentPage'],
      bindingId: j['bindingId'],
      hiddenAt: j['hiddenAt'],
    );

Round _round(J j) => Round(
      id: j['id'],
      myBookId: j['myBookId'],
      index: j['index'],
      createdAt: j['createdAt'],
      updatedAt: j['updatedAt'],
      startedAt: j['startedAt'],
      finishedAt: j['finishedAt'],
      paused: j['paused'] == true,
    );

Session _session(J j) => Session(
      id: j['id'],
      startedAt: j['startedAt'],
      endedAt: j['endedAt'],
      durationMs: j['durationMs'],
      createdAt: j['createdAt'],
      updatedAt: j['updatedAt'],
      myBookId: j['myBookId'],
      roundId: j['roundId'],
      startPage: j['startPage'],
      pagesRead: j['pagesRead'],
      memo: j['memo'],
    );

Active _active(J j) => Active.fromJson(j.cast<String, Object?>());

/// JSON 견주기: 숫자는 값으로
Object? norm(Object? v) => switch (v) {
      num n => n.toDouble(),
      Map m => {for (final e in m.entries) e.key: norm(e.value)},
      List l => [for (final x in l) norm(x)],
      _ => v,
    };

void main() {
  final d = jsonDecode(File('test/fixtures/reading_cases.json').readAsStringSync()) as J;
  Map<String, T> table<T>(String k, T Function(J) f) => {for (final e in (d[k] as J).entries) e.key: f(e.value as J)};
  final lib = Library(
    books: table('books', _book),
    rounds: table('rounds', _round),
    sessions: table('sessions', _session),
    editions: table('editions', (j) => Edition(id: j['id'], title: j['title'], authors: (j['authors'] as List).cast(), source: j['source'], createdAt: j['createdAt'], updatedAt: j['updatedAt'])),
  );

  test('오늘 읽은 시간', () {
    for (final c in (d['todays'] as List).cast<J>()) {
      final r = todayRead(lib, c['day']);
      expect(norm([r.total, r.noBook, r.byBook]), norm([c['total'], c['noBook'], c['byBook']]), reason: c['day']);
    }
  });

  test('목록 차례', () {
    for (final c in (d['lists'] as List).cast<J>()) {
      final out = readListIds(lib, day: c['day'], activeId: c['activeId'], focusId: c['focusId'], added: ((c['added'] ?? []) as List).cast());
      expect(out, c['out'], reason: jsonEncode(c));
    }
  });

  test('시간 글자·책 고르기 차례', () {
    for (final c in (d['times'] as List).cast<J>()) {
      expect(hms(c['ms']), c['hms'], reason: '${c['ms']}');
      expect(clock((c['ms'] as num) < 0 ? 0 : c['ms']), c['clock'], reason: '${c['ms']}');
    }
    expect(recentBookIds(lib), d['recent']);
  });

  test('독서 저장(회차 확보·쪽 옮기기)', () {
    var n = 0;
    for (final c in (d['adds'] as List).cast<J>()) {
      final i = c['input'] as J;
      final r = addSessionTo(
        lib,
        SessionInput(id: i['id'], myBookId: i['myBookId'], startedAt: i['startedAt'], endedAt: i['endedAt'], durationMs: i['durationMs'], startPage: i['startPage'], pagesRead: i['pagesRead'], memo: i['memo']),
        d['now'],
        sessionId: () => 'ss_fixed${n++}',
        roundId: () => 'NEW',
      );
      final s = r.lib.sessions[r.id]!.toJson();
      expect(norm(s), norm(c['session']), reason: jsonEncode(i));
      final rounds = [for (final x in r.lib.rounds.values) if (lib.rounds[x.id] == null) (x.toJson()..remove('id'))];
      expect(norm(rounds), norm(c['newRounds']), reason: jsonEncode(i));
      final books = [for (final b in r.lib.books.values) if (!identical(lib.books[b.id], b)) b.toJson()];
      expect(norm(books), norm(c['changedBooks']), reason: jsonEncode(i));
    }
  });

  test('강제 종료 복구·끝내기', () {
    for (final c in (d['recovers'] as List).cast<J>()) {
      final r = recoverOnLoad(_active(c['saved']), ((d['finishes'] as List).first as J)['now']);
      final o = c['out'] as J;
      expect(norm(r.active?.toJson()), norm(o['active']));
      final it = o['interrupted'] as J?;
      expect(r.interrupted == null, it == null);
      if (it != null) {
        expect(norm([r.interrupted!.active.toJson(), r.interrupted!.countedMs, r.interrupted!.lastBeat, r.interrupted!.gapMs]),
            norm([it['active'], it['countedMs'], it['lastBeat'], it['gapMs']]));
      }
    }
    for (final c in (d['finishes'] as List).cast<J>()) {
      final f = finishActive(_active(c['active']), c['now'], c['endAt']);
      expect(norm(f.toJson()), norm(c['out']), reason: jsonEncode(c));
    }
  });
}
