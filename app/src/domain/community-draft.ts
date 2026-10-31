// 독서 기록 → 커뮤니티 공유 초안(순수 함수). 개인 기록은 자동으로 공개하지 않는다:
// 사용자가 고른 필드만 게시물에 복사하고, 고르지 않은 것(메모·날짜·다른 갈피·사진)은 보내지 않는다.
// - 분량은 시작 쪽과 도달한 쪽이 둘 다 있을 때만(확인된 분량). 하나만 있으면 보내지 않는다(지어내지 않는다)
// - 갈피 문장은 사진 갈피(글자 없음)는 고를 수 없다. 이 기록에서 남긴 갈피가 먼저, 그다음 같은 책의 최근 갈피
// - clientId는 기록 id: 같은 기록을 두 번 올려도(재시도·중복 누름) 서버에서 하나가 된다
import type { Bookmark, Library, Session } from './library';

export type ShareSource = {
  session: Session;
  bookTitle?: string;
  bookAuthor?: string;
  isbn13?: string;
  durationMs: number;
  pagesRead?: number; // 확인된 분량(쪽)
  quotes: Bookmark[];
};

export type ShareChoice = { duration: boolean; pages: boolean; quoteId?: string; body: string };

export type SharePayload = {
  clientId: string;
  isbn13?: string;
  bookTitle: string;
  bookAuthor?: string;
  durationMs?: number;
  pagesRead?: number;
  quote?: string;
  quotePage?: number;
  body?: string;
};

export function sessionPages(s: Pick<Session, 'startPage' | 'pagesRead'>): number | undefined {
  if (s.startPage === undefined || s.pagesRead === undefined) return undefined;
  const n = s.pagesRead - s.startPage;
  return n > 0 ? n : undefined;
}

export function shareSourceOf(lib: Library, sessionId: string): ShareSource | null {
  const session = lib.sessions[sessionId];
  if (!session) return null;
  const book = session.myBookId ? lib.books[session.myBookId] : undefined;
  const ed = book ? lib.editions[book.editionId] : undefined;
  const quotes = book
    ? Object.values(lib.bookmarks)
        .filter((b) => b.myBookId === book.id && b.text.trim())
        .sort((a, b) => Number(b.sessionId === sessionId) - Number(a.sessionId === sessionId) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20)
    : [];
  return {
    session,
    bookTitle: ed?.title,
    bookAuthor: ed?.authors.length ? ed.authors.join(', ') : undefined,
    isbn13: ed?.isbn13 && /^\d{13}$/.test(ed.isbn13) ? ed.isbn13 : undefined,
    durationMs: session.durationMs,
    pagesRead: sessionPages(session),
    quotes,
  };
}

// 처음 고른 상태: 시간은 켜고, 분량은 확인된 것이 있을 때만, 갈피는 이 기록에서 남긴 것이 있으면 그것
export function defaultChoice(src: ShareSource): ShareChoice {
  const linked = src.quotes.find((q) => q.sessionId === src.session.id);
  return { duration: src.durationMs > 0, pages: src.pagesRead !== undefined, quoteId: linked?.id, body: '' };
}

const MAX_BODY = 1000;
const MAX_QUOTE = 1000;

// 게시할 내용. 게시물은 책 기준이라 책(제목)은 늘 들어간다. 책 없이 읽은 기록은 게시할 수 없다(null)
export function sharePayload(src: ShareSource, c: ShareChoice): SharePayload | null {
  if (!src.bookTitle) return null;
  const quote = c.quoteId ? src.quotes.find((q) => q.id === c.quoteId) : undefined;
  const body = c.body.trim().slice(0, MAX_BODY);
  return {
    clientId: src.session.id,
    isbn13: src.isbn13,
    bookTitle: src.bookTitle,
    bookAuthor: src.bookAuthor,
    durationMs: c.duration && src.durationMs > 0 ? src.durationMs : undefined,
    pagesRead: c.pages ? src.pagesRead : undefined,
    quote: quote ? quote.text.trim().slice(0, MAX_QUOTE) : undefined,
    quotePage: quote?.page && quote.page > 0 ? quote.page : undefined,
    body: body || undefined,
  };
}
