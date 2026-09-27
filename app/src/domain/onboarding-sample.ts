// 온보딩 예시 18권(첫 실행 때 보여주는 책장). 시안(docs/design/home-reference.png)과 같은 책·순서·배치.
// 기본 자세는 원본 시안의 개별 책 윤곽을 표시한다. 자세를 바꾸면 기존 샘플/모티프 렌더러를 쓴다.
import { FRONT_SIDE, TOP_FACE } from './geometry';
import { SAMPLE_ART } from './onboarding-sample.generated';
import { BODY_ART } from './body-art.generated';
import { REFERENCE_ART } from './reference-art';
import type { Book, BookPlacement, HeightClass, ShelfLayout, ThicknessClass } from './types';

type Meta = { id: string; title: string; author?: string; motif: string; finishedAt: string; quotes?: number; ribbon?: string };

const META: Meta[] = [
  { id: 'b01', title: '모순', author: '양귀자', motif: 'leaf', finishedAt: '2026-01-12' },
  { id: 'b02', quotes: 2, ribbon: '#98AC9E', title: '데미안', author: '헤르만 헤세', motif: 'leaf', finishedAt: '2026-01-28' },
  { id: 'b03', quotes: 1, ribbon: '#E3AE6C', title: '어린왕자', author: '생텍쥐페리', motif: 'star', finishedAt: '2026-02-09' },
  { id: 'b04', quotes: 2, ribbon: '#7D9CC4', title: '느린 계절', author: '한서윤', motif: 'moon', finishedAt: '2026-02-22' },
  { id: 'b05', quotes: 2, ribbon: '#D98A7C', title: '문장 수집', motif: 'sprig', finishedAt: '2026-03-15' },
  { id: 'b06', title: '흰', author: '한강', motif: 'cotton', finishedAt: '2026-03-30' },
  { id: 'b07', title: '여름의 숲', motif: 'leaf', finishedAt: '2026-04-18' },
  { id: 'b08', quotes: 2, ribbon: '#8EAAD0', title: '여행의 이유', author: '김영하', motif: 'wave', finishedAt: '2026-05-02' },
  { id: 'b09', title: '작은 것들의 깊이', motif: 'bud', finishedAt: '2026-05-21' },
  { id: 'b10', title: '사람의 마음이란', motif: 'crescent', finishedAt: '2026-06-10' },
  { id: 'b11', quotes: 1, ribbon: '#E7A77C', title: '너라는 계절', motif: 'wildflower', finishedAt: '2026-06-29' },
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
  const reference = REFERENCE_ART[m.id];
  const body = BODY_ART[m.id];
  const base = { id: m.id, title: m.title, author: m.author, themeColor: s.color, quotes: m.quotes, art: { motif: m.motif, ribbon: m.ribbon }, finishedAt: m.finishedAt, motifImage: s.motif, sample: s, reference };
  if (reference.pose === 'spine' && body) {
    // 코드 몸체로 옮긴 책: 잘라 붙인 윤곽은 쓰지 않고 크기만 가져온다
    return { ...base, reference: undefined, body, themeColor: body.face, heightClass: heightClass(reference.height), thicknessClass: thicknessClass(reference.width), coverAspectRatio: 0.7, dims: { height: reference.height, thickness: reference.width } };
  }
  if (reference.pose === 'spine') {
    return { ...base, heightClass: heightClass(reference.height), thicknessClass: thicknessClass(reference.width), coverAspectRatio: 0.7, dims: { height: reference.height, thickness: reference.width } };
  }
  if (reference.pose === 'front') {
    return { ...base, heightClass: heightClass(reference.height), thicknessClass: 'medium', coverAspectRatio: (reference.width - FRONT_SIDE) / reference.height, dims: { height: reference.height, coverWidth: reference.width - FRONT_SIDE, thickness: 36 } };
  }
  return { ...base, heightClass: heightClass(reference.width), thicknessClass: thicknessClass(reference.height - TOP_FACE), coverAspectRatio: 0.7, dims: { height: reference.width, thickness: reference.height - TOP_FACE } };
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
