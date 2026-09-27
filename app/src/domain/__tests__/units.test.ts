// 480mm 선반, 두께 2배(최소 30DU) 규칙과 자세별 점유 폭
import { bookHeight, bookThickness, DU_PER_MM, frontWidth, MIN_SPINE_DU, mm, SHELF_LENGTH_MM, SHELF_USABLE_WIDTH, singleFootprint, stackFootprint, thicknessMm } from '../geometry';
import { checkSpace, shelfItems, usedWidth, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import type { Book, ShelfLayout } from '../types';

const book = (id: string, widthMm: number, heightMm: number, pages: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: widthMm / heightMm,
  art: { motif: 'leaf' },
  physical: { widthMm, heightMm, pages },
});

describe('단위', () => {
  it('선반 사용 폭이 480mm에 대응한다', () => {
    expect(SHELF_LENGTH_MM).toBe(480);
    expect(mm(480)).toBeCloseTo(SHELF_USABLE_WIDTH, 6);
    expect(DU_PER_MM).toBeGreaterThan(0.7);
  });

  it('높이·표지 폭은 실제 비율, 두께는 2배(최소 30DU)', () => {
    const b = book('x', 152, 225, 600);
    expect(bookHeight(b)).toBeCloseTo(mm(225), 6);
    expect(frontWidth(b)).toBeCloseTo(mm(152), 6);
    expect(bookThickness(b)).toBeCloseTo(mm(thicknessMm(600)) * 2, 6);
    expect(bookThickness(book('thin', 110, 175, 100))).toBe(MIN_SPINE_DU);
  });

  it('자세별 점유 폭: 세움=두께, 누움=책 높이, 표지=표지 폭(+옆면), 쌓기=가장 긴 책', () => {
    const b = book('x', 140, 210, 300);
    expect(singleFootprint(b, { pose: 'spine', tilt: 0 }).width).toBeCloseTo(bookThickness(b), 6);
    expect(singleFootprint(b, { pose: 'horizontal', tilt: 0 }).width).toBeCloseTo(mm(210), 6);
    expect(singleFootprint(b, { pose: 'front', tilt: 0 }).width).toBeGreaterThan(mm(140));
    const long = book('y', 152, 225, 300);
    expect(stackFootprint([b, long]).width).toBeGreaterThanOrEqual(mm(225));
  });
});

describe('선반 용량', () => {
  it('보통 책(300쪽)은 세워서 12권까지, 13권째에서 넘친다', () => {
    const books: BookMap = {};
    const layout = (n: number): ShelfLayout => ({
      version: 2,
      drawer: [],
      shelves: [{ id: 's', order: 0 }],
      placements: Array.from({ length: n }, (_, i) => ({ bookId: `b${i}`, shelfId: 's', order: i, pose: 'spine' as const, tilt: 0 as const })),
    });
    for (let i = 0; i < 20; i++) books[`b${i}`] = book(`b${i}`, 140, 210, 300);
    // 300쪽: (300×0.06+1.5)mm × 2 = 39mm → 480mm / 39mm ≈ 12.3권
    expect(checkSpace(layout(12), books)).toBeNull();
    expect(checkSpace(layout(13), books)).toBe('no-space');
  });

  it('예시 책장 세 줄이 모두 선반 안에 들어간다', () => {
    const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
    for (const s of SAMPLE_LAYOUT.shelves) {
      expect(usedWidth(shelfItems(SAMPLE_LAYOUT, s.id), SAMPLE_LAYOUT, books)).toBeLessThanOrEqual(SHELF_USABLE_WIDTH);
    }
    expect(SAMPLE_BOOKS.every((b) => b.physical && b.physical.pages > 0)).toBe(true);
  });
});
