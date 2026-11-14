// 지금 앱 domain/__tests__/community-draft.test.ts와 같은 시험
import 'dart:convert';

import 'package:chaekjang/domain/community_draft.dart';
import 'package:chaekjang/domain/library.dart';
import 'package:flutter_test/flutter_test.dart';

const now = '2026-11-01T10:00:00.000Z';

Library lib({String? coverUri, String? coverSource}) => Library(
      editions: {'e1': Edition(id: 'e1', isbn13: '9788937460449', title: '데미안', authors: const ['헤르만 헤세'], source: 'search', createdAt: now, updatedAt: now, coverUri: coverUri, coverSource: coverSource)},
      books: {'b1': MyBook(id: 'b1', editionId: 'e1', status: ReadStatus.reading, note: '개인 감상', createdAt: now, updatedAt: now)},
      sessions: {
        's1': Session(id: 's1', myBookId: 'b1', startedAt: now, endedAt: now, durationMs: 1500000, startPage: 10, pagesRead: 25, memo: '개인 메모', createdAt: now, updatedAt: now),
        's2': Session(id: 's2', startedAt: now, endedAt: now, durationMs: 60000, createdAt: now, updatedAt: now),
        's3': Session(id: 's3', myBookId: 'b1', startedAt: now, endedAt: now, durationMs: 60000, pagesRead: 40, createdAt: now, updatedAt: now),
      },
      bookmarks: {
        'q1': Bookmark(id: 'q1', myBookId: 'b1', text: '새는 알에서 나오려고 투쟁한다', page: 98, createdAt: '2026-10-01T00:00:00Z', updatedAt: now),
        'q2': Bookmark(id: 'q2', myBookId: 'b1', text: '이 기록의 문장', sessionId: 's1', createdAt: '2026-09-01T00:00:00Z', updatedAt: now),
        'ph': Bookmark(id: 'ph', myBookId: 'b1', text: '', photoUri: 'p.jpg', createdAt: '2026-11-01T00:00:00Z', updatedAt: now),
      },
    );

void main() {
  test('분량은 시작·도달 쪽이 둘 다 있을 때만 센다', () {
    expect(sessionPages(10, 25), 15);
    expect(sessionPages(null, 25), isNull);
    expect(sessionPages(30, 25), isNull);
  });
  test('기본 선택: 시간·확인된 분량·이 기록의 갈피. 메모·감상은 넣지 않는다', () {
    final src = shareSourceOf(lib(), 's1')!;
    expect([for (final q in src.quotes) q.id], ['q2', 'q1']); // 이 기록의 갈피 먼저, 사진 갈피 제외
    final c = defaultChoice(src);
    expect(c, (duration: true, pages: true, quoteId: 'q2', body: ''));
    final p = sharePayload(src, c)!;
    expect(p, {'clientId': 's1', 'isbn13': '9788937460449', 'bookTitle': '데미안', 'bookAuthor': '헤르만 헤세', 'durationMs': 1500000, 'pagesRead': 15, 'quote': '이 기록의 문장'});
    expect(jsonEncode(p).contains('개인'), isFalse);
  });
  test('끈 필드는 보내지 않는다', () {
    final p = sharePayload(shareSourceOf(lib(), 's1')!, (duration: false, pages: false, quoteId: 'q1', body: '  다시 읽고 싶다 '))!;
    expect(p.containsKey('durationMs'), isFalse);
    expect(p.containsKey('pagesRead'), isFalse);
    expect([p['quote'], p['quotePage'], p['body']], ['새는 알에서 나오려고 투쟁한다', 98, '다시 읽고 싶다']);
  });
  test('도달 쪽만 있으면 분량을 켜지 않고, 책 없는 기록은 게시할 수 없다', () {
    final l = lib();
    final src3 = shareSourceOf(l, 's3')!;
    expect(src3.pagesRead, isNull);
    expect(defaultChoice(src3).pages, isFalse);
    expect(sharePayload(src3, (duration: true, pages: true, quoteId: null, body: ''))!.containsKey('pagesRead'), isFalse);
    final src2 = shareSourceOf(l, 's2')!;
    expect(sharePayload(src2, defaultChoice(src2)), isNull);
    expect(shareSourceOf(l, 'none'), isNull);
  });
  test('공유 표지는 도서 정보 제공처 표지만(https로), 내가 찍은 표지 사진은 보내지 않는다', () {
    Edition ed(String uri, String source) => Edition(id: 'x', title: 't', authors: const [], source: 'search', createdAt: now, updatedAt: now, coverUri: uri, coverSource: source);
    expect(publicCover(ed('https://image.yes24.com/goods/1/XL', 'api')), 'https://image.yes24.com/goods/1/XL');
    expect(publicCover(ed('http://books.google.com/x.jpg', 'api')), 'https://books.google.com/x.jpg');
    expect(publicCover(ed('file:///data/user/0/images/a.jpg', 'photo')), isNull);
    expect(publicCover(ed('file:///x.jpg', 'api')), isNull);
    expect(publicCover(null), isNull);
    const c = (duration: true, pages: true, quoteId: null, body: '');
    expect(sharePayload(shareSourceOf(lib(coverUri: 'https://image.yes24.com/goods/1/XL', coverSource: 'api'), 's1')!, c)!['coverUrl'], 'https://image.yes24.com/goods/1/XL');
    expect(sharePayload(shareSourceOf(lib(coverUri: 'file:///mine.jpg', coverSource: 'photo'), 's1')!, c)!.containsKey('coverUrl'), isFalse);
  });
}
