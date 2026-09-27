// 개발용 샘플 16권. 그림은 앱에 내장된 개발용 SVG 샘플(src/ui/art)이며 실제 자산 슬롯은 비어 있다.
import type { Book, BookPlacement, ShelfLayout } from './types';

const b = (book: Omit<Book, 'coverAspectRatio'> & { coverAspectRatio?: number }): Book => ({
  coverAspectRatio: 0.68,
  ...book,
});

export const SAMPLE_BOOKS: Book[] = [
  b({ id: 'b01', title: '모순', author: '양귀자', themeColor: '#EFE6D3', heightClass: 'medium', thicknessClass: 'medium', art: { motif: 'sprig', accentColor: '#5E7D4E' }, finishedAt: '2026-01-12' }),
  b({ id: 'b02', title: '데미안', author: '헤르만 헤세', themeColor: '#2F5A45', heightClass: 'tall', thicknessClass: 'thick', art: { motif: 'leaf', accentColor: '#D8B866' }, finishedAt: '2026-01-28' }),
  b({ id: 'b03', title: '어린 왕자', author: '생텍쥐페리', themeColor: '#F1E9DA', heightClass: 'medium', thicknessClass: 'medium', art: { motif: 'star', scene: 'meadow', spineCropX: 0.42, accentColor: '#D4A64A' }, finishedAt: '2026-02-09' }),
  b({ id: 'b04', title: '달과 나', themeColor: '#1F3557', heightClass: 'tall', thicknessClass: 'medium', coverAspectRatio: 0.7, art: { motif: 'moon', scene: 'moonlake', spineCropX: 0.7 }, finishedAt: '2026-02-22' }),
  b({ id: 'b05', title: '문장 수집', themeColor: '#B5503A', heightClass: 'tall', thicknessClass: 'thick', art: { motif: 'sprig', accentColor: '#F3E3CF' }, finishedAt: '2026-03-15' }),
  b({ id: 'b06', title: '흰', author: '한강', themeColor: '#F4EFE6', heightClass: 'medium', thicknessClass: 'thin', art: { motif: 'cotton', accentColor: '#8C7A5C' }, finishedAt: '2026-03-30' }),
  b({ id: 'b07', title: '여름의 숲', themeColor: '#557A4A', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.72, art: { motif: 'leaf', scene: 'forest', spineCropX: 0.2 }, finishedAt: '2026-04-18' }),
  b({ id: 'b08', title: '여행의 이유', author: '김영하', themeColor: '#A8C3DA', heightClass: 'tall', thicknessClass: 'medium', art: { motif: 'wave', scene: 'river', spineCropX: 0.35 }, finishedAt: '2026-05-02' }),
  b({ id: 'b09', title: '작은 것들의 깊이', themeColor: '#EFE4CF', heightClass: 'medium', thicknessClass: 'thin', art: { motif: 'bud', accentColor: '#7A8F5A' }, finishedAt: '2026-05-21' }),
  b({ id: 'b10', title: '사람의 마음이란', themeColor: '#223A63', heightClass: 'tall', thicknessClass: 'thick', art: { motif: 'moon', scene: 'nightpine', spineCropX: 0.55, accentColor: '#F1D58A' }, finishedAt: '2026-06-10' }),
  b({ id: 'b11', title: '너라는 계절', themeColor: '#F2C9A0', heightClass: 'medium', thicknessClass: 'thick', art: { motif: 'flower', accentColor: '#9B6B45' }, finishedAt: '2026-06-29' }),
  b({ id: 'b12', title: '찰나의 마음', themeColor: '#D98A7E', heightClass: 'medium', thicknessClass: 'thick', art: { motif: 'moon', accentColor: '#F6E7C8' }, finishedAt: '2026-07-11' }),
  b({ id: 'b13', title: '좋은 문장은 이렇게 온다', themeColor: '#F1E8D6', heightClass: 'short', thicknessClass: 'medium', art: { motif: 'leaf', accentColor: '#6E8A55' }, finishedAt: '2026-07-30' }),
  b({ id: 'b14', title: '고요한 우연', themeColor: '#7D2E35', heightClass: 'tall', thicknessClass: 'medium', art: { motif: 'sprig', accentColor: '#E3C27A' }, finishedAt: '2026-08-14' }),
  b({ id: 'b15', title: '아무튼, 독서', themeColor: '#F2EBDD', heightClass: 'medium', thicknessClass: 'thin', art: { motif: 'leaf', accentColor: '#6E8A55' }, finishedAt: '2026-08-31' }),
  b({ id: 'b16', title: '우리가 빛의 속도로 갈 수 없다면', author: '김초엽', themeColor: '#E9B8A6', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.72, art: { motif: 'wave', scene: 'sunset', spineCropX: 0.6 }, finishedAt: '2026-09-20' }),
];

const place = (
  bookId: string,
  shelfId: string,
  order: number,
  pose: BookPlacement['pose'] = 'spine',
  tilt: BookPlacement['tilt'] = 0,
  stack?: [string, number],
): BookPlacement => ({
  bookId,
  shelfId,
  order,
  pose,
  tilt,
  ...(stack ? { stackId: stack[0], stackOrder: stack[1] } : {}),
});

export const SAMPLE_LAYOUT: ShelfLayout = {
  version: 1,
  shelves: [
    { id: 'shelf-1', order: 0 },
    { id: 'shelf-2', order: 1 },
    { id: 'shelf-3', order: 2 },
  ],
  placements: [
    place('b01', 'shelf-1', 0),
    place('b02', 'shelf-1', 1),
    place('b03', 'shelf-1', 2),
    place('b04', 'shelf-1', 3, 'front'),
    place('b05', 'shelf-1', 4),
    place('b06', 'shelf-1', 5, 'spine', 7),
    place('b07', 'shelf-2', 0, 'front'),
    place('b08', 'shelf-2', 1, 'spine', -7),
    place('b09', 'shelf-2', 2),
    place('b10', 'shelf-2', 3),
    place('b11', 'shelf-2', 4, 'spine', 7),
    place('b12', 'shelf-3', 0, 'horizontal', 0, ['stack:b12', 0]),
    place('b13', 'shelf-3', 0, 'horizontal', 0, ['stack:b12', 1]),
    place('b14', 'shelf-3', 1),
    place('b15', 'shelf-3', 2),
    place('b16', 'shelf-3', 3, 'front'),
  ],
};
