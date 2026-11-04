// 측정 번들 전용 실물 비교 책장: 실제 책(YES24 표지·제공 mm·책등 사진 비율)을 내 서재 책과 똑같은 모양으로 꽂는다(library toShelfBook과 같은 값).
// 메모리에만 쓰고 저장하지 않는다(placementStore.setDemo). 표지는 그릴 때 YES24에서 받으므로 인터넷이 필요하다. 앱 배포본의 예시 책장은 이것을 쓰지 않는다.
// real: 예시 책장과 같은 줄(표지 세 권 + 책등), real-front: 모든 책을 표지로 세운 책장, real-side: 돌려 세워 장정·옆모습이 보이는 책장. -before는 바꾸기 전 모습(비교 사진용).
// 책 색은 표지에서 책등과 맞닿는 띠가 거의 한 색이면 그 색, 아니면 가장 넓게 차지하는 색(rebinding edgeColorOf·dominantColorOf로 뽑아 둔 값).
import { frontExtent, wallLeanPose } from './front-pose';
import { frontDims, SHELF_DEPTH, WALL_GAP } from './geometry';
import { realDimensions } from './jacket-proportions';
import { emptyLibrary, type Edition, type Library, type ReadStatus, type Session } from './library';
import { SAMPLE_LAYOUT } from './onboarding-sample';
import { heightClassOf, thicknessClassOf } from './rebinding';
import type { Book, BookPlacement, ShelfLayout } from './types';

// id, 제목, 저자, 출판사, YES24 상품 번호, 폭·높이 mm, 쪽수, 책등 사진 폭/높이, 책 색
type Row = [string, string, string, string, number, number, number, number, number, string];
const ROWS: Row[] = [
  ['b01', '모순', '양귀자', '쓰다', 8759796, 128, 188, 308, 0.085, '#EDEBE5'],
  ['b02', '데미안', '헤르만 헤세', '민음사', 176787, 132, 225, 239, 0.0475, '#EDEDED'],
  ['b03', '어린 왕자', '생텍쥐페리', '열린책들', 22431294, 160, 220, 136, 0.07, '#EDEDED'],
  ['b04', '아몬드', '손원평', '다즐링', 119697570, 138, 214, 314, 0.07, '#E7C4C6'],
  ['b05', '여행의 이유', '김영하', '복복서가', 125905365, 128, 188, 260, 0.1, '#039066'],
  ['b17', '불편한 편의점', '김호연', '나무옆의자', 99308021, 135, 200, 268, 0.08, '#EDECEB'],
  ['b06', '흰', '한강', '문학동네', 143896198, 120, 188, 180, 0.1025, '#B0CFE5'],
  ['b07', '코스모스', '칼 세이건', '사이언스북스', 2312211, 153, 224, 719, 0.185, '#0A0A0A'],
  ['b08', '쇼코의 미소', '최은영', '문학동네', 29288225, 145, 210, 296, 0.0725, '#EDE3EB'],
  ['b09', '82년생 김지영', '조남주', '민음사', 32972572, 127, 188, 192, 0.07, '#CDCCD0'],
  ['b10', '채식주의자', '한강', '창비', 108422348, 128, 194, 276, 0.105, '#5276B3'],
  ['b18', '구의 증명', '최진영', '은행나무', 118578901, 128, 188, 192, 0.0625, '#91CEAF'],
  ['b11', '아무튼, 서재', '김윤관', '제철소', 51095578, 110, 178, 140, 0.0525, '#EDECE9'],
  ['b12', '사피엔스', '유발 하라리', '김영사', 23030284, 152, 215, 636, 0.1375, '#EDECE9'],
  ['b13', '달러구트 꿈 백화점', '이미예', '팩토리나인', 91065309, 134, 200, 300, 0.09, '#EDECE6'],
  ['b14', '소년이 온다', '한강', '창비', 13137546, 153, 224, 216, 0.09, '#4E4C33'],
  ['b15', '이처럼 사소한 것들', '클레어 키건', '다산책방', 123400303, 132, 192, 132, 0.075, '#EDEDEB'],
  ['b16', '우리가 빛의 속도로 갈 수 없다면', '김초엽', '허블', 74261416, 130, 198, 344, 0.12, '#EDE9E4'],
  ['b19', '작별하지 않는다', '한강', '문학동네', 103495056, 138, 201, 332, 0.085, '#708AB0'],
];

// 예시 책의 갈피(색, 장 수): 실제 서재처럼 몇 권에 갈피가 꽂혀 있다(2026-11-03 사용자 '실사 책 찍을 때도 갈피 넣어 줘'). 색은 예시 책장 갈피와 같은 범위
const MARKS: Record<string, [string, number]> = {
  b01: ['#98AC9E', 1], b02: ['#98AC9E', 2], b03: ['#E3A857', 1], b04: ['#D98A7C', 2], b05: ['#8EAAD0', 2], b06: ['#F3B497', 1],
  b07: ['#E3A857', 2], b10: ['#8EAAD0', 1], b13: ['#D98A7C', 1], b14: ['#98AC9E', 1], b16: ['#8EAAD0', 2], b19: ['#F3B497', 1],
};

function toBook([id, title, author, publisher, goods, widthMm, heightMm, pages, ratio, color]: Row): Book {
  const physical = { widthMm, heightMm, pages };
  return {
    id,
    title,
    author,
    publisher,
    coverArtUri: `https://image.yes24.com/goods/${goods}/L`,
    themeColor: color,
    heightClass: heightClassOf(heightMm),
    thicknessClass: thicknessClassOf(pages),
    coverAspectRatio: widthMm / heightMm,
    physical,
    dims: realDimensions(physical, ratio || undefined),
    art: { motif: 'none', vectorCover: true, ribbon: MARKS[id]?.[0], ribbonCount: MARKS[id]?.[1] },
    quotes: MARKS[id]?.[1] ?? 0,
  };
}

const ALL = ROWS.map(toBook);
const byId = (id: string) => ALL.find((b) => b.id === id)!;
// 표지 책의 자세: 벽에 기댄다(앱 기본 자세와 같다, front-pose wallLeanPose)
const leaning = (id: string, spin = 0): Pick<BookPlacement, 'depth' | 'pitch' | 'spin'> => wallLeanPose(frontDims(byId(id)), SHELF_DEPTH, spin);
// 크게 돌린 책(옆모습): 곧게 서서 벽 가까이. 책이 벽을 뚫지 않는 만큼만 앞으로
function turned(id: string, spin: number): Pick<BookPlacement, 'depth' | 'spin'> {
  return { depth: SHELF_DEPTH - frontExtent(frontDims(byId(id)), 0, spin).z1 - WALL_GAP, spin };
}
const front = (id: string, shelfId: string, order: number, more: Partial<BookPlacement> = {}): BookPlacement => ({ bookId: id, shelfId, order, pose: 'front', tilt: 0, ...more });
const shelvesOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `shelf-${i + 1}`, order: i }));

// 예시 책장과 같은 줄·순서(곧게 세운 표지 세 권): 바꾸기 전 모습
const STRAIGHT_LAYOUT: ShelfLayout = SAMPLE_LAYOUT;
// 같은 책장에서 표지 책만 벽에 기댄다. 둘째 줄은 책등 쪽, 셋째 줄은 책배 쪽으로 조금 돌린다
const FRONT_SPIN: Record<string, number> = { b04: 0, b07: 14, b16: -14 };
export const REAL_LAYOUT: ShelfLayout = {
  ...SAMPLE_LAYOUT,
  placements: SAMPLE_LAYOUT.placements.map((p) => (p.pose === 'front' ? { ...p, ...leaning(p.bookId, FRONT_SPIN[p.bookId]) } : p)),
};
export const REAL_BOOKS: Book[] = REAL_LAYOUT.placements.map((p) => byId(p.bookId));

// 모든 책을 표지로: 한 줄에 세 권씩(한 줄 폭 합이 선반 480mm 안). 벽에 기대고, 줄마다 책등·책배 쪽으로 조금씩 돌린다
const FRONT_ROWS = [['b04', 'b16', 'b05'], ['b07', 'b19', 'b10'], ['b03', 'b14', 'b08'], ['b17', 'b02', 'b18']];
const ROW_SPIN = [8, -8, 8, -8];
export const REAL_FRONT_BOOKS: Book[] = FRONT_ROWS.flat().map(byId);
export const REAL_FRONT_LAYOUT: ShelfLayout = {
  version: 2,
  drawer: [],
  shelves: shelvesOf(FRONT_ROWS.length),
  placements: FRONT_ROWS.flatMap((row, i) => row.map((id, order) => front(id, `shelf-${i + 1}`, order, leaning(id, ROW_SPIN[i])))),
};
const FRONT_STRAIGHT_LAYOUT: ShelfLayout = { ...REAL_FRONT_LAYOUT, placements: REAL_FRONT_LAYOUT.placements.map(({ bookId, shelfId, order }) => front(bookId, shelfId, order)) };

// 장정·옆모습: 첫 줄은 크게 돌려 책등과 표지를, 둘째 줄은 책배 속지와 표지를, 셋째 줄은 책등으로 꽂은 책과 눕힌 더미 + 돌린 표지
const SIDE_SPIN = 32;
// 돌린 책끼리 표지가 가리지 않는 자리(자리 값이 없으면 나란한 상자끼리 비늘처럼 겹쳐 놓인다)
const SIDE_POS = [4, 126, 248];
const SIDE_ROWS: [string[], string[], string[]] = [['b07', 'b04', 'b05'], ['b16', 'b19', 'b10'], ['b02', 'b14', 'b03']];
export const REAL_SIDE_BOOKS: Book[] = [...SIDE_ROWS.flat(), 'b12', 'b13'].map(byId);
export const REAL_SIDE_LAYOUT: ShelfLayout = {
  version: 2,
  drawer: [],
  shelves: shelvesOf(3),
  placements: [
    ...SIDE_ROWS[0].map((id, order) => front(id, 'shelf-1', order, { ...turned(id, SIDE_SPIN), pos: SIDE_POS[order] })),
    ...SIDE_ROWS[1].map((id, order) => front(id, 'shelf-2', order, { ...turned(id, -SIDE_SPIN), pos: SIDE_POS[order] })),
    { bookId: 'b12', shelfId: 'shelf-3', order: 0, pose: 'horizontal', tilt: 0, stackId: 'stack:b12', stackOrder: 0 },
    { bookId: 'b13', shelfId: 'shelf-3', order: 0, pose: 'horizontal', tilt: 0, stackId: 'stack:b12', stackOrder: 1 },
    ...['b02', 'b14'].map((id, i) => ({ bookId: id, shelfId: 'shelf-3', order: i + 1, pose: 'spine' as const, tilt: 0 as const })),
    front('b03', 'shelf-3', 3, turned('b03', SIDE_SPIN)),
  ],
};

// 바꾸기 전 모습(비교 사진용): 곧게 세워 기본 깊이에 두고, 재질을 코팅 없는 무광 종이로 고르고, 주소 끝에 ?를 붙여 큰 표지로 바뀌지 않게 한다(같은 그림 L)
const before = (b: Book): Book => ({ ...b, coverArtUri: `${b.coverArtUri}?`, art: { ...b.art, material: 'fine' } });
export const REAL_BEFORE: [Book[], ShelfLayout] = [REAL_BOOKS.map(before), STRAIGHT_LAYOUT];
export const REAL_FRONT_BEFORE: [Book[], ShelfLayout] = [REAL_FRONT_BOOKS.map(before), FRONT_STRAIGHT_LAYOUT];

// 달력 사진용 서재: 비교 책장의 실제 책을 차례로 읽은 한 달 기록(같은 입력이면 같은 기록, 저장하지 않는다). 한 권을 며칠씩 읽다 다음 책으로 넘어가고, 며칠은 쉬거나 두세 권을 함께 읽는다
export function realReadingLibrary(y: number, m: number): Library {
  const lib = emptyLibrary();
  const stamp = new Date(y, m - 1, 1).toISOString();
  for (const b of ALL) {
    const editionId = `e-${b.id}`;
    lib.editions[editionId] = { id: editionId, title: b.title, authors: b.author ? [b.author] : [], coverUri: b.coverArtUri, coverSource: 'api', source: 'search', createdAt: stamp, updatedAt: stamp };
    lib.books[b.id] = { id: b.id, editionId, status: 'reading', createdAt: stamp, updatedAt: stamp };
  }
  const days = new Date(y, m, 0).getDate();
  let seed = y * 100 + m;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let at = 0;
  for (let d = 1; d <= days; d++) {
    if (rand() < 0.14) continue; // 쉬는 날
    if (rand() < 0.3) at = (at + 1) % ALL.length; // 다음 책으로
    const count = rand() < 0.3 ? 3 : rand() < 0.45 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const start = new Date(y, m - 1, d, 8 + k * 5, Math.floor(rand() * 50));
      const durationMs = (12 + Math.floor(rand() * 60)) * 60000;
      const id = `s-${d}-${k}`;
      lib.sessions[id] = { id, myBookId: ALL[(at + k) % ALL.length].id, startedAt: start.toISOString(), endedAt: new Date(start.getTime() + durationMs).toISOString(), durationMs, createdAt: stamp, updatedAt: stamp };
    }
  }
  return lib;
}

// 화면 사진용(측정 번들 ?seedlib=1): 실제 저장 경로로 비교 책장의 책과 지난달·이번 달 기록, 갈피를 넣는다(이미 책이 있으면 건너뛴다)
type SeedStore = BoardStore & { addSession(input: Pick<Session, 'myBookId' | 'startedAt' | 'endedAt' | 'durationMs'>): string };
export function realLibrarySeed(store: SeedStore, now: Date) {
  if (Object.keys(store.get().lib.books).length) return;
  const ids = new Map<string, string>();
  for (const b of ALL) ids.set(b.id, store.addBook({ edition: { title: b.title, authors: b.author ? [b.author] : [], coverUri: b.coverArtUri, coverSource: 'api', source: 'search' }, status: 'reading', binding: { spineColor: b.themeColor, motif: 'none', source: 'default', seed: 1 } }));
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  for (const [y, m] of [[prev.getFullYear(), prev.getMonth() + 1], [now.getFullYear(), now.getMonth() + 1]]) {
    for (const s of Object.values(realReadingLibrary(y, m).sessions)) {
      if (new Date(s.startedAt).getTime() > now.getTime()) continue;
      store.addSession({ myBookId: s.myBookId ? ids.get(s.myBookId) : undefined, startedAt: s.startedAt, endedAt: s.endedAt, durationMs: s.durationMs });
    }
  }
  const first = ids.get(ALL[0].id)!;
  BOARD_QUOTES.slice(0, 3).forEach(([text, page]) => store.addBookmark({ myBookId: first, text, page }));
  store.addBookmark({ myBookId: ids.get(ALL[1].id)!, text: BOARD_QUOTES[3][0], page: BOARD_QUOTES[3][1] });
}

// 갈피 보드 사진·옮기기 확인용: 측정 앱의 시험 서재에 실제 책 한 권과 갈피를 넣는다(실제 저장 경로로, 한 번만). 표지 그림을 사진 갈피로 쓴다
const BOARD_QUOTES: [string, number][] = [['새는 알에서 나오려고 투쟁한다. 알은 세계이다.', 123], ['내 안에서 솟아 나오려는 것, 바로 그것을 나는 살아 보려 했다.', 9], ['천천히 읽어야 보이는 문장이 있다.', 40], ['누구에게나 자기 자신에게로 가는 길이 있다.', 62], ['우리는 서로를 이해할 수 있다. 그러나 해석할 수 있는 것은 자기 자신뿐이다.', 8], ['운명은 다른 곳에서 오지 않는다.', 201]];
type BoardStore = { get(): { lib: Library }; addBook(input: NewBookInput): string; addBookmark(input: { myBookId: string; text: string; page?: number; photoUri?: string; photoRatio?: number }): string };
type NewBookInput = { edition: Omit<Edition, 'id' | 'createdAt' | 'updatedAt'>; status: ReadStatus; binding: { spineColor: string; motif: 'none'; source: 'default'; seed: number } };
export function realBoardSeed(store: BoardStore, bookId: string) {
  const { lib } = store.get();
  const known = lib.books[bookId] ? bookId : Object.keys(lib.books)[0];
  const demian = byId('b02');
  const target = known ?? store.addBook({ edition: { title: demian.title, authors: [demian.author!], coverUri: demian.coverArtUri, coverSource: 'api', source: 'search', size: { widthMm: 132, heightMm: 225 }, pageCount: 239 }, status: 'reading', binding: { spineColor: demian.themeColor, motif: 'none', source: 'default', seed: 1 } });
  if (Object.values(store.get().lib.bookmarks).some((m) => m.myBookId === target)) return target;
  BOARD_QUOTES.forEach(([text, page]) => store.addBookmark({ myBookId: target, text, page }));
  store.addBookmark({ myBookId: target, text: '', page: 62, photoUri: 'https://image.yes24.com/goods/176787/XL', photoRatio: 1.25 });
  return target;
}
