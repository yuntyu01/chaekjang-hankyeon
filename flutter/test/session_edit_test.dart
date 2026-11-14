// 독서 기록 수정 규칙(지금 앱 domain/session-edit.ts·library.ts updateSessionIn)
import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/domain/session_edit.dart';
import 'package:flutter_test/flutter_test.dart';

String local(int y, int m, int d, int h, int mi, [int s = 0]) => DateTime(y, m, d, h, mi, s).toUtc().toIso8601String();

Session session({String? book = 'a', String? round = 'r-a'}) => Session(
      id: 's1',
      myBookId: book,
      roundId: round,
      // 20:00:10 시작, 20:40:10 끝, 실제 독서 25분 30초(일시정지 14분 30초)
      startedAt: local(2026, 11, 3, 20, 0, 10),
      endedAt: local(2026, 11, 3, 20, 40, 10),
      durationMs: 25 * 60000 + 30000,
      createdAt: local(2026, 11, 3, 20, 40, 10),
      updatedAt: local(2026, 11, 3, 20, 40, 10),
      memo: '메모',
    );

void main() {
  test('화면 값: 현지 날짜·시각, 분은 반올림(1분 이상)', () {
    final f = sessionFormOf(session());
    expect([f.day, f.time, f.minutes, f.memo, f.pages], ['2026-11-03', '20:00', '26', '메모', '']);
  });

  test('메모만 고치면 시각·초 단위 시간은 그대로', () {
    final s = session(), f = sessionFormOf(s);
    final p = sessionEditPatch(s, f, (bookId: f.bookId, day: f.day, time: f.time, minutes: f.minutes, startPage: f.startPage, pages: f.pages, memo: ' 새 메모 '))!;
    expect(p, {'memo': '새 메모'});
  });

  test('시각을 옮기면 시작·끝을 같은 만큼(초 단위 그대로), 고친 칸이 틀리면 저장 막기', () {
    final s = session(), f = sessionFormOf(s);
    final p = sessionEditPatch(s, f, (bookId: f.bookId, day: f.day, time: '21:30', minutes: f.minutes, startPage: '', pages: '', memo: f.memo))!;
    expect(p['startedAt'], local(2026, 11, 3, 21, 30, 10));
    expect(p['endedAt'], local(2026, 11, 3, 22, 10, 10));
    expect(sessionEditPatch(s, f, (bookId: f.bookId, day: '2026-1-3', time: f.time, minutes: f.minutes, startPage: '', pages: '', memo: f.memo)), isNull);
    expect(sessionEditPatch(s, f, (bookId: f.bookId, day: f.day, time: f.time, minutes: '0', startPage: '', pages: '', memo: f.memo)), isNull);
  });

  test('독서 시간을 늘리면 끝은 시작 + 새 시간이 기존 끝보다 늦을 때만 늦춘다', () {
    final s = session(), f = sessionFormOf(s);
    final longer = sessionEditPatch(s, f, (bookId: f.bookId, day: f.day, time: f.time, minutes: '60', startPage: '', pages: '', memo: f.memo))!;
    expect(longer['durationMs'], 3600000);
    expect(longer['endedAt'], local(2026, 11, 3, 21, 0, 10));
    final shorter = sessionEditPatch(s, f, (bookId: f.bookId, day: f.day, time: f.time, minutes: '10', startPage: '', pages: '', memo: f.memo))!;
    expect(shorter.containsKey('endedAt'), isFalse);
  });

  test('책 연결을 끊거나 바꾸면 회차도 그 책 것으로(없으면 비움), 지우면 갈피는 연결만 비운다', () {
    final lib = Library();
    for (final id in ['a', 'b']) {
      lib.books[id] = MyBook(id: id, editionId: 'e', status: ReadStatus.reading, createdAt: '', updatedAt: '');
    }
    lib.rounds['r-b'] = Round(id: 'r-b', myBookId: 'b', index: 1, createdAt: '', updatedAt: '', startedAt: '2026-11-01');
    lib.sessions['s1'] = session();
    lib.bookmarks['m1'] = Bookmark(id: 'm1', myBookId: 'a', text: '문장', createdAt: '', updatedAt: '', sessionId: 's1');
    final moved = updateSessionIn(lib, 's1', {'myBookId': 'b'}, 'now');
    expect([moved.sessions['s1']!.myBookId, moved.sessions['s1']!.roundId], ['b', 'r-b']);
    final cut = updateSessionIn(lib, 's1', {'myBookId': null}, 'now');
    expect([cut.sessions['s1']!.myBookId, cut.sessions['s1']!.roundId], [null, null]);
    expect(identical(updateSessionIn(lib, 's1', {'memo': '메모'}, 'now'), lib), isTrue); // 바뀐 것 없음
    final gone = deleteSessionIn(lib, 's1', 'now');
    expect(gone.sessions.containsKey('s1'), isFalse);
    expect(gone.bookmarks['m1']!.sessionId, isNull);
    expect(gone.bookmarks['m1']!.text, '문장');
  });
}
