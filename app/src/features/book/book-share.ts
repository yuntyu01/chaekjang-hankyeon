// 책 공유 카드의 내용(그리기와 따로 시험할 수 있게): 제목·저자·한 줄 감상·별점·독서 시간·읽은 기간(읽기 상태는 2026-11-10 시안부터 카드에 넣지 않는다)
import { bookReadMs, formatDuration, memoShelfBook, roundsOf, type Library } from '@/domain/library';
import type { Book } from '@/domain/types';
import { STATUS_LABEL } from './labels';

export type BookShareData = { id: string; book: Book; title: string; author?: string; status: string; note?: string; rating?: number; readTime?: string; period?: string };
export type ShareParts = { note: boolean; rating: boolean; time: boolean; period: boolean };
export const ALL_PARTS: ShareParts = { note: true, rating: true, time: true, period: true };
// 처음 고른 것(2026-11-10 시안: 한 줄 감상과 별점만). 독서 시간·읽은 기간은 칩으로 더한다
export const DEFAULT_PARTS: ShareParts = { note: true, rating: true, time: false, period: false };

const dot = (d: string) => d.slice(0, 10).replace(/-/g, '.');
// 읽은 기간: 첫 회차 시작 — 마지막 완독(같은 해면 끝은 월.일만). 읽는 중이면 '부터', 시작일 없이 완독만 있으면 완독일
export function readPeriod(start?: string, end?: string, reading = false) {
  if (start && end) return `${dot(start)} — ${end.slice(0, 4) === start.slice(0, 4) ? dot(end).slice(5) : dot(end)}`;
  if (start) return reading ? `${dot(start)}부터` : dot(start);
  if (end) return `${dot(end)} 완독`;
  return undefined;
}

// 책장에 놓인 모습(book)이 있으면 그것으로, 없으면 서재 기록으로 그린다
export function bookShareData(lib: Library, id: string, placed?: Book): BookShareData | null {
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const book = placed ?? memoShelfBook(lib, id);
  if (!b || !e || !book) return null;
  const rounds = roundsOf(lib, id);
  const start = rounds.find((r) => r.startedAt)?.startedAt;
  const end = [...rounds].reverse().find((r) => r.finishedAt)?.finishedAt;
  const ms = bookReadMs(lib, id);
  return {
    id,
    book,
    title: e.title,
    author: e.authors.join(', ') || undefined,
    status: STATUS_LABEL[b.status],
    note: b.note?.trim() || undefined,
    rating: b.rating,
    readTime: ms >= 60000 ? formatDuration(ms) : undefined,
    period: readPeriod(start, b.status === 'read' ? end : undefined, b.status === 'reading') ?? (end ? readPeriod(undefined, end) : undefined),
  };
}
