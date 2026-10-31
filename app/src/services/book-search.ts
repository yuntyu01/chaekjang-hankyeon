// 도서 검색 연결부. 제공자를 갈아 끼울 수 있게 분리한다.
// 지금 연결: 우리 서버(EXPO_PUBLIC_API_URL이 있을 때. 서버에 YES24 키가 있으면 YES24) → 실패·결과 없음이면 Google Books → Open Library.
// - 우리 서버 /books/search: YES24 키는 서버에만 둔다(YES24 문서: 클라이언트 코드에 넣지 말 것). YES24는 쪽수·가로·세로(mm)까지 준다.
//   YES24 약관: 앱에 보일 때 출처(YES24)와 상품 페이지 링크(link)를 함께 보인다.
// - Google Books: 키가 없으면 여러 앱이 나눠 쓰는 공용 할당량을 쓴다(하루 한도가 차면 429 rateLimitExceeded).
//   EXPO_PUBLIC_GOOGLE_BOOKS_KEY가 있으면 그 키의 할당량을 쓴다.
// - Open Library: 검색 색인에는 판본별 쪽수가 없고(작품 단위 중앙값만), 판본 기록(/books/{id}.json)에 number_of_pages·
//   physical_dimensions가 있다. 목록에서 고르면 그 판본 기록을 읽어 확인된 값으로 채운다.
// 쪽수·판형은 판본 기록에 있을 때만 '확인된 정보'로 쓴다(없으면 비워 두고 추정값을 채워 넣지 않는다).
import type { SizeMm } from '@/domain/library';

export type BookCandidate = {
  key: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  isbn13?: string;
  pageCount?: number;
  size?: SizeMm;
  coverUrl?: string;
  category?: string; // 분류(Google Books categories). 재장정 모티프 선택에 쓴다
  sourceName: string;
  detailRef?: string; // 판본 상세를 읽을 주소(고른 뒤)
  link?: string; // 판매처 상품 페이지(YES24 약관: 출처와 함께 보인다)
};

export type SearchError = { ok: false; reason: 'network' | 'quota' | 'auth' | 'unknown'; message: string; diag: string };
export type SearchResult = { ok: true; items: BookCandidate[]; provider?: string; diag?: string } | SearchError;

const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_BOOKS_KEY;
const API = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

// 서버 검색 결과 한 권(server/internal/server/books.go searchItem)
export type ServerItem = { isbn13: string; title: string; authors?: string[]; publisher?: string; publishedAt?: string; thumbnailUrl?: string; pages?: number; widthMm?: number; heightMm?: number; link?: string; provider?: string };
const PROVIDER_NAME: Record<string, string> = { yes24: 'YES24', kakao: '카카오 책' };

export function fromServer(i: ServerItem): BookCandidate {
  return {
    key: `${i.provider ?? 'server'}:${i.isbn13}`,
    title: i.title || '(제목 없음)',
    authors: i.authors ?? [],
    publisher: i.publisher || undefined,
    publishedAt: i.publishedAt || undefined,
    isbn13: i.isbn13 || undefined,
    pageCount: i.pages && i.pages > 0 ? i.pages : undefined,
    size: i.widthMm && i.heightMm ? { widthMm: Math.min(i.widthMm, i.heightMm), heightMm: Math.max(i.widthMm, i.heightMm) } : undefined,
    coverUrl: i.thumbnailUrl?.replace(/^http:/, 'https:') || undefined,
    sourceName: PROVIDER_NAME[i.provider ?? ''] ?? '도서 정보',
    link: i.link || undefined,
  };
}

// 서버가 없거나(측정 번들) 개발용 가짜 목록이면 건너뛴다(가짜 책이 실제 검색 결과처럼 보이지 않게)
async function searchServer(query: string, signal?: AbortSignal): Promise<SearchResult | null> {
  if (!API) return null;
  try {
    const res = await fetch(`${API}/books/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) return { ok: false, reason: res.status === 429 ? 'quota' : 'unknown', message: `검색하지 못했어요(${res.status}).`, diag: `server ${res.status}` };
    const json = (await res.json()) as { items?: ServerItem[] };
    const items = (json.items ?? []).filter((i) => i.provider && i.provider !== 'mock').map(fromServer);
    return { ok: true, items, provider: items[0]?.sourceName ?? '서버' };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { ok: true, items: [] };
    return { ok: false, reason: 'network', message: '인터넷에 연결되지 않았어요. 직접 입력으로 추가할 수 있어요.', diag: `server network ${String((e as Error)?.message ?? e)}` };
  }
}

type GVolume = {
  id: string;
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    dimensions?: { height?: string; width?: string };
    categories?: string[];
  };
};

const cm = (v?: string) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) : undefined;
};

// "21 x 14 x 2 centimeters", "8.5 x 5.5 x 1 inches" → 가로·세로(mm)
export function parseDimensions(s?: string): SizeMm | undefined {
  if (!s) return undefined;
  const nums = s.match(/[\d.]+/g)?.map(Number).filter((n) => n > 0);
  if (!nums || nums.length < 2) return undefined;
  const k = /inch/i.test(s) ? 25.4 : /mm|millimet/i.test(s) ? 1 : 10;
  const [a, b] = nums.slice(0, 2).map((n) => Math.round(n * k));
  if (Math.max(a, b) < 80 || Math.max(a, b) > 450) return undefined; // 두께·잘못된 값 거르기
  return { widthMm: Math.min(a, b), heightMm: Math.max(a, b) };
}

function fromGoogle(v: GVolume): BookCandidate {
  const i = v.volumeInfo;
  const h = cm(i.dimensions?.height);
  const w = cm(i.dimensions?.width);
  const thumb = i.imageLinks?.thumbnail ?? i.imageLinks?.smallThumbnail;
  return {
    key: v.id,
    title: [i.title, i.subtitle].filter(Boolean).join(': ') || '(제목 없음)',
    authors: i.authors ?? [],
    publisher: i.publisher,
    publishedAt: i.publishedDate,
    isbn13: i.industryIdentifiers?.find((x) => x.type === 'ISBN_13')?.identifier,
    pageCount: i.pageCount && i.pageCount > 0 ? i.pageCount : undefined,
    size: h && w ? { widthMm: Math.min(w, h), heightMm: Math.max(w, h) } : undefined,
    coverUrl: thumb?.replace(/^http:/, 'https:').replace('&edge=curl', ''),
    category: i.categories?.join('>'),
    sourceName: 'Google Books',
    detailRef: `https://www.googleapis.com/books/v1/volumes/${v.id}${GOOGLE_KEY ? `?key=${GOOGLE_KEY}` : ''}`,
  };
}

async function googleError(res: Response): Promise<SearchError> {
  let reason = '';
  let msg = '';
  try {
    const j = (await res.json()) as { error?: { status?: string; message?: string; errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? '';
    msg = j.error?.message ?? '';
  } catch {
    // 본문이 JSON이 아님
  }
  const diag = `Google Books ${res.status} ${reason}${GOOGLE_KEY ? ' (앱 키 사용)' : ' (키 없음: 공용 할당량)'} ${msg.slice(0, 120)}`.trim();
  if (res.status === 429 || /rateLimit|quota/i.test(reason)) return { ok: false, reason: 'quota', message: '검색 사용량 한도가 찼어요. 다른 검색으로 찾아볼게요.', diag };
  if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, reason: 'auth', message: '검색 설정(키)에 문제가 있어요. 다른 검색으로 찾아볼게요.', diag };
  return { ok: false, reason: 'unknown', message: `검색하지 못했어요(${res.status}).`, diag };
}

async function searchGoogle(query: string, signal?: AbortSignal): Promise<SearchResult> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&printType=books${GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : ''}`, { signal });
    if (!res.ok) return googleError(res);
    const json = (await res.json()) as { items?: GVolume[] };
    return { ok: true, items: (json.items ?? []).map(fromGoogle), provider: 'Google Books' };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { ok: true, items: [] };
    return { ok: false, reason: 'network', message: '인터넷에 연결되지 않았어요. 직접 입력으로 추가할 수 있어요.', diag: `network ${String((e as Error)?.message ?? e)}` };
  }
}

type OLEdition = { key: string; title?: string; publisher?: string[]; publish_date?: string[]; isbn?: string[]; cover_i?: number };
type OLDoc = { key: string; title?: string; author_name?: string[]; editions?: { docs?: OLEdition[] } };

async function searchOpenLibrary(query: string, signal?: AbortSignal): Promise<SearchResult> {
  try {
    const fields = 'key,title,author_name,editions,editions.key,editions.title,editions.publisher,editions.publish_date,editions.isbn,editions.cover_i';
    const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=${fields}`, { signal });
    if (!res.ok) return { ok: false, reason: 'unknown', message: `검색하지 못했어요(${res.status}).`, diag: `Open Library ${res.status}` };
    const json = (await res.json()) as { docs?: OLDoc[] };
    return {
      ok: true,
      provider: 'Open Library',
      items: (json.docs ?? []).map((d) => {
        const ed = d.editions?.docs?.[0];
        return {
          key: `ol:${ed?.key ?? d.key}`,
          title: ed?.title ?? d.title ?? '(제목 없음)',
          authors: d.author_name ?? [],
          publisher: ed?.publisher?.[0],
          publishedAt: ed?.publish_date?.[0],
          isbn13: ed?.isbn?.find((x) => x.length === 13),
          coverUrl: ed?.cover_i ? `https://covers.openlibrary.org/b/id/${ed.cover_i}-M.jpg` : undefined,
          sourceName: 'Open Library',
          detailRef: ed?.key ? `https://openlibrary.org${ed.key}.json` : undefined,
        };
      }),
    };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { ok: true, items: [] };
    return { ok: false, reason: 'network', message: '인터넷에 연결되지 않았어요. 직접 입력으로 추가할 수 있어요.', diag: `network ${String((e as Error)?.message ?? e)}` };
  }
}

export async function searchBooks(query: string, signal?: AbortSignal): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { ok: true, items: [] };
  const sv = await searchServer(q, signal);
  if (sv?.ok && sv.items.length) return sv;
  if (sv && !sv.ok && sv.reason === 'network') return sv;
  const g = await searchGoogle(q, signal);
  if (g.ok && g.items.length) return g;
  if (!g.ok && g.reason === 'network') return g;
  const o = await searchOpenLibrary(q, signal);
  const diag = g.ok ? 'Google Books 결과 없음' : g.diag;
  if (o.ok) return { ...o, diag };
  return g.ok ? { ...g, diag } : g;
}

// 고른 판본의 상세(쪽수·판형·ISBN)를 읽어 채운다. 실패하면 목록 값 그대로.
export async function candidateDetails(c: BookCandidate): Promise<BookCandidate> {
  if (!c.detailRef) return c;
  try {
    const res = await fetch(c.detailRef);
    if (!res.ok) return c;
    const j = await res.json();
    if (c.sourceName === 'Open Library') {
      const e = j as { number_of_pages?: number; physical_dimensions?: string; isbn_13?: string[]; publishers?: string[]; publish_date?: string; covers?: number[] };
      return {
        ...c,
        pageCount: e.number_of_pages && e.number_of_pages > 0 ? e.number_of_pages : c.pageCount,
        size: parseDimensions(e.physical_dimensions) ?? c.size,
        isbn13: e.isbn_13?.[0] ?? c.isbn13,
        publisher: e.publishers?.[0] ?? c.publisher,
        publishedAt: e.publish_date ?? c.publishedAt,
        coverUrl: c.coverUrl ?? (e.covers?.[0] ? `https://covers.openlibrary.org/b/id/${e.covers[0]}-M.jpg` : undefined),
      };
    }
    const v = fromGoogle(j as GVolume);
    return { ...c, pageCount: v.pageCount ?? c.pageCount, size: v.size ?? c.size, isbn13: v.isbn13 ?? c.isbn13 };
  } catch {
    return c;
  }
}
