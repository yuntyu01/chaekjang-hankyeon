import { lockedPreview } from '../locked-preview';

describe('잠긴 선반의 예시 책', () => {
  it('칸마다 책 상자가 있고 표지 그림은 없다', () => {
    for (const row of [0, 1]) {
      const { frames, books } = lockedPreview(row);
      expect(frames.length).toBeGreaterThan(0);
      for (const f of frames) {
        const b = books[f.bookId];
        expect(b).toBeDefined();
        expect(b.originalCoverUri).toBeUndefined();
        expect(b.coverArtUri).toBeUndefined();
      }
    }
  });
  it('정면 책이 없고 표지 그림 대신 민무늬다(2026-11-05 사용자 정면 장정이 별로)', () => {
    for (const row of [0, 1, 2, 3]) {
      const { frames, books } = lockedPreview(row);
      for (const f of frames) {
        expect(f.pose).not.toBe('front');
        expect(books[f.bookId].art.plainCover).toBe(true);
        expect(books[f.bookId].cover).toBeUndefined();
      }
    }
  });
  it('칸 폭(366)을 넘지 않고 좌우가 고르다', () => {
    for (const row of [0, 1, 2]) {
      const { frames } = lockedPreview(row);
      const left = Math.min(...frames.map((f) => f.box.x));
      const right = Math.max(...frames.map((f) => f.box.x + f.box.size.w));
      expect(left).toBeGreaterThan(5);
      expect(right).toBeLessThan(361);
    }
  });
  it('칸마다 다른 책이고 이름이 겹치지 않는다', () => {
    const a = lockedPreview(0).frames.map((f) => f.bookId);
    const b = lockedPreview(1).frames.map((f) => f.bookId);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});
