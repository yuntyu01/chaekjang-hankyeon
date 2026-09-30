// 도서 검색 연결부. 제공자를 갈아 끼울 수 있게 분리한다.
// 지금 연결(키 없이): Google Books → 사용량 초과·결과 없음이면 Open Library. 국립중앙도서관·카카오 등은 키가 생기면 여기에 추가.
// 키 없는 Google Books는 여러 사용자가 한 할당량을 나눠 써서 하루 한도가 자주 찬다(429).
// 반환값 중 쪽수·판형은 '확인된 정보'로만 쓴다(없으면 비워 둔다. 추정값을 채워 넣지 않는다).
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
  sourceName: string;
};

export type SearchResult = { ok: true; items: BookCandidate[] } | { ok: false; reason: 'network' | 'quota' | 'unknown'; message: string };

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
  };
};

const cm = (v?: string) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) : undefined;
};

async function searchGoogle(query: string, signal?: AbortSignal): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { ok: true, items: [] };
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&printType=books`, { signal });
    if (res.status === 429 || res.status === 403) return { ok: false, reason: 'quota', message: '검색 사용량이 많아 잠시 뒤에 다시 시도해 주세요.' };
    if (!res.ok) return { ok: false, reason: 'unknown', message: `검색하지 못했어요(${res.status}).` };
    const json = (await res.json()) as { items?: GVolume[] };
    const items = (json.items ?? []).map((v): BookCandidate => {
      const i = v.volumeInfo;
      const isbn = i.industryIdentifiers?.find((x) => x.type === 'ISBN_13')?.identifier;
      const h = cm(i.dimensions?.height);
      const w = cm(i.dimensions?.width);
      const thumb = i.imageLinks?.thumbnail ?? i.imageLinks?.smallThumbnail;
      return {
        key: v.id,
        title: [i.title, i.subtitle].filter(Boolean).join(': ') || '(제목 없음)',
        authors: i.authors ?? [],
        publisher: i.publisher,
        publishedAt: i.publishedDate,
        isbn13: isbn,
        pageCount: i.pageCount && i.pageCount > 0 ? i.pageCount : undefined,
        size: h && w ? { widthMm: Math.min(w, h), heightMm: Math.max(w, h) } : undefined,
        coverUrl: thumb?.replace(/^http:/, 'https:').replace('&edge=curl', ''),
        sourceName: 'Google Books',
      };
    });
    return { ok: true, items };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { ok: true, items: [] };
    return { ok: false, reason: 'network', message: '인터넷에 연결되지 않았어요. 직접 입력으로 추가할 수 있어요.' };
  }
}

type OLDoc = { key: string; title?: string; author_name?: string[]; publisher?: string[]; first_publish_year?: number; isbn?: string[]; cover_i?: number };

// Open Library: 쪽수는 판본들의 중앙값만 주므로 확인된 값으로 쓰지 않는다(비워 둔다)
async function searchOpenLibrary(query: string, signal?: AbortSignal): Promise<SearchResult> {
  try {
    const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=key,title,author_name,publisher,first_publish_year,isbn,cover_i`, { signal });
    if (!res.ok) return { ok: false, reason: 'unknown', message: `검색하지 못했어요(${res.status}).` };
    const json = (await res.json()) as { docs?: OLDoc[] };
    return {
      ok: true,
      items: (json.docs ?? []).map((d) => ({
        key: `ol:${d.key}`,
        title: d.title ?? '(제목 없음)',
        authors: d.author_name ?? [],
        publisher: d.publisher?.[0],
        publishedAt: d.first_publish_year ? String(d.first_publish_year) : undefined,
        isbn13: d.isbn?.find((x) => x.length === 13),
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
        sourceName: 'Open Library',
      })),
    };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { ok: true, items: [] };
    return { ok: false, reason: 'network', message: '인터넷에 연결되지 않았어요. 직접 입력으로 추가할 수 있어요.' };
  }
}

export async function searchBooks(query: string, signal?: AbortSignal): Promise<SearchResult & { provider?: string }> {
  const g = await searchGoogle(query, signal);
  if (g.ok && g.items.length) return { ...g, provider: 'Google Books' };
  if (!g.ok && g.reason === 'network') return g;
  const o = await searchOpenLibrary(query, signal);
  if (o.ok) return { ...o, provider: 'Open Library' };
  return g.ok ? { ...g, provider: 'Google Books' } : g;
}
