import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from '../mockup-sample';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';

describe('시안 비교 책장(측정 전용)', () => {
  it('예시 책장과 같은 자리·치수·배치(책 수와 자세가 시안과 같다)', () => {
    expect(MOCKUP_LAYOUT.placements.map(({ pos, ...p }) => p)).toEqual(SAMPLE_LAYOUT.placements);
    expect(MOCKUP_BOOKS.map((b) => b.id)).toEqual(SAMPLE_BOOKS.map((b) => b.id));
    for (const [i, b] of MOCKUP_BOOKS.entries()) expect(b.physical).toEqual(SAMPLE_BOOKS[i].physical);
    const rows = MOCKUP_LAYOUT.shelves.map((sh) => new Set(MOCKUP_LAYOUT.placements.filter((p) => p.shelfId === sh.id).map((p) => p.stackId ?? p.bookId)).size);
    expect(rows).toEqual([7, 6, 4]); // 3단: 눕힌 두 권 더미 하나 + 세운 두 권 + 표지 한 권
  });
  it('시안의 세 풍경 표지와 책등 장식을 함께 사용한다', () => {
    const by = Object.fromEntries(MOCKUP_BOOKS.map((b) => [b.id, b]));
    expect(by.b04.title).toBe('느린 계절');
    expect(by.b07.title).toBe('여름의 숲');
    expect(by.b16.title).toBe('우리가 빛의 속도로 갈 수 없다면');
    expect(by.b13.title).toBe('좋은 문장은 이렇게 온다');
    expect(MOCKUP_BOOKS.filter((b) => b.cover).map((b) => b.id)).toEqual(['b04', 'b07', 'b16']);
    for (const b of MOCKUP_BOOKS) {
      expect(b.body).toBeUndefined();
      expect(b.author).toBeUndefined();
    }
    expect(by.b01.art.motif).toBe('blossom');
    // 재질: 그림 표지 세 권은 코팅지, 세 권은 천, 나머지는 무광 종이(비움)
    expect(MOCKUP_BOOKS.filter((b) => b.art.material === 'coated').map((b) => b.id)).toEqual(['b04', 'b07', 'b16']);
    expect(MOCKUP_BOOKS.filter((b) => b.art.material === 'cloth').map((b) => b.title)).toEqual(['데미안', '사람의 마음이란', '고요한 우연']);
    expect(MOCKUP_BOOKS.filter((b) => b.art.material && b.art.material !== 'coated' && b.art.material !== 'cloth')).toEqual([]);
    expect(by.b10.art.motif).toBe('moon');
    // 갈피는 시안에서 끈이 보이는 네 권
    // 갈피: 2026-10-07 사용자 참고 사진(책 색 계열 종이 탭, 두 장인 책과 한 장인 책)
    expect(MOCKUP_BOOKS.filter((b) => (b.quotes ?? 0) > 0).map((b) => [b.title, b.art.ribbonCount])).toEqual([
      ['데미안', 2], ['어린 왕자', 1], ['느린 계절', 2], ['문장 수집', 2], ['여행의 이유', 2], ['너라는 계절', 1],
    ]);
  });
});
