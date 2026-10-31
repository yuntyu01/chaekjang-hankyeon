// 서버 동기화의 순수 규칙(네트워크·저장소와 무관). 앱 서재 항목 ↔ 서버 전송 형식, 받은 변경 병합.
// - 충돌: updatedAt이 더 새로운 쪽이 이긴다(같으면 이 기기 것을 유지). 서버도 같은 규칙이다.
// - 삭제: 지우면 삭제 표시(tombstone)를 올려 다른 기기에서도 지운다.
// - 사진: 파일 이름(앱 보관 폴더 안)을 그대로 파일 id로 쓴다 → 다른 기기에서 받으면 같은 이름으로 저장된다.
import { LIB_KINDS, type LibKind } from '@/db/local-db';
import { isCoverArtworkId } from './cover-artworks';
import type { Binding, Bookmark, Edition, Library, MyBook, Round, Session } from './library';
import { heightClassOf, thicknessClassOf, type LayoutVariant } from './rebinding';
import { BINDING_MATERIALS, type BindingMaterial } from './types';

export type Dirty = Record<string, { deleted: boolean; at: string }>; // 키: "kind:id"
export const dirtyKey = (kind: LibKind, id: string) => `${kind}:${id}`;

// ---- 전송 형식(서버 SyncDtos와 같은 모양) ----
type Wire = { id: string; updatedAt: string; deleted?: boolean | null };
export type WireEdition = Wire & {
  isbn13?: string | null; title?: string; authors?: string[]; publisher?: string | null; publishedAt?: string | null; pageCount?: number | null;
  widthMm?: number | null; heightMm?: number | null; category?: string | null; seriesTitle?: string | null; coverUrl?: string | null; coverFileId?: string | null;
  coverSource?: string | null; source?: string; sourceName?: string | null;
  art?: { baseColor: string; inkColor?: string | null; accentColor?: string | null; motifId?: string | null; layoutVariant?: string | null; version?: number | null; generatedAt?: string | null } | null;
  createdAt?: string;
};
export type WireBook = Wire & { editionId?: string; status?: string; rating?: number | null; note?: string | null; currentPage?: number | null; bindingId?: string | null; createdAt?: string };
export type WireBinding = Wire & {
  myBookId?: string; spineColor?: string; inkColor?: string | null; accentColor?: string | null; motif?: string; layout?: string | null; material?: string | null; coverArtId?: string | null; source?: string; status?: string;
  seed?: number | null; coverArtFileId?: string | null; spineArtFileId?: string | null; createdAt?: string;
};
export type WireRound = Wire & { myBookId?: string; index?: number; startedAt?: string | null; finishedAt?: string | null; paused?: boolean | null; createdAt?: string };
export type WireSession = Wire & {
  myBookId?: string | null; roundId?: string | null; startedAt?: string; endedAt?: string; durationMs?: number; pagesRead?: number | null; memo?: string | null; createdAt?: string;
};
export type WireBookmark = Wire & { myBookId?: string; text?: string; page?: number | null; memo?: string | null; photoFileId?: string | null; photoRatio?: number | null; createdAt?: string };
export type WireLayout = { layoutJson: string; version: number; updatedAt: string };

export type PushBody = {
  editions?: WireEdition[]; books?: WireBook[]; bindings?: WireBinding[]; rounds?: WireRound[]; sessions?: WireSession[]; bookmarks?: WireBookmark[]; layout?: WireLayout;
};
export type PullBody = {
  rev: number; more: boolean; syncEpoch?: number; editions: WireEdition[]; books: WireBook[]; bindings: WireBinding[]; rounds: WireRound[]; sessions: WireSession[]; bookmarks: WireBookmark[];
  layout?: WireLayout | null;
};

// 시각 비교는 문자열이 아니라 시각으로(서버는 ...:00Z, 앱은 ...:00.000Z로 같은 시각을 달리 적을 수 있다)
const ms = (s: string) => Date.parse(s) || 0;

const nz = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined || (v as unknown) === '' ? undefined : v);

// 앱 보관 폴더(images/) 안의 파일이면 파일 이름이 곧 파일 id
export function fileIdOf(uri: string | undefined, imageDir: string): string | undefined {
  if (!uri || !uri.startsWith(imageDir)) return undefined;
  const name = uri.slice(imageDir.length);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(name) ? name : undefined;
}

// ---- 앱 → 서버 ----
export function editionToWire(e: Edition, imageDir: string): WireEdition {
  const photo = e.coverSource === 'photo' ? fileIdOf(e.coverUri, imageDir) : undefined;
  return {
    id: e.id, isbn13: e.isbn13, title: e.title, authors: e.authors, publisher: e.publisher, publishedAt: e.publishedAt, pageCount: e.pageCount,
    widthMm: e.size?.widthMm, heightMm: e.size?.heightMm, category: e.category, seriesTitle: e.seriesTitle,
    coverUrl: e.coverSource === 'api' ? e.coverUri : undefined, coverFileId: photo, coverSource: photo || e.coverSource === 'api' ? e.coverSource : undefined,
    source: e.source, sourceName: e.sourceName,
    art: e.art ? { baseColor: e.art.baseColor, inkColor: e.art.inkColor, accentColor: e.art.accentColor, motifId: e.art.motifId, layoutVariant: e.art.layoutVariant, version: e.art.version, generatedAt: e.art.generatedAt || undefined } : undefined,
    createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}
export const bookToWire = (b: MyBook): WireBook => ({ id: b.id, editionId: b.editionId, status: b.status, rating: b.rating, note: b.note, currentPage: b.currentPage, bindingId: b.bindingId, createdAt: b.createdAt, updatedAt: b.updatedAt });
export const bindingToWire = (b: Binding, imageDir: string): WireBinding => ({
  id: b.id, myBookId: b.myBookId, spineColor: b.spineColor, inkColor: b.inkColor, accentColor: b.accentColor, motif: b.motif, layout: b.layout, material: b.material, coverArtId: b.coverArtId, source: b.source, status: b.status,
  seed: b.seed, coverArtFileId: fileIdOf(b.coverArtUri, imageDir), spineArtFileId: fileIdOf(b.spineArtUri, imageDir), createdAt: b.createdAt, updatedAt: b.updatedAt,
});
export const roundToWire = (r: Round): WireRound => ({ id: r.id, myBookId: r.myBookId, index: r.index, startedAt: r.startedAt, finishedAt: r.finishedAt, paused: !!r.paused, createdAt: r.createdAt, updatedAt: r.updatedAt });
export const sessionToWire = (s: Session): WireSession => ({
  id: s.id, myBookId: s.myBookId, roundId: s.roundId, startedAt: s.startedAt, endedAt: s.endedAt, durationMs: s.durationMs, pagesRead: s.pagesRead, memo: s.memo, createdAt: s.createdAt, updatedAt: s.updatedAt,
});
export const bookmarkToWire = (m: Bookmark, imageDir: string): WireBookmark => ({
  id: m.id, myBookId: m.myBookId, text: m.text, page: m.page, memo: m.memo, photoFileId: fileIdOf(m.photoUri, imageDir), photoRatio: m.photoRatio, createdAt: m.createdAt, updatedAt: m.updatedAt,
});

// 올릴 변경 묶음: 바뀐 항목(현재 값)과 삭제 표시. 이미 사라진 항목이 dirty에 없고 삭제도 아니면 건너뛴다.
export function buildPush(lib: Library, dirty: Dirty, imageDir: string): { body: PushBody; count: number } {
  const body: Required<Omit<PushBody, 'layout'>> = { editions: [], books: [], bindings: [], rounds: [], sessions: [], bookmarks: [] };
  let count = 0;
  for (const [key, d] of Object.entries(dirty)) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i) as LibKind;
    const id = key.slice(i + 1);
    if (!(LIB_KINDS as readonly string[]).includes(kind)) continue;
    if (d.deleted) {
      (body[kind] as Wire[]).push({ id, deleted: true, updatedAt: d.at });
      count++;
      continue;
    }
    switch (kind) {
      case 'editions': if (lib.editions[id]) body.editions.push(editionToWire(lib.editions[id], imageDir)); else continue; break;
      case 'books': if (lib.books[id]) body.books.push(bookToWire(lib.books[id])); else continue; break;
      case 'bindings': if (lib.bindings[id]) body.bindings.push(bindingToWire(lib.bindings[id], imageDir)); else continue; break;
      case 'rounds': if (lib.rounds[id]) body.rounds.push(roundToWire(lib.rounds[id])); else continue; break;
      case 'sessions': if (lib.sessions[id]) body.sessions.push(sessionToWire(lib.sessions[id])); else continue; break;
      case 'bookmarks': if (lib.bookmarks[id]) body.bookmarks.push(bookmarkToWire(lib.bookmarks[id], imageDir)); else continue; break;
    }
    count++;
  }
  return { body, count };
}

// 서재 전체를 올릴 묶음(처음 연결하거나 참조 오류로 다시 올릴 때)
export function fullDirty(lib: Library): Dirty {
  const out: Dirty = {};
  for (const kind of LIB_KINDS) for (const item of Object.values(lib[kind]) as { id: string; updatedAt: string }[]) out[dirtyKey(kind, item.id)] = { deleted: false, at: item.updatedAt };
  return out;
}

// ---- 서버 → 앱 ----
export const editionFromWire = (w: WireEdition, imageDir: string): Edition => ({
  id: w.id, isbn13: nz(w.isbn13), title: w.title ?? '', authors: w.authors ?? [], publisher: nz(w.publisher), publishedAt: nz(w.publishedAt), pageCount: nz(w.pageCount),
  size: w.widthMm && w.heightMm ? { widthMm: w.widthMm, heightMm: w.heightMm } : undefined, category: nz(w.category), seriesTitle: nz(w.seriesTitle),
  coverUri: w.coverFileId ? `${imageDir}${w.coverFileId}` : nz(w.coverUrl), coverSource: (nz(w.coverSource) as Edition['coverSource']) ?? undefined,
  source: (w.source as Edition['source']) ?? 'manual', sourceName: nz(w.sourceName),
  art: w.art?.baseColor
    ? { baseColor: w.art.baseColor, inkColor: w.art.inkColor ?? '#2F3944', accentColor: w.art.accentColor ?? w.art.baseColor, motifId: (w.art.motifId ?? 'leaf') as never, layoutVariant: (w.art.layoutVariant ?? 'spine_a') as LayoutVariant, heightClass: heightClassOf(w.heightMm ?? 188), thicknessClass: thicknessClassOf(w.pageCount ?? 250), generatedAt: w.art.generatedAt ?? '', version: w.art.version ?? 1 }
    : undefined,
  createdAt: w.createdAt ?? w.updatedAt, updatedAt: w.updatedAt,
});
export const bookFromWire = (w: WireBook): MyBook => ({ id: w.id, editionId: w.editionId ?? '', status: (w.status as MyBook['status']) ?? 'want', rating: nz(w.rating), note: nz(w.note), currentPage: nz(w.currentPage), bindingId: nz(w.bindingId), createdAt: w.createdAt ?? w.updatedAt, updatedAt: w.updatedAt });
export const bindingFromWire = (w: WireBinding, imageDir: string): Binding => ({
  id: w.id, myBookId: w.myBookId ?? '', spineColor: w.spineColor ?? '#8A8378', inkColor: nz(w.inkColor), accentColor: nz(w.accentColor), motif: w.motif ?? 'none', layout: nz(w.layout) as LayoutVariant | undefined,
  material: BINDING_MATERIALS.includes(w.material as BindingMaterial) ? (w.material as BindingMaterial) : undefined,
  coverArtId: isCoverArtworkId(w.coverArtId) ? w.coverArtId : undefined,
  coverArtUri: w.coverArtFileId ? `${imageDir}${w.coverArtFileId}` : undefined, spineArtUri: w.spineArtFileId ? `${imageDir}${w.spineArtFileId}` : undefined,
  source: (w.source as Binding['source']) ?? 'default', status: (w.status as Binding['status']) ?? 'ready', seed: w.seed ?? 0, createdAt: w.createdAt ?? w.updatedAt, updatedAt: w.updatedAt,
});
export const roundFromWire = (w: WireRound): Round => ({ id: w.id, myBookId: w.myBookId ?? '', index: w.index ?? 1, startedAt: nz(w.startedAt), finishedAt: nz(w.finishedAt), paused: w.paused ? true : undefined, createdAt: w.createdAt ?? w.updatedAt, updatedAt: w.updatedAt });
export const sessionFromWire = (w: WireSession): Session => ({
  id: w.id, myBookId: nz(w.myBookId), roundId: nz(w.roundId), startedAt: w.startedAt ?? w.updatedAt, endedAt: w.endedAt ?? w.updatedAt, durationMs: w.durationMs ?? 0, pagesRead: nz(w.pagesRead), memo: nz(w.memo),
  createdAt: w.createdAt ?? w.updatedAt, updatedAt: w.updatedAt,
});
export const bookmarkFromWire = (w: WireBookmark, imageDir: string): Bookmark => ({
  id: w.id, myBookId: w.myBookId ?? '', text: w.text ?? '', page: nz(w.page), memo: nz(w.memo), photoUri: w.photoFileId ? `${imageDir}${w.photoFileId}` : undefined, photoRatio: nz(w.photoRatio),
  createdAt: w.createdAt ?? w.updatedAt, updatedAt: w.updatedAt,
});

export type Merge = { lib: Library; writes: { kind: LibKind; item: { id: string; updatedAt: string } }[]; erases: { kind: LibKind; id: string }[]; files: string[] };

// 받은 변경을 서재에 합친다. 더 새로운 쪽이 이긴다. 받아 와야 할 사진 파일 id도 돌려준다.
export function mergeRemote(lib: Library, pull: PullBody, imageDir: string, dirty: Dirty = {}): Merge {
  const next: Library = { editions: { ...lib.editions }, books: { ...lib.books }, rounds: { ...lib.rounds }, sessions: { ...lib.sessions }, bookmarks: { ...lib.bookmarks }, bindings: { ...lib.bindings } };
  const writes: Merge['writes'] = [];
  const erases: Merge['erases'] = [];
  const files = new Set<string>();
  const apply = <T extends { id: string; updatedAt: string }>(kind: LibKind, wires: (Wire & Record<string, unknown>)[], convert: (w: never) => T) => {
    const table = next[kind] as unknown as Record<string, T>;
    for (const w of wires) {
      const pending = dirty[dirtyKey(kind, w.id)];
      // 로컬에서 삭제했지만 아직 올리지 않은 기록을 오래된 서버 값으로 되살리지 않는다.
      if (pending?.deleted && ms(pending.at) >= ms(w.updatedAt)) continue;
      const local = table[w.id];
      if (w.deleted) {
        if (local && ms(local.updatedAt) <= ms(w.updatedAt)) {
          delete table[w.id];
          erases.push({ kind, id: w.id });
        }
        continue;
      }
      if (local && ms(local.updatedAt) >= ms(w.updatedAt)) continue;
      const item = convert(w as never);
      table[w.id] = item;
      writes.push({ kind, item });
    }
  };
  apply('editions', pull.editions as never, (w: WireEdition) => editionFromWire(w, imageDir));
  apply('books', pull.books as never, bookFromWire as never);
  apply('bindings', pull.bindings as never, (w: WireBinding) => bindingFromWire(w, imageDir));
  apply('rounds', pull.rounds as never, roundFromWire as never);
  apply('sessions', pull.sessions as never, sessionFromWire as never);
  apply('bookmarks', pull.bookmarks as never, (w: WireBookmark) => bookmarkFromWire(w, imageDir));
  for (const w of writes) {
    const it = w.item as unknown as { coverFileId?: string; photoUri?: string; coverUri?: string; coverArtUri?: string; spineArtUri?: string };
    for (const uri of [it.photoUri, it.coverUri, it.coverArtUri, it.spineArtUri]) {
      const id = fileIdOf(uri, imageDir);
      if (id) files.add(id);
    }
  }
  return { lib: next, writes, erases, files: [...files] };
}
