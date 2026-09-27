// 온보딩 예시 18권(첫 실행 때 보여주는 책장). 실제 책이며 크기는 판형·쪽수로 계산한다.
// 판형·쪽수는 공개 서지 정보 기준 대략값이다. 국립중앙도서관 서지 API가 연결되면 그 값으로 바뀐다.
// 몸체 색·모티프·표지 그림은 시안에서 뽑은 임시 재료(body-art.generated.ts)이며, 책 자체가 아니라 앱의 재장정이다.
import { BODY_ART, COVER_ART } from './body-art.generated';
import type { Book, BookPlacement, HeightClass, Physical, ShelfLayout, ThicknessClass } from './types';

type Meta = {
  id: string; // 배치 자리(시안의 자리). 재료도 이 자리의 것을 쓴다.
  title: string;
  author: string;
  publisher: string;
  physical: Physical;
  motif: string; // 재료가 없을 때 쓸 모티프 슬롯
  finishedAt: string;
  quotes?: number;
  ribbon?: string;
  coverInk?: string; // 표지 전시 책의 제목 색
};

const p = (widthMm: number, heightMm: number, pages: number): Physical => ({ widthMm, heightMm, pages });

const META: Meta[] = [
  { id: 'b01', title: '모순', author: '양귀자', publisher: '쓰다', physical: p(128, 188, 304), motif: 'leaf', finishedAt: '2026-01-12' },
  { id: 'b02', title: '데미안', author: '헤르만 헤세', publisher: '민음사', physical: p(132, 225, 232), motif: 'leaf', finishedAt: '2026-01-28', quotes: 2, ribbon: '#98AC9E' },
  { id: 'b03', title: '어린 왕자', author: '앙투안 드 생텍쥐페리', publisher: '열린책들', physical: p(128, 188, 156), motif: 'star', finishedAt: '2026-02-09', quotes: 1, ribbon: '#E3AE6C' },
  { id: 'b04', title: '작별하지 않는다', author: '한강', publisher: '문학동네', physical: p(135, 200, 332), motif: 'moon', finishedAt: '2026-02-22', quotes: 2, ribbon: '#7D9CC4', coverInk: '#F3EEE3' },
  { id: 'b05', title: '소년이 온다', author: '한강', publisher: '창비', physical: p(128, 188, 216), motif: 'sprig', finishedAt: '2026-03-15', quotes: 2, ribbon: '#D98A7C' },
  { id: 'b17', title: '82년생 김지영', author: '조남주', publisher: '민음사', physical: p(128, 188, 192), motif: 'flower', finishedAt: '2026-03-22' },
  { id: 'b06', title: '흰', author: '한강', publisher: '문학동네', physical: p(125, 188, 196), motif: 'cotton', finishedAt: '2026-03-30' },
  { id: 'b07', title: '월든', author: '헨리 데이비드 소로', publisher: '은행나무', physical: p(152, 225, 512), motif: 'leaf', finishedAt: '2026-04-18', coverInk: '#2A2E38' },
  { id: 'b08', title: '여행의 이유', author: '김영하', publisher: '문학동네', physical: p(128, 188, 216), motif: 'wave', finishedAt: '2026-05-02', quotes: 2, ribbon: '#8EAAD0' },
  { id: 'b09', title: '채식주의자', author: '한강', publisher: '창비', physical: p(128, 188, 247), motif: 'bud', finishedAt: '2026-05-21' },
  { id: 'b10', title: '밝은 밤', author: '최은영', publisher: '문학동네', physical: p(140, 210, 344), motif: 'crescent', finishedAt: '2026-06-10' },
  { id: 'b18', title: '아몬드', author: '손원평', publisher: '창비', physical: p(140, 205, 264), motif: 'wildflower', finishedAt: '2026-06-18' },
  { id: 'b11', title: '달러구트 꿈 백화점', author: '이미예', publisher: '팩토리나인', physical: p(140, 210, 300), motif: 'wildflower', finishedAt: '2026-06-29', quotes: 1, ribbon: '#E7A77C' },
  { id: 'b12', title: '나미야 잡화점의 기적', author: '히가시노 게이고', publisher: '현대문학', physical: p(145, 210, 456), motif: 'crescent', finishedAt: '2026-07-11' },
  { id: 'b13', title: '불편한 편의점', author: '김호연', publisher: '나무옆의자', physical: p(140, 205, 268), motif: 'leaf', finishedAt: '2026-07-30' },
  { id: 'b14', title: '쇼코의 미소', author: '최은영', publisher: '문학동네', physical: p(128, 188, 312), motif: 'sprig', finishedAt: '2026-08-14' },
  { id: 'b15', title: '아무튼, 서재', author: '김윤관', publisher: '제철소', physical: p(110, 175, 144), motif: 'leaf', finishedAt: '2026-08-31' },
  { id: 'b16', title: '우리가 빛의 속도로 갈 수 없다면', author: '김초엽', publisher: '허블', physical: p(135, 200, 344), motif: 'sun', finishedAt: '2026-09-20', coverInk: '#3A3440' },
];

const heightClass = (hMm: number): HeightClass => (hMm < 180 ? 'short' : hMm < 215 ? 'medium' : 'tall');
const thicknessClass = (pages: number): ThicknessClass => (pages < 220 ? 'thin' : pages < 420 ? 'medium' : 'thick');

function toBook(m: Meta): Book {
  const body = BODY_ART[m.id];
  const cover = COVER_ART[m.id] && m.coverInk ? { ...COVER_ART[m.id], ink: m.coverInk } : COVER_ART[m.id];
  return {
    id: m.id,
    title: m.title,
    author: m.author,
    themeColor: body?.face ?? '#E9DCC8',
    heightClass: heightClass(m.physical.heightMm),
    thicknessClass: thicknessClass(m.physical.pages),
    coverAspectRatio: m.physical.widthMm / m.physical.heightMm,
    physical: m.physical,
    art: { motif: m.motif, ribbon: m.ribbon },
    finishedAt: m.finishedAt,
    quotes: m.quotes,
    body,
    cover,
  };
}

export const SAMPLE_BOOKS: Book[] = META.map(toBook);
export const SAMPLE_PUBLISHERS: Record<string, string> = Object.fromEntries(META.map((m) => [m.id, m.publisher]));

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
