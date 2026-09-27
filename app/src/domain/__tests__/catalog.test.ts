import { heightFromFormat, thicknessFromPages, toShelfBook, type CatalogBook } from '../catalog';
import { defaultMotifFor, MOTIF_SLOTS } from '../motif-slots';

const c: CatalogBook = {
  isbn13: '9788937460449',
  title: '데미안',
  authors: ['헤르만 헤세'],
  themeColor: '#2F5A45',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverUrl: 'https://example.com/c.jpg',
};

describe('두께·높이 등급', () => {
  it.each([
    [undefined, 'medium'],
    [120, 'thin'],
    [219, 'thin'],
    [220, 'medium'],
    [419, 'medium'],
    [600, 'thick'],
  ] as const)('%s쪽 → %s', (pages, cls) => expect(thicknessFromPages(pages)).toBe(cls));

  it.each([
    ['128*188mm', 'short'],
    ['152x225mm', 'medium'],
    ['188×257', 'tall'],
    ['A5', 'medium'],
    ['B6', 'short'],
    ['알 수 없음', 'medium'],
    [undefined, 'medium'],
  ] as const)('%s → %s', (f, cls) => expect(heightFromFormat(f)).toBe(cls));
});

describe('Book 매핑', () => {
  it('사용자 색·모티프가 우선하고, 완독일은 읽음일 때만', () => {
    const u = {
      isbn13: c.isbn13,
      status: 'read' as const,
      finishedAt: '2026-09-01',
      customThemeColor: '#111111',
      customMotifId: 'moon',
      coverDisplay: false,
      createdAt: '',
      updatedAt: '',
    };
    const b = toShelfBook(c, u);
    expect(b).toMatchObject({ id: c.isbn13, themeColor: '#111111', art: { motif: 'moon' }, finishedAt: '2026-09-01', originalCoverUri: c.coverUrl });
    expect(toShelfBook(c, { ...u, status: 'reading' }).finishedAt).toBeUndefined();
  });

  it('모르는 모티프 id는 ISBN 기본 모티프로', () => {
    expect(toShelfBook({ ...c, defaultMotifId: 'nope' }).art.motif).toBe(defaultMotifFor(c.isbn13));
  });

  it('기본 모티프 해시는 서버(Go DefaultMotifFor)와 같다', () => {
    expect(defaultMotifFor('9788937460449')).toBe('constellation');
    expect(defaultMotifFor('9791190090018')).toBe('window');
  });

  it('모티프 슬롯은 30개이고 id가 겹치지 않는다', () => {
    expect(MOTIF_SLOTS).toHaveLength(30);
    expect(new Set(MOTIF_SLOTS.map((m) => m.id)).size).toBe(30);
  });
});

describe('실제 크기', () => {
  it('판형·쪽수가 있으면 physical로 넘긴다', () => {
    const b = toShelfBook({ ...c, format: '132*225mm', pageCount: 232 });
    expect(b.physical).toEqual({ widthMm: 132, heightMm: 225, pages: 232 });
    expect(toShelfBook(c).physical).toBeUndefined();
  });
});
