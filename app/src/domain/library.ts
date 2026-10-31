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

// 책별 묶음 색인: 표(lib.rounds·lib.bookmarks 객체)마다 한 번만 만든다. 서재 저장소는 바뀐 표만 새 객체로 바꾸므로
// 그 표가 그대로면 색인도 그대로 쓴다(책마다 전체를 훑고 정렬하던 것을 한 번으로). 돌려줄 때는 복사본(부르는 쪽이 고쳐도 색인은 안전).
function groupBy<T extends { myBookId?: string }>(cache: WeakMap<object, Map<string, T[]>>, table: Record<string, T>, order: (a: T, b: T) => number) {
  let m = cache.get(table);
  if (!m) {
    m = new Map();
    for (const x of Object.values(table)) {
      if (!x.myBookId) continue;
      const list = m.get(x.myBookId);
      if (list) list.push(x);
      else m.set(x.myBookId, [x]);
    }
    for (const list of m.values()) list.sort(order);
    cache.set(table, m);
  }
  return m;
}
const roundIndex = new WeakMap<object, Map<string, Round[]>>();
const bookmarkIndex = new WeakMap<object, Map<string, Bookmark[]>>();

export function roundsOf(lib: Library, myBookId: string) {
  return (groupBy(roundIndex, lib.rounds, (a, b) => a.index - b.index).get(myBookId) ?? []).slice();
}

export const currentRound = (lib: Library, myBookId: string) => roundsOf(lib, myBookId).at(-1);

// 상태 변경 규칙(사용자가 정한다. 타이머 시간으로 자동 완독 판정하지 않는다). day는 기기 현지 날짜(YYYY-MM-DD).
// - 같은 상태를 다시 고르면 아무것도 바꾸지 않는다(완독을 다시 눌러도 회차가 늘지 않는다).
// - 읽는 중으로: 열린 회차(완독일 없음)가 있으면 이어 간다(보류였으면 보류 해제). 회차가 없으면 1회차.
//   마지막 회차가 완독이면 새 회차 = 다시 읽기(화면은 확인을 받은 뒤에만 이 길로 보낸다, rereadRound와 같은 결과).
// - 완독으로: 열린 회차를 닫는다(완독일 오늘). 회차가 없으면 만들고 바로 닫는다. 이미 완독한 회차만 있으면 상태만 바꾼다.
// - 보류로: 열린 회차를 보류로. 회차가 없으면 보류 상태로 연다. 마지막이 완독이면 다시 읽기 회차를 보류로 연다.
// - 읽기 전으로: 시작일·완독일 없는 빈 열린 회차만 지운다(완독 기록은 그대로).
export function applyStatus(lib: Library, myBookId: string, status: ReadStatus, now: string, day = today(new Date(now))): Library {
  const book = lib.books[myBookId];
  if (!book) return lib;
  if (book.status === status) return lib;
  const rounds = { ...lib.rounds };
  const last = currentRound(lib, myBookId);
  const open = last && !last.finishedAt ? last : undefined;
  const make = (): Round => ({ id: newId('rd'), myBookId, index: (last?.index ?? 0) + 1, startedAt: day, createdAt: now, updatedAt: now });
  let page = book.currentPage;
  if (status === 'reading' || status === 'paused') {
    const paused = status === 'paused';
    if (open) rounds[open.id] = { ...open, paused, startedAt: open.startedAt ?? day, updatedAt: now };
    else {
      const r = make();
      rounds[r.id] = paused ? { ...r, paused: true } : r;
      // 다시 읽기(완독한 회차 다음 회차): 진도는 0쪽부터. 지난 회차의 기록·갈피·완독일은 그대로
      if (last) page = undefined;
    }
  } else if (status === 'read') {
    if (open) rounds[open.id] = { ...open, paused: false, finishedAt: day, updatedAt: now };
    else if (!last) {
      const r = make();
      rounds[r.id] = { ...r, finishedAt: day };
    }
  } else if (open && !open.startedAt && !open.finishedAt) {
    delete rounds[open.id];
  }
  return { ...lib, rounds, books: { ...lib.books, [myBookId]: { ...book, status, currentPage: page, updatedAt: now } } };
}

// 다시 읽기(명시적): 지난 회차는 그대로 두고 새 회차를 연다. 새 회차 진도는 0쪽부터(현재 쪽수를 비운다).
// 열린 회차가 있으면(아직 완독 전) 새 회차를 만들지 않는다.
export function rereadRound(lib: Library, myBookId: string, now: string, day = today(new Date(now))): Library {
  const book = lib.books[myBookId];
  if (!book) return lib;
  const last = currentRound(lib, myBookId);
  if (last && !last.finishedAt) return lib;
  const r: Round = { id: newId('rd'), myBookId, index: (last?.index ?? 0) + 1, startedAt: day, createdAt: now, updatedAt: now };
  return { ...lib, rounds: { ...lib.rounds, [r.id]: r }, books: { ...lib.books, [myBookId]: { ...book, status: 'reading', currentPage: undefined, updatedAt: now } } };
}

// 세션이 들어갈 회차: 열린 회차, 없으면(처음 읽음) 1회차를 열고 '읽기 전'이면 '읽는 중'으로, 마지막이 완독이면 그 회차(완독 뒤 다시 펼쳐 본 기록).
// 새 회차(다시 읽기)는 사용자가 정할 때만 만든다
export function sessionRound(lib: Library, myBookId: string, day: string, now: string): { lib: Library; roundId?: string } {
  const book = lib.books[myBookId];
  if (!book) return { lib };
  const last = currentRound(lib, myBookId);
  if (last) return { lib, roundId: last.id };
  const r: Round = { id: newId('rd'), myBookId, index: 1, startedAt: day, createdAt: now, updatedAt: now };
  const status: ReadStatus = book.status === 'want' ? 'reading' : book.status;
  return { lib: { ...lib, rounds: { ...lib.rounds, [r.id]: book.status === 'paused' ? { ...r, paused: true } : r }, books: { ...lib.books, [myBookId]: { ...book, status, updatedAt: now } } }, roundId: r.id };
}

export type SessionInput = Pick<Session, 'myBookId' | 'startedAt' | 'endedAt' | 'durationMs' | 'pagesRead' | 'memo'> & { id?: string };
// 독서 기록 저장: 같은 id(타이머 id)로 다시 저장해도 하나로 남는다. 책이 있으면 회차를 먼저 확보해 연결하고,
// 적은 쪽수는 현재 쪽수를 앞으로만 옮긴다(선택 입력). 책 없이 시간만도 저장한다
export function addSessionTo(lib: Library, input: SessionInput, now: string, newIdFn = () => newId('ss')): { lib: Library; id: string } {
  const prev = input.id ? lib.sessions[input.id] : undefined;
  let next = lib;
  let roundId: string | undefined;
  if (input.myBookId && lib.books[input.myBookId]) {
    const r = sessionRound(lib, input.myBookId, today(new Date(input.startedAt)), now);
    next = r.lib;
    roundId = r.roundId;
  }
  const id = input.id ?? newIdFn();
  const s: Session = { createdAt: prev?.createdAt ?? now, updatedAt: now, ...input, myBookId: input.myBookId && lib.books[input.myBookId] ? input.myBookId : undefined, roundId, id };
  next = { ...next, sessions: { ...next.sessions, [id]: s } };
  const b = s.myBookId ? next.books[s.myBookId] : undefined;
  if (b && input.pagesRead) next = { ...next, books: { ...next.books, [b.id]: { ...b, currentPage: Math.max(b.currentPage ?? 0, input.pagesRead), updatedAt: now } } };
  return { lib: next, id };
}

export type SessionPatch = Partial<Pick<Session, 'myBookId' | 'startedAt' | 'endedAt' | 'durationMs' | 'pagesRead' | 'memo'>>;
// 독서 기록 수정: 준 필드만 바꾼다. myBookId 키가 있으면 연결을 바꾸거나(값) 끊는다(undefined) — 키가 없으면 그대로.
// 연결이 바뀌면 회차도 새 책의 회차로(없으면 비움, 지난 기록 수정으로 회차를 새로 만들지 않는다). 다른 책의 회차는 남기지 않는다
export function updateSessionIn(lib: Library, id: string, patch: SessionPatch, now: string): Library {
  const s = lib.sessions[id];
  if (!s) return lib;
  const keys = Object.keys(patch) as (keyof SessionPatch)[];
  const changed = keys.filter((k) => patch[k] !== s[k]);
  if (!changed.length) return lib;
  const next: Session = { ...s, updatedAt: now };
  for (const k of changed) (next as Record<string, unknown>)[k] = patch[k];
  if (changed.includes('myBookId')) {
    const b = next.myBookId && lib.books[next.myBookId] ? next.myBookId : undefined;
    next.myBookId = b;
    next.roundId = b ? currentRound(lib, b)?.id : undefined;
  } else if (next.roundId && lib.rounds[next.roundId]?.myBookId !== next.myBookId) next.roundId = undefined;
  return { ...lib, sessions: { ...lib.sessions, [id]: next } };
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
// 세션 날짜(기기 시간대). 세션 객체는 바뀌면 새 객체가 되므로 객체마다 한 번만 계산한다(통계가 기간마다 모든 세션을 다시 훑는다)
const dayOf = new WeakMap<Session, string>();
export const sessionDay = (s: Session) => {
  let d = dayOf.get(s);
  if (d === undefined) dayOf.set(s, (d = today(new Date(s.startedAt))));
  return d;
};

// 갈피 날짜도 세션과 같은 기기 현지 날짜(만든 시각 기준). createdAt(ISO, UTC)의 앞 10자리를 쓰면 한국 시간 0~9시 갈피가 전날로 셌다
const markDayOf = new WeakMap<Bookmark, string>();
export const bookmarkDay = (m: Bookmark) => {
  let d = markDayOf.get(m);
  if (d === undefined) markDayOf.set(m, (d = today(new Date(m.createdAt))));
  return d;
};

// bookId를 주면 그 책만(요약·세션·갈피·완독 모두 같은 거름). 책 없는 독서 시간은 전체 통계에만 들어간다.
// 완독 권수(같은 책 여러 번 완독도 1권) · 완독 회차 수 · 재독(2회차 이상 완독) 횟수를 따로 센다
export function periodStats(lib: Library, p: Period, bookId?: string) {
  const mine = (id: string | undefined) => !!id && !!lib.books[id] && (!bookId || id === bookId);
  const finished = Object.values(lib.rounds).filter((r) => inPeriod(r.finishedAt, p) && mine(r.myBookId));
  const completedBooks = [...new Set(finished.map((r) => r.myBookId))];
  const rereads = finished.filter((r) => r.index > 1).length;
  const sessions = Object.values(lib.sessions)
    .filter((s) => inPeriod(sessionDay(s), p) && (!bookId || s.myBookId === bookId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const readMs = sessions.reduce((a, s) => a + s.durationMs, 0);
  const bookmarks = Object.values(lib.bookmarks).filter((b) => inPeriod(bookmarkDay(b), p) && mine(b.myBookId));
  // 기간에 읽은 책: 완독했거나, 세션이 있거나, 회차가 기간에 걸친 책
  const touched = new Set<string>(completedBooks);
  for (const s of sessions) if (mine(s.myBookId)) touched.add(s.myBookId!);
  for (const r of Object.values(lib.rounds)) {
    if (!mine(r.myBookId) || !r.startedAt) continue;
    const end = r.finishedAt ?? '9999-12-31';
    if (r.startedAt <= p.to && end >= p.from) touched.add(r.myBookId);
  }
  return { completedBooks, completedCount: completedBooks.length, completedRounds: finished.length, rereads, readMs, sessions, bookmarkCount: bookmarks.length, booksRead: [...touched] };
}

export const bookReadMs = (lib: Library, myBookId: string) => Object.values(lib.sessions).reduce((a, s) => a + (s.myBookId === myBookId ? s.durationMs : 0), 0);
export const bookmarksOf = (lib: Library, myBookId: string) =>
  (groupBy(bookmarkIndex, lib.bookmarks, (a, b) => b.createdAt.localeCompare(a.createdAt)).get(myBookId) ?? []).slice();
export const completions = (lib: Library, myBookId: string) => roundsOf(lib, myBookId).filter((r) => r.finishedAt).length;

// 완독 연도(책장 연도 표기): 완독한 책에만. 가장 최근 완독 회차의 연도
export function finishedYear(lib: Library, myBookId: string): number | null {
  const f = roundsOf(lib, myBookId).filter((r) => r.finishedAt);
  return f.length ? Number(f[f.length - 1].finishedAt!.slice(0, 4)) : null;
}

// 초까지(기록 수정·짧은 기록): 20초, 1분 20초, 1시간 2분 3초
export function formatDurationPrecise(ms: number) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return [h ? `${h}시간` : '', m ? `${m}분` : '', sec || (!h && !m) ? `${sec}초` : ''].filter(Boolean).join(' ');
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

// 화면 목록용: 그 책의 입력(내 책·판본·장정·현재 회차·갈피 수)이 그대로면 지난번 Book 객체를 그대로 돌려준다
// (책 그림 캔버스가 객체가 같으면 다시 기록하지 않으므로, 검색어 입력·표시 바꾸기마다 표지를 다시 그리지 않게)
const shelfBookMemo = new Map<string, { deps: unknown[]; book: Book | null }>();
export function memoShelfBook(lib: Library, myBookId: string): Book | null {
  const b = lib.books[myBookId];
  const deps = [b, b && lib.editions[b.editionId], b?.bindingId ? lib.bindings[b.bindingId] : undefined, currentRound(lib, myBookId), bookmarksOf(lib, myBookId).length];
  const hit = shelfBookMemo.get(myBookId);
  if (hit && hit.deps.every((d, i) => d === deps[i])) return hit.book;
  const book = toShelfBook(lib, myBookId);
  shelfBookMemo.set(myBookId, { deps, book });
  return book;
}

export { formatMm };
