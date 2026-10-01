import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from '../mockup-sample';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';

describe('시안 비교 책장(측정 전용)', () => {
  it('예시 책장과 같은 자리·치수·배치(책 수와 자세가 시안과 같다)', () => {
    expect(MOCKUP_LAYOUT).toBe(SAMPLE_LAYOUT);
    expect(MOCKUP_BOOKS.map((b) => b.id)).toEqual(SAMPLE_BOOKS.map((b) => b.id));
    for (const [i, b] of MOCKUP_BOOKS.entries()) expect(b.physical).toEqual(SAMPLE_BOOKS[i].physical);
    const rows = MOCKUP_LAYOUT.shelves.map((sh) => new Set(MOCKUP_LAYOUT.placements.filter((p) => p.shelfId === sh.id).map((p) => p.stackId ?? p.bookId)).size);
    expect(rows).toEqual([7, 6, 4]); // 3단: 눕힌 두 권 더미 하나 + 세운 두 권 + 표지 한 권
  });
  it('시안의 제목과 표지 그림: 표지 책 세 권만 그림이 있고, 책등은 제목만(장식 없음)', () => {
    const by = Object.fromEntries(MOCKUP_BOOKS.map((b) => [b.id, b]));
    expect(by.b04.title).toBe('느린 계절');
    expect(by.b07.title).toBe('여름의 숲');
    expect(by.b16.title).toBe('우리가 빛의 속도로 갈 수 없다면');
    expect(by.b13.title).toBe('좋은 문장은 이렇게 온다');
    expect(MOCKUP_BOOKS.filter((b) => b.cover).map((b) => b.id)).toEqual(['b04', 'b07', 'b16']);
    for (const b of MOCKUP_BOOKS) {
      expect(b.art.motif).toBe('none');
      expect(b.body).toBeUndefined();
      expect(b.author).toBeUndefined();
    }
    // 갈피는 시안에서 끈이 보이는 네 권
    expect(MOCKUP_BOOKS.filter((b) => (b.quotes ?? 0) > 0).map((b) => b.title)).toEqual(['어린 왕자', '느린 하루', '작은 것들의 기쁨', '아무튼, 독서']);
  });
});
