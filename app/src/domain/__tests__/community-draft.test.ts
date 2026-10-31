// 공유 초안: 고른 필드만, 확인된 분량만, 사진 갈피 제외, 기록 id로 중복 방지
import { defaultChoice, sessionPages, sharePayload, shareSourceOf } from '../community-draft';
import { emptyLibrary, type Library } from '../library';

const now = '2026-11-01T10:00:00.000Z';
function lib(): Library {
  const l = emptyLibrary();
  l.editions.e1 = { id: 'e1', isbn13: '9788937460449', title: '데미안', authors: ['헤르만 헤세'], source: 'search', createdAt: now, updatedAt: now };
  l.books.b1 = { id: 'b1', editionId: 'e1', status: 'reading', note: '개인 감상', createdAt: now, updatedAt: now };
  l.sessions.s1 = { id: 's1', myBookId: 'b1', startedAt: now, endedAt: now, durationMs: 1_500_000, startPage: 10, pagesRead: 25, memo: '개인 메모', createdAt: now, updatedAt: now };
  l.sessions.s2 = { id: 's2', startedAt: now, endedAt: now, durationMs: 60_000, createdAt: now, updatedAt: now };
  l.sessions.s3 = { id: 's3', myBookId: 'b1', startedAt: now, endedAt: now, durationMs: 60_000, pagesRead: 40, createdAt: now, updatedAt: now };
  l.bookmarks.q1 = { id: 'q1', myBookId: 'b1', text: '새는 알에서 나오려고 투쟁한다', page: 98, createdAt: '2026-10-01T00:00:00Z', updatedAt: now };
  l.bookmarks.q2 = { id: 'q2', myBookId: 'b1', text: '이 기록의 문장', sessionId: 's1', createdAt: '2026-09-01T00:00:00Z', updatedAt: now };
  l.bookmarks.ph = { id: 'ph', myBookId: 'b1', text: '', photoUri: 'p.jpg', createdAt: '2026-11-01T00:00:00Z', updatedAt: now };
  return l;
}

it('분량은 시작·도달 쪽이 둘 다 있을 때만 센다', () => {
  expect(sessionPages({ startPage: 10, pagesRead: 25 })).toBe(15);
  expect(sessionPages({ pagesRead: 25 })).toBeUndefined();
  expect(sessionPages({ startPage: 30, pagesRead: 25 })).toBeUndefined();
});

it('기본 선택: 시간·확인된 분량·이 기록의 갈피. 메모·감상은 넣지 않는다', () => {
  const src = shareSourceOf(lib(), 's1')!;
  expect(src.quotes.map((q) => q.id)).toEqual(['q2', 'q1']); // 이 기록의 갈피 먼저, 사진 갈피 제외
  const c = defaultChoice(src);
  expect(c).toEqual({ duration: true, pages: true, quoteId: 'q2', body: '' });
  const p = sharePayload(src, c)!;
  expect(p).toEqual({ clientId: 's1', isbn13: '9788937460449', bookTitle: '데미안', bookAuthor: '헤르만 헤세', durationMs: 1_500_000, pagesRead: 15, quote: '이 기록의 문장', quotePage: undefined, body: undefined });
  expect(JSON.stringify(p)).not.toMatch(/개인/);
});

it('끈 필드는 보내지 않는다', () => {
  const src = shareSourceOf(lib(), 's1')!;
  const p = sharePayload(src, { duration: false, pages: false, quoteId: 'q1', body: '  다시 읽고 싶다 ' })!;
  expect(p.durationMs).toBeUndefined();
  expect(p.pagesRead).toBeUndefined();
  expect(p.quote).toBe('새는 알에서 나오려고 투쟁한다');
  expect(p.quotePage).toBe(98);
  expect(p.body).toBe('다시 읽고 싶다');
});

it('도달 쪽만 있으면 분량을 켜지 않고, 책 없는 기록은 게시할 수 없다', () => {
  const l = lib();
  const src3 = shareSourceOf(l, 's3')!;
  expect(src3.pagesRead).toBeUndefined();
  expect(defaultChoice(src3).pages).toBe(false);
  expect(sharePayload(src3, { duration: true, pages: true, body: '' })!.pagesRead).toBeUndefined();
  const src2 = shareSourceOf(l, 's2')!;
  expect(sharePayload(src2, defaultChoice(src2))).toBeNull();
  expect(shareSourceOf(l, 'none')).toBeNull();
});
