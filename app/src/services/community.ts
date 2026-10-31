// 커뮤니티(공개 데이터) API 클라이언트. 개인 서재 동기화(/sync)와 엔드포인트·서버 표가 따로다.
// 공개되는 것은 사용자가 게시·평가할 때 고른 필드뿐이고, 다른 사람의 개인 기록은 볼 수 없다.
// 서버 주소가 없는 빌드·커뮤니티 API가 없는 예전 서버에서는 '쓸 수 없음'을 그대로 알린다(가짜 피드를 채우지 않는다).
import { ApiError, createApiClient } from '@/services/api-client';
import { serverBase, serverToken } from '@/services/sync';

const api = createApiClient(serverBase);

export type PublicProfile = { userId: number; nickname: string; bio?: string; followers: number; following: number; posts: number };
export type Post = {
  id: number;
  userId: number;
  nickname: string;
  isbn13?: string;
  bookTitle: string;
  bookAuthor?: string;
  durationMs?: number;
  pagesRead?: number;
  quote?: string;
  quotePage?: number;
  body?: string;
  likes: number;
  liked: boolean;
  comments: number;
  mine: boolean;
  createdAt: string;
};
export type Comment = { id: number; userId: number; nickname: string; body: string; mine: boolean; createdAt: string };
export type Review = { userId: number; nickname?: string; isbn13: string; bookTitle?: string; rating: number; body?: string; updatedAt: string };
export type BookReviews = { isbn13: string; average: number | null; count: number; mine: Review | null; items: Review[] };
export type Feed = { items: Post[]; nextBefore: number | null };
export type UserPage = { profile: PublicProfile; followed: boolean; blocked: boolean; me: boolean; posts: Post[]; reviews: Review[] };
export type MyProfile = { profile: PublicProfile | null; socialLinked: boolean };
export type PostDraft = {
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
export type ReportKind = 'post' | 'comment' | 'user' | 'review';

// 커뮤니티를 쓸 수 있는지: 서버 주소 → 서버가 커뮤니티 API를 가졌는지(/healthz의 community)
export type Availability = { ok: true } | { ok: false; reason: 'no-server' | 'old-server' | 'offline'; message: string };
let checked: Promise<Availability> | null = null;
export function communityAvailability(force = false): Promise<Availability> {
  if (!serverBase) return Promise.resolve({ ok: false, reason: 'no-server', message: '이 빌드는 서버 없이 이 기기에만 저장해요. 커뮤니티는 서버가 있는 빌드에서 쓸 수 있어요.' });
  if (force || !checked)
    checked = api<{ community?: boolean }>('GET', '/healthz', null)
      .then((h): Availability => (h?.community ? { ok: true } : { ok: false, reason: 'old-server', message: '연결된 서버가 아직 커뮤니티를 지원하지 않아요. 서버가 업데이트되면 쓸 수 있어요.' }))
      .catch((e: unknown): Availability => {
        checked = null; // 연결 실패는 다음에 다시 확인
        return { ok: false, reason: 'offline', message: errorMessage(e) };
      });
  return checked;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await serverToken();
  return api<T>(method, path, token, body);
}

// 서버 오류 코드 → 다음 행동(화면이 고른다)
export const needsSocial = (e: unknown) => e instanceof ApiError && e.code === 'needs_social_account';
export const needsProfile = (e: unknown) => e instanceof ApiError && e.code === 'needs_profile';
export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message;
  const m = String((e as Error)?.message ?? e);
  return /Network request failed|fetch/i.test(m) ? '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' : m;
}

const enc = encodeURIComponent;
export const community = {
  myProfile: () => call<MyProfile>('GET', '/community/profile'),
  saveProfile: (nickname: string, bio?: string) => call<MyProfile>('PUT', '/community/profile', { nickname, bio: bio ?? null }),
  user: (id: number) => call<UserPage>('GET', `/community/users/${id}`),
  follow: (id: number, on: boolean) => call<{ followed: boolean }>(on ? 'PUT' : 'DELETE', `/community/users/${id}/follow`),
  blocks: () => call<{ items: { userId: number; nickname: string }[] }>('GET', '/community/blocks'),
  block: (id: number, on: boolean) => call<{ blocked: boolean }>(on ? 'PUT' : 'DELETE', `/community/users/${id}/block`),
  feed: (scope: 'discover' | 'following', before?: number | null) => call<Feed>('GET', `/community/feed?scope=${scope}${before ? `&before=${before}` : ''}`),
  post: (id: number) => call<Post>('GET', `/community/posts/${id}`),
  createPost: (d: PostDraft) => call<Post>('POST', '/community/posts', d),
  editPost: (id: number, body: string) => call<Post>('PATCH', `/community/posts/${id}`, { body }),
  deletePost: (id: number) => call<{ deleted: boolean }>('DELETE', `/community/posts/${id}`),
  like: (id: number, on: boolean) => call<Post>(on ? 'PUT' : 'DELETE', `/community/posts/${id}/like`),
  comments: (id: number) => call<{ items: Comment[] }>('GET', `/community/posts/${id}/comments`),
  addComment: (id: number, body: string, clientId: string) => call<{ items: Comment[] }>('POST', `/community/posts/${id}/comments`, { body, clientId }),
  deleteComment: (id: number) => call<{ deleted: boolean }>('DELETE', `/community/comments/${id}`),
  reviews: (isbn13: string) => call<BookReviews>('GET', `/community/books/${enc(isbn13)}/reviews`),
  saveReview: (isbn13: string, rating: number, body: string | undefined, bookTitle: string) => call<BookReviews>('PUT', `/community/books/${enc(isbn13)}/review`, { rating, body: body ?? null, bookTitle }),
  deleteReview: (isbn13: string) => call<BookReviews>('DELETE', `/community/books/${enc(isbn13)}/review`),
  report: (kind: ReportKind, id: string | number, reason?: string) => call<unknown>('POST', '/community/reports', { kind, id: String(id), reason: reason ?? null }),
};
