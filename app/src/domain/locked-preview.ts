// 잠긴 선반 안에 보이는 책(2026-11-04 사용자 '안에 책이 있는 것처럼 입체감 있게'): 흐리게 그릴 예시 책 상자. 실제 표지는 쓰지 않고 색만 있는 책이다.
// 보통 줄과 같은 책 모양·같은 빛으로 그려 벽에 그림자가 진다(ShelfScene이 책만 흐리게 한다). 배치는 예시 책장의 두 줄을 그대로 쓴다.
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from './onboarding-sample';
import { computeShelf, type BookFrame } from './shelf-scene';
import type { Book } from './types';

const prefix = (rowIndex: number, id: string) => `locked${rowIndex}-${id}`;

export type LockedPreview = { frames: BookFrame[]; books: Record<string, Book> };

function previewOf(rowIndex: number): LockedPreview {
  const shelf = SAMPLE_LAYOUT.shelves[rowIndex % SAMPLE_LAYOUT.shelves.length].id;
  const placements = SAMPLE_LAYOUT.placements.filter((p) => p.shelfId === shelf).map((p) => ({ ...p, bookId: prefix(rowIndex, p.bookId) }));
  const books: Record<string, Book> = {};
  for (const b of SAMPLE_BOOKS) {
    const id = prefix(rowIndex, b.id);
    books[id] = { ...b, id, title: '', author: undefined, originalCoverUri: undefined, coverArtUri: undefined, spineArtUri: undefined, body: undefined, cover: undefined, quotes: 0 };
  }
  const layout = { ...SAMPLE_LAYOUT, shelves: [{ id: shelf, order: 0 }], placements, drawer: [] };
  return { frames: computeShelf(layout, books, shelf).frames, books };
}

const cache = new Map<number, LockedPreview>();
export function lockedPreview(rowIndex: number): LockedPreview {
  let p = cache.get(rowIndex);
  if (!p) cache.set(rowIndex, (p = previewOf(rowIndex)));
  return p;
}
