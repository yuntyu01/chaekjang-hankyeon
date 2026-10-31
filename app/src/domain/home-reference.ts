// 시안의 장정과 배치를 실제 서재 ID에 연결한다. 독서 기록/기존 장정은 바꾸지 않는다.
import { toShelfBook, type Library } from './library';
import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from './mockup-sample';
import type { BookMap } from './layout-engine';
import type { ShelfLayout } from './types';

export type HomeReferenceProfile = Record<string, {
  bookId: string;
  bindingId?: string;
  bindingUpdatedAt?: string;
}>;

const titleKey = (title: string) => title.replace(/[\s,]/g, '');
function availableId(base: string, records: Record<string, unknown>) {
  let id = base;
  for (let i = 2; records[id]; i++) id = `${base}-${i}`;
  return id;
}

export function buildReferenceHome(original: Library, previous: ShelfLayout, _now?: string) {
  const lib: Library = { ...original, books: { ...original.books }, editions: { ...original.editions }, bindings: { ...original.bindings } };
  const profile: HomeReferenceProfile = {};
  const used = new Set<string>();
  const candidates = [...previous.placements.map(p => p.bookId), ...Object.keys(lib.books)];
  for (const sample of MOCKUP_BOOKS) {
    let id = candidates.find(id => !used.has(id) && titleKey(lib.editions[lib.books[id]?.editionId]?.title ?? '') === titleKey(sample.title));
    // 같은 제목의 내 책이 없으면 예시는 서재에 저장하지 않는다(2026-11): 책장에만 보이는 표시 전용 책(referenceHomeBooks가 그린다).
    // 전체 책 수·책 선택·통계·동기화에 들어가지 않는다
    if (!id) id = availableId(`home-reference-${sample.id}`, lib.books);
    used.add(id);
    const bindingId = lib.books[id]?.bindingId;
    profile[sample.id] = { bookId: id, bindingId, bindingUpdatedAt: bindingId ? lib.bindings[bindingId]?.updatedAt : undefined };
  }
  const layout: ShelfLayout = {
    version: 2,
    shelves: MOCKUP_LAYOUT.shelves.map(s => ({ ...s })),
    placements: MOCKUP_LAYOUT.placements.map(p => ({ ...p, bookId: profile[p.bookId].bookId,
      stackId: p.stackId ? `home-reference-${p.stackId}` : undefined })),
    drawer: [...new Set([...previous.drawer, ...previous.placements.map(p => p.bookId), ...Object.keys(lib.books)])].filter(id => !!lib.books[id] && !used.has(id)),
  };
  return { lib, layout, profile };
}

// ---------- 예시 책(표시 전용) ----------
// 2026-10-26~31 설치본은 예시 18권을 실제 서재 레코드(home-reference-b01…, 판본 출처 '시안 예시')로 저장했다.
// 손대지 않은 예시만 서재에서 뺀다(책장에는 표시 전용으로 계속 보인다): 만든 뒤 고친 적 없고(책·판본·장정의 수정 시각 = 만든 시각),
// 읽기 상태 '읽기 전', 별점·감상·현재 쪽수 없음, 회차·독서 기록·갈피가 하나도 없는 책. 제목만으로 판단하지 않는다.
// 하나라도 사용자 흔적이 있으면 실제 책으로 보존하고 이유를 남긴다(구분이 불확실하면 보존).
export const SAMPLE_ID = /^home-reference-b\d{2}(-\d+)?$/;
export const SAMPLE_SOURCE = '시안 예시';
export type SampleCheck = { id: string; pure: boolean; reasons: string[] };
export function checkSampleBooks(lib: Library): SampleCheck[] {
  const out: SampleCheck[] = [];
  const touched = new Set<string>();
  for (const r of Object.values(lib.rounds)) touched.add(r.myBookId);
  const sessions = new Set(Object.values(lib.sessions).map(s => s.myBookId).filter(Boolean) as string[]);
  const marks = new Set(Object.values(lib.bookmarks).map(m => m.myBookId));
  for (const b of Object.values(lib.books)) {
    if (!SAMPLE_ID.test(b.id)) continue;
    const e = lib.editions[b.editionId];
    if (!e || e.sourceName !== SAMPLE_SOURCE) continue;
    const bd = b.bindingId ? lib.bindings[b.bindingId] : undefined;
    const reasons: string[] = [];
    if (b.updatedAt !== b.createdAt) reasons.push('책 기록을 고친 적 있음');
    if (e.updatedAt !== e.createdAt) reasons.push('책 정보를 고친 적 있음');
    if (bd && bd.updatedAt !== bd.createdAt) reasons.push('장정을 고친 적 있음');
    if (b.status !== 'want') reasons.push('읽기 상태를 바꿈');
    if (b.rating || b.note || b.currentPage) reasons.push('별점·감상·쪽수가 있음');
    if (touched.has(b.id)) reasons.push('회차가 있음');
    if (sessions.has(b.id)) reasons.push('독서 기록이 있음');
    if (marks.has(b.id)) reasons.push('갈피가 있음');
    if (Object.values(lib.books).some(o => o.id !== b.id && o.editionId === b.editionId)) reasons.push('같은 판본을 쓰는 다른 책이 있음');
    out.push({ id: b.id, pure: !reasons.length, reasons });
  }
  return out;
}

// 손대지 않은 예시를 서재에서 뺀다(책·판본·장정). 책장 배치는 그대로라 화면에는 표시 전용 예시로 남는다
export function withoutBooks(lib: Library, ids: string[]): Library {
  if (!ids.length) return lib;
  const next: Library = { ...lib, books: { ...lib.books }, editions: { ...lib.editions }, bindings: { ...lib.bindings } };
  for (const id of ids) {
    const b = next.books[id];
    if (!b) continue;
    delete next.books[id];
    if (!Object.values(next.books).some(o => o.editionId === b.editionId)) delete next.editions[b.editionId];
    for (const bd of Object.values(lib.bindings)) if (bd.myBookId === id) delete next.bindings[bd.id];
  }
  return next;
}

// 홈에서만 시안 장정을 입힌다. 사용자가 제목/장정을 바꾸면 새 선택을 존중한다.
export function referenceHomeBooks(lib: Library, profile: HomeReferenceProfile = {}): BookMap {
  const books: BookMap = {};
  for (const id of Object.keys(lib.books)) {
    const book = toShelfBook(lib, id);
    if (book) books[id] = book;
  }
  for (const sample of MOCKUP_BOOKS) {
    const entry = profile[sample.id];
    if (!entry) continue;
    // 서재에 없는 예시(표시 전용): 시안 책 그대로 그린다. 서재 화면·통계·동기화는 lib만 보므로 들어가지 않는다
    if (!lib.books[entry.bookId]) {
      books[entry.bookId] = { ...sample, id: entry.bookId, quotes: 0, art: { ...sample.art, ribbonVisible: !!sample.art.ribbon } };
      continue;
    }
    const book = books[entry.bookId];
    if (!book) continue;
    // 색/제목을 수정해도 이미 배치한 책의 외곽 치수가 갑자기 바뀌지 않는다.
    books[book.id] = { ...book, dims: sample.dims };
    if (titleKey(book.title) !== titleKey(sample.title)) continue;
    const owned = lib.books[book.id];
    if (owned.bindingId !== entry.bindingId || (owned.bindingId && lib.bindings[owned.bindingId]?.updatedAt !== entry.bindingUpdatedAt)) continue;
    books[book.id] = { ...book, themeColor: sample.themeColor, heightClass: sample.heightClass,
      thicknessClass: sample.thicknessClass, coverAspectRatio: sample.coverAspectRatio,
      dims: sample.dims, cover: sample.cover, body: sample.body,
      coverArtUri: undefined, spineArtUri: undefined,
      art: { ...sample.art, ribbonVisible: !!sample.art.ribbon } };
  }
  return books;
}
