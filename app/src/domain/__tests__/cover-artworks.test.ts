// 기본 정면 장정 그림: 고정 id(저장·백업·동기화 값), 그림·썸네일 자산, 제목 색, 판형에 맞춘 자리(찌그러뜨리지 않음)
import { ARTWORK_INK, artworkCover, COVER_ARTWORK_IDS, COVER_ARTWORKS, coverArtwork, focusedRect, isCoverArtworkId } from '../cover-artworks';

describe('기본 정면 장정 그림', () => {
  it('여섯 그림, id는 고정 값 그대로·겹치지 않음, 그림·썸네일 자산이 있다', () => {
    expect(COVER_ARTWORKS.map((a) => a.id)).toEqual(['forest-path', 'sunset-sea', 'moon-lake', 'autumn-field', 'flower-garden', 'winter-forest']);
    expect([...COVER_ARTWORK_IDS]).toEqual(COVER_ARTWORKS.map((a) => a.id));
    expect(new Set(COVER_ARTWORKS.map((a) => a.name)).size).toBe(6);
    for (const a of COVER_ARTWORKS) {
      expect(a.image).toBeTruthy();
      expect(a.thumb).toBeTruthy();
      expect(a.thumb).not.toBe(a.image);
    }
  });
  it('제목 색: 어두운 하늘(달빛 호수)만 아이보리, 나머지는 따뜻한 먹색', () => {
    expect(COVER_ARTWORKS.filter((a) => a.ink === 'light').map((a) => a.id)).toEqual(['moon-lake']);
    expect(artworkCover('moon-lake', '#123456')!.ink).toBe(ARTWORK_INK.light);
    expect(artworkCover('flower-garden', '#123456')!.ink).toBe(ARTWORK_INK.dark);
  });
  it('책에 입힐 때 책 색(edge)은 사용자가 정한 색 그대로, 모르는 id는 없음', () => {
    expect(artworkCover('sunset-sea', '#8DA5B9')).toMatchObject({ edge: '#8DA5B9', artworkId: 'sunset-sea' });
    expect(artworkCover(undefined, '#8DA5B9')).toBeUndefined();
    expect(artworkCover('mars', '#8DA5B9')).toBeUndefined();
    expect(isCoverArtworkId('winter-forest')).toBe(true);
    expect(isCoverArtworkId('Winter-Forest')).toBe(false);
    expect(coverArtwork('forest-path')?.name).toBe('숲길');
  });
  it('판형에 맞춘 자리: 가로세로 비를 지키며 면을 덮고, 넓은 판형은 위보다 아래를 더 자른다', () => {
    // 2:3 그림, 표지 118×169(그림보다 조금 넓다)
    const r = focusedRect(720, 1080, 118, 169, 0.35);
    expect(r.width / r.height).toBeCloseTo(720 / 1080, 6);
    expect(r.x).toBeLessThanOrEqual(1e-9);
    expect(r.y).toBeLessThanOrEqual(1e-9);
    expect(r.x + r.width).toBeGreaterThanOrEqual(118 - 1e-9);
    expect(r.y + r.height).toBeGreaterThanOrEqual(169 - 1e-9);
    // 넓은 판형(세로가 잘림): 위에서 35%, 아래에서 65%
    const wide = focusedRect(720, 1080, 150, 169, 0.35);
    const cut = wide.height - 169;
    expect(-wide.y).toBeCloseTo(cut * 0.35, 6);
    // 좁은 판형(가로가 잘림): 가운데
    const narrow = focusedRect(720, 1080, 100, 169, 0.35);
    expect(narrow.x).toBeCloseTo((100 - narrow.width) / 2, 6);
  });
});
