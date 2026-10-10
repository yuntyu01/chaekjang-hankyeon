// 내 서재 데이터 모델(화면과 무관). 저장은 store/library-store.ts, 여기는 타입과 순수 규칙만.
// 모든 연결은 안정적인 ID로 한다(제목으로 잇지 않는다). 책장 배치·장정 교체는 독서 기록을 바꾸지 않는다.
//
// 구분해 저장하는 것:
// - Edition(도서·판본): ISBN, 제목, 저자, 실제 표지, 쪽수·크기(확인된 값과 추정값을 구분)
// - MyBook(내 책): 판본 연결, 읽기 상태, 별점, 한 줄 감상, 현재 쪽수, 장정 연결
// - Round(독서 회차): 시작일·완독일. 다시 읽으면 새 회차(지난 회차는 그대로 남는다)
// - Session(독서 세션): 연결 책·회차, 시작·종료 시각, 실제 독서 시간(일시정지 제외)
// - Bookmark(갈피): 연결 책, 문장, 쪽수, 메모, 날짜
// - Binding(재장정 자산): 책등 색, 모티프, 그림 파일, 생성 상태(기본 장정 / AI)
import { artworkCover, type CoverArtworkId } from './cover-artworks';
import { formatMm } from './catalog';
import { illustratedDimensions } from './jacket-proportions';
import { buildBookArt, heightClassOf, layoutArt, thicknessClassOf, type BookArtParams, type LayoutVariant, type RebindInput } from './rebinding';
import type { BindingMaterial, Book } from './types';

export type ReadStatus = 'want' | 'reading' | 'read' | 'paused';
export const READ_STATUSES: ReadStatus[] = ['want', 'reading', 'read', 'paused'];

export type SizeMm = { widthMm: number; heightMm: number };

export type Edition = {
  id: string;
  isbn13?: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  pageCount?: number; // 확인된 쪽수(도서 정보·사용자 입력)만. 모르면 비움
  size?: SizeMm; // 확인된 판형만. 모르면 비움(화면은 기본 크기로 그리되 확인된 값처럼 표시하지 않는다)
  coverUri?: string; // 실제 표지: 도서 API 이미지 주소 또는 사용자 사진 파일
  coverSource?: 'api' | 'photo';
  category?: string; // KDC 번호나 분류 이름(재장정 모티프 선택용)
  seriesTitle?: string; // 같은 시리즈는 같은 색 계열로 묶는다
  art?: BookArtParams; // 재장정 계산값. ISBN당 한 번 계산해 저장한다(썸네일은 색 추출에만 쓰고 저장하지 않는다)
  source: 'manual' | 'search' | 'photo';
  sourceName?: string; // 예: 'Google Books'
  createdAt: string;
  updatedAt: string;
};

export type MyBook = {
  id: string;
  editionId: string;
  status: ReadStatus;
  rating?: number; // 1~5, 선택
  note?: string; // 한 줄 감상, 선택
  currentPage?: number; // 선택
  bindingId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Round = {
  id: string;
  myBookId: string;
  index: number; // 1부터. 2 이상이면 재독
  startedAt?: string; // YYYY-MM-DD, 선택
  finishedAt?: string; // YYYY-MM-DD. 있으면 이 회차는 완독
  paused?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  myBookId?: string; // 책 없이 읽은 시간도 저장할 수 있다
  roundId?: string;
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationMs: number; // 실제 독서 시간(일시정지 제외)
  pagesRead?: number;
  memo?: string;
  createdAt: string;
  updatedAt: string;
};

export type Bookmark = {
  id: string;
  myBookId: string;
  text: string;
  page?: number;
  memo?: string;
  photoUri?: string; // 사진 갈피: 페이지 사진(앱 보관 파일). 있으면 '사진 갈피'로 그린다
  photoRatio?: number; // 사진 가로/세로(카드에서 비율 유지)
  createdAt: string;
  updatedAt: string;
};

export type Binding = {
  id: string;
  myBookId: string;
  spineColor: string;
  motif: string; // 모티프 슬롯 id(motif-slots.ts) 또는 'none'
  inkColor?: string; // 글자색(바탕 위 대비 4.5:1)
  accentColor?: string; // 띠·모티프 색
  layout?: LayoutVariant; // 책등 조판 변형
  material?: BindingMaterial; // 장정 재질, 없으면 무광 종이
  coverArtUri?: string; // AI 표지 그림(평평한 그림, 제목 없음)
  coverArtId?: CoverArtworkId; // 기본 정면 장정 그림(cover-artworks). 있으면 AI 표지 그림보다 먼저 정면에 입힌다(그림은 지우지 않고 남겨 둔다)
  spineArtUri?: string; // AI 책등 그림
  source: 'default' | 'ai' | 'custom'; // custom = 사용자가 색·모티프·조판을 바꿈(추천 장정 대신 적용)
  status: 'ready' | 'generating' | 'failed';
  seed: number;
  createdAt: string;
  updatedAt: string;
};

export type Library = {
  editions: Record<string, Edition>;
  books: Record<string, MyBook>;
  rounds: Record<string, Round>;
  sessions: Record<string, Session>;
  bookmarks: Record<string, Bookmark>;
  bindings: Record<string, Binding>;
};

export const emptyLibrary = (): Library => ({ editions: {}, books: {}, rounds: {}, sessions: {}, bookmarks: {}, bindings: {} });

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const today = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ---------- 기본 장정(AI 연결 전에도 추가를 끝낼 수 있게) ----------

// 책장에 잘 어울리는 차분한 책등 색(시안 책들에서 고른 톤)
export const SPINE_PALETTE = ['#3D5F57', '#1D426B', '#BE5D47', '#893E41', '#B5C7D7', '#F8C69F', '#E39E8A', '#4E6B60', '#F7E8D5', '#FAEDDE', '#6B5B7A', '#C9A46A'];
export const PAPER_TAB = '#F1E7D4';

// 추천 장정(재장정): buildBookArt 결과를 Binding 값으로. 같은 입력이면 같은 장정(다시 열어도 바뀌지 않는다).
export function bindingFields(art: BookArtParams): Pick<Binding, 'spineColor' | 'motif' | 'inkColor' | 'accentColor' | 'layout'> {
  return { spineColor: art.baseColor, motif: art.motifId, inkColor: art.inkColor, accentColor: art.accentColor, layout: art.layoutVariant };
}

export function rebindInput(e: Pick<Edition, 'isbn13' | 'title' | 'authors' | 'publisher' | 'publishedAt' | 'pageCount' | 'size' | 'category' | 'seriesTitle'>, extra: Partial<RebindInput> = {}): RebindInput {
  const year = Number(e.publishedAt?.slice(0, 4));
  return { isbn: e.isbn13, title: e.title, authors: e.authors, publisher: e.publisher, publishedYear: year > 0 ? year : undefined, pageCount: e.pageCount, heightMm: e.size?.heightMm, widthMm: e.size?.widthMm, category: e.category, seriesTitle: e.seriesTitle, ...extra };
}

// seed는 '다른 조합' 용도로만 남겨 둔다(0이면 추천 그대로).
export function defaultBinding(myBookId: string, title: string, seed: number, now: string, input: Partial<RebindInput> = {}): Binding {
  const art = buildBookArt({ ...input, title: input.title ?? title }, now);
  return { id: newId('bd'), myBookId, ...bindingFields(art), source: 'default', status: 'ready', seed, createdAt: now, updatedAt: now };
}

// ---------- 읽기 상태와 회차 ----------

export function roundsOf(lib: Library, myBookId: string) {
  return Object.values(lib.rounds)
    .filter((r) => r.myBookId === myBookId)
    .sort((a, b) => a.index - b.index);
}

export const currentRound = (lib: Library, myBookId: string) => roundsOf(lib, myBookId).at(-1);

// 상태 변경 규칙(사용자가 정한다. 타이머 시간으로 자동 완독 판정하지 않는다):
// - 읽는 중으로: 열린 회차가 없거나 마지막 회차가 완독이면 새 회차(시작일 오늘). 보류였으면 그 회차를 이어 간다.
// - 완독으로: 열린 회차를 닫는다(완독일 오늘). 회차가 없으면 새로 만들고 바로 닫는다.
// - 보류로: 열린 회차를 보류 표시(없으면 새 회차).
// - 읽기 전으로: 기록은 지우지 않는다(열린 회차에 시작일이 없고 완독도 아니면 그 빈 회차만 치운다).
export function applyStatus(lib: Library, myBookId: string, status: ReadStatus, now: string, day = now.slice(0, 10)): Library {
  const book = lib.books[myBookId];
  if (!book) return lib;
  const rounds = { ...lib.rounds };
  const last = currentRound(lib, myBookId);
  const open = last && !last.finishedAt ? last : undefined;
  const make = (): Round => ({ id: newId('rd'), myBookId, index: (last?.index ?? 0) + 1, startedAt: day, createdAt: now, updatedAt: now });
  if (status === 'reading') {
    if (open) rounds[open.id] = { ...open, paused: false, startedAt: open.startedAt ?? day, updatedAt: now };
    else {
      const r = make();
      rounds[r.id] = r;
    }
  } else if (status === 'read') {
    const r = open ?? make();
    rounds[r.id] = { ...r, paused: false, finishedAt: day, updatedAt: now };
  } else if (status === 'paused') {
    const r = open ?? make();
    rounds[r.id] = { ...r, paused: true, updatedAt: now };
  } else if (open && !open.startedAt && !open.finishedAt) {
    delete rounds[open.id];
  }
  return { ...lib, rounds, books: { ...lib.books, [myBookId]: { ...book, status, updatedAt: now } } };
}

// ---------- 통계(실제 저장 데이터로만) ----------
// 완독 수 기준: 기간 안에 완독일이 있는 회차가 하나라도 있는 책을 1권으로 센다(같은 책을 기간 안에 두 번 완독해도 1권).
// 재독 기준: 회차 번호가 2 이상인 회차의 완독은 '재독'으로 따로 센다. 책 상세·통계 모두 이 기준을 쓴다.
export type Period = { from: string; to: string }; // YYYY-MM-DD, 양끝 포함

export const monthPeriod = (y: number, m: number): Period => {
  const last = new Date(y, m, 0).getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-${p(last)}` };
};
export const yearPeriod = (y: number): Period => ({ from: `${y}-01-01`, to: `${y}-12-31` });
const inPeriod = (day: string | undefined, p: Period) => !!day && day >= p.from && day <= p.to;
// 세션 날짜는 기기 현지 날짜로(시작 시각 기준)
export const sessionDay = (s: Session) => today(new Date(s.startedAt));

export function periodStats(lib: Library, p: Period) {
  const finished = Object.values(lib.rounds).filter((r) => inPeriod(r.finishedAt, p) && lib.books[r.myBookId]);
  const completedBooks = [...new Set(finished.map((r) => r.myBookId))];
  const rereads = finished.filter((r) => r.index > 1).length;
  const sessions = Object.values(lib.sessions)
    .filter((s) => inPeriod(sessionDay(s), p))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const readMs = sessions.reduce((a, s) => a + s.durationMs, 0);
  const bookmarks = Object.values(lib.bookmarks).filter((b) => inPeriod(b.createdAt.slice(0, 10), p) && lib.books[b.myBookId]);
  // 기간에 읽은 책: 완독했거나, 세션이 있거나, 회차가 기간에 걸친 책
  const touched = new Set<string>(completedBooks);
  for (const s of sessions) if (s.myBookId && lib.books[s.myBookId]) touched.add(s.myBookId);
  for (const r of Object.values(lib.rounds)) {
    if (!lib.books[r.myBookId] || !r.startedAt) continue;
    const end = r.finishedAt ?? '9999-12-31';
    if (r.startedAt <= p.to && end >= p.from) touched.add(r.myBookId);
  }
  return { completedBooks, completedCount: completedBooks.length, rereads, readMs, sessions, bookmarkCount: bookmarks.length, booksRead: [...touched] };
}

export const bookReadMs = (lib: Library, myBookId: string) => Object.values(lib.sessions).reduce((a, s) => a + (s.myBookId === myBookId ? s.durationMs : 0), 0);
export const bookmarksOf = (lib: Library, myBookId: string) =>
  Object.values(lib.bookmarks)
    .filter((b) => b.myBookId === myBookId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const completions = (lib: Library, myBookId: string) => roundsOf(lib, myBookId).filter((r) => r.finishedAt).length;

// 완독 연도(책장 연도 표기): 완독한 책에만. 가장 최근 완독 회차의 연도
export function finishedYear(lib: Library, myBookId: string): number | null {
  const f = roundsOf(lib, myBookId).filter((r) => r.finishedAt);
  return f.length ? Number(f[f.length - 1].finishedAt!.slice(0, 4)) : null;
}

export function formatDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h) return `${h}시간 ${m % 60}분`;
  if (m) return `${m}분`;
  return ms > 0 ? '1분 미만' : '0분';
}

// ---------- 책장에 그릴 Book으로 ----------
// 크기를 모르면 흔한 판형(128×188mm)·250쪽으로 그린다(화면용 추정값. 상세에서는 '확인 전'으로 표시).
export const ESTIMATED_SIZE: SizeMm = { widthMm: 128, heightMm: 188 };
export const ESTIMATED_PAGES = 250;


export function toShelfBook(lib: Library, myBookId: string): Book | null {
  const b = lib.books[myBookId];
  const e = b && lib.editions[b.editionId];
  if (!b || !e) return null;
  const bd = b.bindingId ? lib.bindings[b.bindingId] : undefined;
  const size = e.size ?? ESTIMATED_SIZE;
  const pages = e.pageCount ?? ESTIMATED_PAGES;
  const r = currentRound(lib, myBookId);
  const marks = bookmarksOf(lib, myBookId).length;
  const themeColor = bd?.spineColor ?? e.art?.baseColor ?? SPINE_PALETTE[0];
  // 고른 정면 그림(없으면 지금처럼 단색 정면). 책 색은 그대로 둔다
  const art = artworkCover(bd?.coverArtId, themeColor);
  return {
    id: b.id,
    title: e.title,
    author: e.authors.join(', ') || undefined,
    publisher: e.publisher,
    publishedAt: e.publishedAt,
    originalCoverUri: e.coverUri,
    coverArtUri: art ? undefined : bd?.coverArtUri,
    spineArtUri: bd?.spineArtUri,
    themeColor,
    heightClass: heightClassOf(size.heightMm),
    thicknessClass: thicknessClassOf(pages),
    coverAspectRatio: size.widthMm / size.heightMm,
    physical: { widthMm: size.widthMm, heightMm: size.heightMm, pages },
    dims: illustratedDimensions({ widthMm: size.widthMm, heightMm: size.heightMm, pages }),
    // 갈피가 있으면 책 위로 작은 종이 탭(최대 두 장, art.tsx Ribbons)
    art: { motif: bd?.motif ?? e.art?.motifId ?? 'none', inkColor: bd?.inkColor, accentColor: bd?.accentColor, material: bd?.material, vectorCover: !art, ...layoutArt(bd?.layout ?? e.art?.layoutVariant ?? 'spine_a'), ribbon: marks ? PAPER_TAB : undefined },
    cover: art,
    startedAt: r?.startedAt,
    finishedAt: b.status === 'read' ? r?.finishedAt : undefined,
    quotes: marks,
  };
}

export { formatMm };
