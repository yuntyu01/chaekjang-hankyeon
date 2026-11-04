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
  it('칸마다 다른 책이고 이름이 겹치지 않는다', () => {
    const a = lockedPreview(0).frames.map((f) => f.bookId);
    const b = lockedPreview(1).frames.map((f) => f.bookId);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});
