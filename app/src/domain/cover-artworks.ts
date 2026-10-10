// 기본 정면 장정 그림(사용자가 여러 책에 골라 입히는 공통 표지 그림, 2026-10-10). 제목 없는 평면 풍경이라 제목은 기존 조판으로 위 여백에 얹는다.
// 원본(1024×1536)은 docs/design/cover-artworks/에 그대로 보관하고, 앱에는 720×1080(표지)과 180×270(고르기 화면 썸네일) JPEG만 넣는다.
// id는 저장·백업·동기화에 쓰는 고정 값이다(이름이나 순서를 바꿔도 id는 바꾸지 않는다).
// ink: 제목이 놓이는 하늘 띠(세로 9~27%, 가로 12~88%)의 평균 밝기로 정한 제목 색(대비가 큰 쪽, 모두 5.8:1 이상).
//   dark = 따뜻한 먹색, light = 아이보리(달빛 호수만 어두운 하늘)
// focusY: 책 판형이 그림(2:3)보다 넓어 위아래가 잘릴 때 위에서 자르는 몫(0 = 위를 다 남김, 0.5 = 가운데). 위 제목 여백과 아래 풍경을 함께 남기려 0.35
import type { CoverArt } from './types';

export const COVER_ARTWORK_IDS = ['forest-path', 'sunset-sea', 'moon-lake', 'autumn-field', 'flower-garden', 'winter-forest'] as const;
export type CoverArtworkId = (typeof COVER_ARTWORK_IDS)[number];

export type CoverArtwork = { id: CoverArtworkId; name: string; image: number; thumb: number; ink: 'dark' | 'light' };

export const ARTWORK_INK = { dark: '#4A3F3A', light: '#F7EEDC' } as const;
// 제목 칸 위 끝(표지 높이에 대한 몫): 그림 하늘 여백 안
export const ARTWORK_TITLE_TOP = 0.11;
export const ARTWORK_FOCUS_Y = 0.35;

export const COVER_ARTWORKS: CoverArtwork[] = [
  { id: 'forest-path', name: '숲속 오솔길', image: require('../../assets/covers/artworks/forest-path.jpg'), thumb: require('../../assets/covers/artworks/forest-path-thumb.jpg'), ink: 'dark' },
  { id: 'sunset-sea', name: '노을 바다', image: require('../../assets/covers/artworks/sunset-sea.jpg'), thumb: require('../../assets/covers/artworks/sunset-sea-thumb.jpg'), ink: 'dark' },
  { id: 'moon-lake', name: '달빛 호수', image: require('../../assets/covers/artworks/moon-lake.jpg'), thumb: require('../../assets/covers/artworks/moon-lake-thumb.jpg'), ink: 'light' },
  { id: 'autumn-field', name: '가을 들판', image: require('../../assets/covers/artworks/autumn-field.jpg'), thumb: require('../../assets/covers/artworks/autumn-field-thumb.jpg'), ink: 'dark' },
  { id: 'flower-garden', name: '꽃 정원', image: require('../../assets/covers/artworks/flower-garden.jpg'), thumb: require('../../assets/covers/artworks/flower-garden-thumb.jpg'), ink: 'dark' },
  { id: 'winter-forest', name: '겨울 숲', image: require('../../assets/covers/artworks/winter-forest.jpg'), thumb: require('../../assets/covers/artworks/winter-forest-thumb.jpg'), ink: 'dark' },
];

export function isCoverArtworkId(id: unknown): id is CoverArtworkId {
  return typeof id === 'string' && (COVER_ARTWORK_IDS as readonly string[]).includes(id);
}

export function coverArtwork(id: string | undefined): CoverArtwork | undefined {
  return isCoverArtworkId(id) ? COVER_ARTWORKS.find((a) => a.id === id) : undefined;
}

// 책에 입힐 정면 그림. edge는 책 색 그대로(그림을 골라도 사용자가 정한 책등·몸체 색을 덮어쓰지 않는다: binding-material bookTone)
export function artworkCover(id: string | undefined, spineColor: string): CoverArt | undefined {
  const a = coverArtwork(id);
  if (!a) return undefined;
  return { image: a.image, titleTop: ARTWORK_TITLE_TOP, ink: ARTWORK_INK[a.ink], edge: spineColor, artworkId: a.id, focusY: ARTWORK_FOCUS_Y };
}

// 면(w×h)을 채우는 그림 자리: 가로세로 비를 지키고(찌그러뜨리지 않는다) 남는 쪽을 자른다. 가로는 가운데, 세로는 위에서 focusY 몫
export function focusedRect(iw: number, ih: number, w: number, h: number, focusY: number) {
  const k = Math.max(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  return { x: (w - dw) / 2, y: (h - dh) * focusY, width: dw, height: dh };
}
