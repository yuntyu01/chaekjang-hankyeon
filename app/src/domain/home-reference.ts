// 시안의 장정과 배치를 실제 서재 ID에 연결한다. 독서 기록/기존 장정은 바꾸지 않는다.
import { defaultBinding, toShelfBook, type Library } from './library';
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

export function buildReferenceHome(original: Library, previous: ShelfLayout, now: string) {
  const lib: Library = { ...original, books: { ...original.books }, editions: { ...original.editions }, bindings: { ...original.bindings } };
  const profile: HomeReferenceProfile = {};
  const used = new Set<string>();
  const candidates = [...previous.placements.map(p => p.bookId), ...Object.keys(lib.books)];
  for (const sample of MOCKUP_BOOKS) {
    let id = candidates.find(id => !used.has(id) && titleKey(lib.editions[lib.books[id]?.editionId]?.title ?? '') === titleKey(sample.title));
    if (!id) {
      id = availableId(`home-reference-${sample.id}`, lib.books);
      const editionId = availableId(`home-reference-ed-${sample.id}`, lib.editions);
      const binding = defaultBinding(id, sample.title, 0, now);
      binding.id = availableId(`home-reference-bd-${sample.id}`, lib.bindings);
      binding.spineColor = sample.themeColor;
      lib.editions[editionId] = { id: editionId, title: sample.title, authors: [], source: 'manual', sourceName: '시안 예시', createdAt: now, updatedAt: now };
      lib.books[id] = { id, editionId, bindingId: binding.id, status: 'want', createdAt: now, updatedAt: now };
      lib.bindings[binding.id] = binding;
    }
    used.add(id);
    const bindingId = lib.books[id].bindingId;
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

// 홈에서만 시안 장정을 입힌다. 사용자가 제목/장정을 바꾸면 새 선택을 존중한다.
export function referenceHomeBooks(lib: Library, profile: HomeReferenceProfile = {}): BookMap {
  const books: BookMap = {};
  for (const id of Object.keys(lib.books)) {
    const book = toShelfBook(lib, id);
    if (book) books[id] = book;
  }
  for (const sample of MOCKUP_BOOKS) {
    const entry = profile[sample.id];
    const book = entry && books[entry.bookId];
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
