// 우리 서버(YES24) 검색 결과 → 책 후보. 쪽수·판형은 있을 때만, 출처와 상품 링크를 함께 넘긴다(YES24 약관)
import { genreOf } from '@/domain/rebinding';
import { fromServer } from '../book-search';

describe('서버 검색 결과(YES24)', () => {
  it('쪽수·가로·세로(mm)·표지·출처·상품 링크를 옮긴다', () => {
    const c = fromServer({ isbn13: '9788998441012', title: '모순', authors: ['양귀자'], publisher: '쓰다', publishedAt: '2013-04-01', thumbnailUrl: 'https://image.yes24.com/goods/8759796/L', pages: 308, widthMm: 128, heightMm: 188, link: 'https://www.yes24.com/product/goods/8759796', provider: 'yes24' });
    expect(c).toMatchObject({ key: 'yes24:9788998441012', title: '모순', authors: ['양귀자'], isbn13: '9788998441012', pageCount: 308, size: { widthMm: 128, heightMm: 188 }, sourceName: 'YES24', link: 'https://www.yes24.com/product/goods/8759796' });
  });
  it('YES24 분류·시리즈를 장정 입력(모티프·시리즈 색)으로 넘긴다', () => {
    const c = fromServer({ isbn13: '9791193790403', title: '해리 포터와 마법사의 돌 1', category: '국내도서>소설/시/희곡', series: '해리 포터 20주년 개정판', provider: 'yes24' });
    expect(c).toMatchObject({ category: '국내도서>소설/시/희곡', seriesTitle: '해리 포터 20주년 개정판' });
    expect(genreOf(c.category)).toBe('novel');
  });
  it('판본 정보가 없으면 비워 둔다(추정하지 않는다)', () => {
    const c = fromServer({ isbn13: '9791193790403', title: '해리 포터', provider: 'yes24' });
    expect(c.pageCount).toBeUndefined();
    expect(c.size).toBeUndefined();
    expect(c.coverUrl).toBeUndefined();
    expect(c.authors).toEqual([]);
    expect(c.category).toBeUndefined();
    expect(c.seriesTitle).toBeUndefined();
  });
});
