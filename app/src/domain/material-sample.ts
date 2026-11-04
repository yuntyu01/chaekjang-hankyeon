// 측정 번들 전용 재질 비교 책장(2026-11-03 사용자 '측면이 애매, 다른 재질도 보여 줘'). 메모리에만 쓰고 저장하지 않는다(placementStore.setDemo).
// mat-side: 같은 색·같은 크기 책등에 재질만 다르게 세 줄(밝은 색, 중간 색, 어두운 색). 단색 면이라 결이 그대로 보인다.
// mat-real: 같은 실제 표지(어린 왕자)를 돌려 세워 표지와 측면을 같이 본다. 책등 글자가 재질 이름이다.
import { frontExtent } from './front-pose';
import { frontDims, SHELF_DEPTH, WALL_GAP } from './geometry';
import { realDimensions } from './jacket-proportions';
import { heightClassOf, thicknessClassOf } from './rebinding';
import type { BindingMaterial, Book, BookPlacement, ShelfLayout } from './types';

const physical = { widthMm: 128, heightMm: 188, pages: 300 };
const base = (id: string, title: string, themeColor: string, surface: BindingMaterial, ratio: number): Book => ({
  id,
  title,
  author: '',
  publisher: '',
  themeColor,
  heightClass: heightClassOf(physical.heightMm),
  thicknessClass: thicknessClassOf(physical.pages),
  coverAspectRatio: physical.widthMm / physical.heightMm,
  physical,
  dims: realDimensions(physical, ratio),
  art: { motif: 'none', vectorCover: true, material: surface },
});

const SIDE: [BindingMaterial, string][] = [['fine', '고운 종이'], ['linen', '린넨'], ['matte', '매끈 무광'], ['laid', '줄무늬 종이']];
const COLORS = ['#EDEBE5', '#7C8F78', '#3D5575'];
export const MAT_SIDE_BOOKS: Book[] = COLORS.flatMap((c, r) => SIDE.map(([m, label]) => base(`ms${r}-${m}`, label, c, m, 0.3)));
export const MAT_SIDE_LAYOUT: ShelfLayout = {
  version: 2,
  drawer: [],
  shelves: COLORS.map((_, i) => ({ id: `shelf-${i + 1}`, order: i })),
  placements: COLORS.flatMap((_, r) => SIDE.map(([m], order) => ({ bookId: `ms${r}-${m}`, shelfId: `shelf-${r + 1}`, order, pose: 'spine' as const, tilt: 0 as const }))),
};

// 어린 왕자(YES24 22431294): 흰 표지라 결이 잘 보인다
const REAL = SIDE;
const SPIN = 32;
const POS = [20, 190];
const realBook = (m: BindingMaterial, label: string): Book => ({
  ...base(`mr-${m}`, label, '#EDEDED', m, 0.07),
  coverArtUri: 'https://image.yes24.com/goods/22431294/L',
  physical: { widthMm: 160, heightMm: 220, pages: 136 },
  coverAspectRatio: 160 / 220,
  dims: realDimensions({ widthMm: 160, heightMm: 220, pages: 136 }, 0.07),
});
export const MAT_REAL_BOOKS: Book[] = REAL.map(([m, label]) => realBook(m, label));
const REAL_ROWS = [REAL.slice(0, 2), REAL.slice(2)];
export const MAT_REAL_LAYOUT: ShelfLayout = {
  version: 2,
  drawer: [],
  shelves: REAL_ROWS.map((_, i) => ({ id: `shelf-${i + 1}`, order: i })),
  placements: REAL_ROWS.flatMap((row, r) =>
    row.map(([m], order): BookPlacement => {
      const b = MAT_REAL_BOOKS.find((x) => x.id === `mr-${m}`)!;
      return { bookId: b.id, shelfId: `shelf-${r + 1}`, order, pose: 'front', tilt: 0, pos: POS[order], spin: SPIN, depth: SHELF_DEPTH - frontExtent(frontDims(b), 0, SPIN).z1 - WALL_GAP };
    }),
  ),
};
