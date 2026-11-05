// 잠긴 선반 안에 보이는 책(2026-11-04 사용자 '안에 책이 있는 것처럼 입체감 있게'): 흐리게 그릴 책 상자. 실제 표지는 쓰지 않고 색만 있는 책이다.
// 보통 줄과 같은 책 모양·같은 빛으로 그려 벽에 그림자가 진다(ShelfScene이 책만 흐리게 한다).
// 2026-11-05 사용자 '정면 장정이 별로': 정면 책을 두지 않고 책등·눕힌 책·기댄 책만 놓는다. 표지 그림이 없는 정면은 풍경 그림으로 대체돼(book-design jacketFor) 칸마다 같은 덩어리로 보였다.
import { SAMPLE_BOOKS } from './onboarding-sample';
import { computeShelf, type BookFrame } from './shelf-scene';
import type { Book, BookPlacement, ShelfLayout } from './types';

const prefix = (rowIndex: number, id: string) => `locked${rowIndex}-${id}`;

export type LockedPreview = { frames: BookFrame[]; books: Record<string, Book> };

// 크기를 빌려 올 예시 책과 책 색. 흐려도 벽과 갈리는 중간 톤 위주로, 흰 벽에 묻히는 옅은 크림은 칸마다 한두 권만 둔다
type Slot = { from: string; color: string; lean?: boolean };
type Row = { lying?: Slot[]; standing: Slot[] };
const SAND = '#D9C8B2';
const CREAM = '#EFE6D8';
const PINE = '#3D5F57';
const SAGE = '#7C8F7E';
const NAVY = '#3E5575';
const DUSTY = '#8FA8BF';
const BRICK = '#BE5D47';
const WINE = '#893E41';
const MUSTARD = '#D2A85A';
const PEACH = '#EDBE9C';
const ROWS: Row[] = [
  { standing: [{ from: 'b01', color: SAND }, { from: 'b02', color: PINE }, { from: 'b03', color: CREAM }, { from: 'b10', color: NAVY }, { from: 'b15', color: MUSTARD }, { from: 'b05', color: BRICK }, { from: 'b17', color: DUSTY }, { from: 'b14', color: SAGE }, { from: 'b06', color: SAND, lean: true }] },
  { lying: [{ from: 'b12', color: WINE }, { from: 'b13', color: SAND }], standing: [{ from: 'b08', color: DUSTY }, { from: 'b18', color: NAVY }, { from: 'b11', color: PEACH }, { from: 'b15', color: SAGE, lean: true }] },
  { standing: [{ from: 'b14', color: WINE }, { from: 'b05', color: PEACH }, { from: 'b08', color: SAGE }, { from: 'b01', color: CREAM }, { from: 'b18', color: NAVY }, { from: 'b03', color: MUSTARD }, { from: 'b02', color: DUSTY }, { from: 'b17', color: BRICK }, { from: 'b09', color: SAND, lean: true }] },
];

function previewOf(rowIndex: number): LockedPreview {
  const row = ROWS[rowIndex % ROWS.length];
  const shelfId = 'shelf-locked';
  const books: Record<string, Book> = {};
  const add = ({ from, color }: Slot) => {
    const sample = SAMPLE_BOOKS.find((b) => b.id === from)!;
    const id = prefix(rowIndex, from);
    books[id] = { ...sample, id, title: '', author: undefined, themeColor: color, originalCoverUri: undefined, coverArtUri: undefined, spineArtUri: undefined, body: undefined, cover: undefined, quotes: 0, art: { ...sample.art, ribbon: undefined, plainCover: true } };
    return id;
  };
  const lying = row.lying ?? [];
  const placements: BookPlacement[] = [
    ...lying.map((s, i): BookPlacement => ({ bookId: add(s), shelfId, order: 0, pose: 'horizontal', tilt: 0, stackId: 'stack', stackOrder: i })),
    ...row.standing.map((s, i): BookPlacement => ({ bookId: add(s), shelfId, order: i + (lying.length ? 1 : 0), pose: 'spine', tilt: s.lean ? -7 : 0 })),
  ];
  const layout: ShelfLayout = { version: 2, drawer: [], shelves: [{ id: shelfId, order: 0 }], placements };
  return { frames: computeShelf(layout, books, shelfId).frames, books };
}

const cache = new Map<number, LockedPreview>();
export function lockedPreview(rowIndex: number): LockedPreview {
  let p = cache.get(rowIndex);
  if (!p) cache.set(rowIndex, (p = previewOf(rowIndex)));
  return p;
}
