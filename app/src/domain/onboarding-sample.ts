// 온보딩 예시 18권(첫 실행 때 보여주는 책장). 시안(docs/design/home-reference.png)과 같은 책·순서·배치.
// 그림은 시안에서 뽑은 개발용 샘플 자산(onboarding-sample.generated.ts)이며, 실제 재장정 자산 슬롯은 비어 있다.
import { FRONT_SIDE } from './geometry';
import { SAMPLE_ART } from './onboarding-sample.generated';
import type { Book, BookPlacement, HeightClass, ShelfLayout, ThicknessClass } from './types';

type Meta = { id: string; title: string; author?: string; motif: string; finishedAt: string };

const META: Meta[] = [
  { id: 'b01', title: '모순', author: '양귀자', motif: 'leaf', finishedAt: '2026-01-12' },
  { id: 'b02', title: '데미안', author: '헤르만 헤세', motif: 'leaf', finishedAt: '2026-01-28' },
  { id: 'b03', title: '어린왕자', author: '생텍쥐페리', motif: 'star', finishedAt: '2026-02-09' },
  { id: 'b04', title: '달과 나', motif: 'moon', finishedAt: '2026-02-22' },
  { id: 'b05', title: '문장 수집', motif: 'sprig', finishedAt: '2026-03-15' },
  { id: 'b06', title: '흰', author: '한강', motif: 'cotton', finishedAt: '2026-03-30' },
  { id: 'b07', title: '여름의 숲', motif: 'leaf', finishedAt: '2026-04-18' },
  { id: 'b08', title: '여행의 이유', author: '김영하', motif: 'wave', finishedAt: '2026-05-02' },
  { id: 'b09', title: '작은 것들의 깊이', motif: 'bud', finishedAt: '2026-05-21' },
  { id: 'b10', title: '사람의 마음이란', motif: 'crescent', finishedAt: '2026-06-10' },
  { id: 'b11', title: '너라는 계절', motif: 'wildflower', finishedAt: '2026-06-29' },
  { id: 'b12', title: '찰나의 마음', motif: 'crescent', finishedAt: '2026-07-11' },
  { id: 'b13', title: '좋은 문장은 이렇게 온다', motif: 'leaf', finishedAt: '2026-07-30' },
  { id: 'b14', title: '고요한 우연', motif: 'sprig', finishedAt: '2026-08-14' },
  { id: 'b15', title: '아무튼, 독서', motif: 'leaf', finishedAt: '2026-08-31' },
  { id: 'b16', title: '우리가 빛의 속도로 갈 수 없다면', author: '김초엽', motif: 'sun', finishedAt: '2026-09-20' },
  { id: 'b17', title: '느린 하루', motif: 'flower', finishedAt: '2026-03-22' },
  { id: 'b18', title: '아주 보통의 하루', motif: 'wildflower', finishedAt: '2026-06-18' },
];

const heightClass = (h: number): HeightClass => (h < 140 ? 'short' : h < 165 ? 'medium' : 'tall');
const thicknessClass = (t: number): ThicknessClass => (t < 32 ? 'thin' : t < 40 ? 'medium' : 'thick');

function toBook(m: Meta): Book {
  const s = SAMPLE_ART[m.id];
  const base = { id: m.id, title: m.title, author: m.author, themeColor: s.color, art: { motif: m.motif }, finishedAt: m.finishedAt, motifImage: s.motif, sample: s };
  if (s.kind === 'spine') {
    return { ...base, heightClass: heightClass(s.h), thicknessClass: thicknessClass(s.w), coverAspectRatio: 0.7, dims: { height: s.h, thickness: s.w } };
  }
  if (s.kind === 'cover') {
    const coverWidth = s.w - FRONT_SIDE;
    return { ...base, heightClass: heightClass(s.h), thicknessClass: 'medium', coverAspectRatio: coverWidth / s.h, dims: { height: s.h, coverWidth, thickness: 36 } };
  }
  return { ...base, heightClass: heightClass(s.w), thicknessClass: thicknessClass(s.h), coverAspectRatio: 0.7, dims: { height: s.w, thickness: s.h } };
}

export const SAMPLE_BOOKS: Book[] = META.map(toBook);

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
  version: 2,
  drawer: [],
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
    place('b17', 'shelf-1', 5),
    place('b06', 'shelf-1', 6, 'spine', -7),
    place('b07', 'shelf-2', 0, 'front'),
    place('b08', 'shelf-2', 1),
    place('b09', 'shelf-2', 2),
    place('b10', 'shelf-2', 3),
    place('b18', 'shelf-2', 4),
    place('b11', 'shelf-2', 5, 'spine', -7),
    place('b12', 'shelf-3', 0, 'horizontal', 0, ['stack:b12', 0]),
    place('b13', 'shelf-3', 0, 'horizontal', 0, ['stack:b12', 1]),
    place('b14', 'shelf-3', 1),
    place('b15', 'shelf-3', 2),
    place('b16', 'shelf-3', 3, 'front'),
  ],
};
