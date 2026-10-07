import { buildReferenceHome, referenceHomeBooks } from '../home-reference';
import { emptyLibrary, toShelfBook, type Library } from '../library';
import { validate } from '../layout-engine';
import { withLeans } from '../shelf-scene';
import { hasRibbon } from '../ribbon-design';
import { MOCKUP_BOOKS } from '../mockup-sample';
import type { ShelfLayout } from '../types';
import { HOME_REFERENCE_BACKUP_KEY, HOME_REFERENCE_KEY, installReferenceHome } from '@/store/home-reference-install';

const time = '2026-10-04T00:00:00.000Z';
const empty: ShelfLayout = { version: 2, shelves: [], placements: [], drawer: [] };
function existing() {
  const lib = emptyLibrary();
  for (const [id, title] of [['owned', '모순'], ['other', '다른 책']]) {
    lib.editions[id] = { id, title, authors: ['기존 저자'], source: 'manual', createdAt: time, updatedAt: time };
    lib.books[id] = { id, editionId: id, status: 'read', createdAt: time, updatedAt: time };
  }
  lib.bookmarks.mark = { id: 'mark', myBookId: 'owned', text: '내가 저장한 문장', createdAt: time, updatedAt: time };
  lib.sessions.session = { id: 'session', myBookId: 'owned', startedAt: time, endedAt: time, durationMs: 60000, createdAt: time, updatedAt: time };
  return lib;
}

it('기존 책·문장·독서 기록을 보존하면서 18권을 실제 ID로 배치한다', () => {
  const original = existing();
  const before = JSON.stringify(original);
  const result = buildReferenceHome(original, empty, time);
  expect(result.profile.b01.bookId).toBe('owned');
  expect(result.lib.books.owned).toBe(original.books.owned);
  expect(result.lib.bookmarks).toBe(original.bookmarks);
  expect(result.lib.sessions).toBe(original.sessions);
  expect(JSON.stringify(original)).toBe(before);
  expect(result.layout.placements).toHaveLength(18);
  expect(result.layout.drawer).toEqual(['other']);
  const books = referenceHomeBooks(result.lib, result.profile);
  expect(result.layout.placements.map(p => books[p.bookId].title)).toEqual(MOCKUP_BOOKS.map(b => b.title));
  expect(validate(withLeans(result.layout, books), books, Object.keys(books))).toEqual([]);
});

it('예시의 서지·완독 기록을 만들어내지 않고, 홈 장식만 적용한다', () => {
  const { lib, profile } = buildReferenceHome(existing(), empty, time);
  const books = referenceHomeBooks(lib, profile);
  expect(books.owned.quotes).toBe(1);
  expect(hasRibbon(books.owned)).toBe(false);
  expect(hasRibbon(books[profile.b03.bookId])).toBe(true);
  expect(books[profile.b03.bookId].quotes).toBe(0);
  expect(toShelfBook(lib, 'owned')!.art.ribbonVisible).toBeUndefined();
  const added = lib.books[profile.b04.bookId];
  expect(added.status).toBe('want');
  expect(lib.editions[added.editionId]).toMatchObject({ authors: [], sourceName: '시안 예시' });
  expect(lib.editions[added.editionId].pageCount).toBeUndefined();
  expect(lib.editions[added.editionId].size).toBeUndefined();
  expect(Object.keys(lib.rounds)).toHaveLength(0);
  // 시안 재질: 홈 책 모양과 새로 만든 장정 모두
  expect(books[profile.b04.bookId].art.material).toBe('coated');
  expect(books[profile.b02.bookId].art.material).toBe('cloth');
  expect(books[profile.b03.bookId].art.material).toBeUndefined();
  expect(lib.bindings[lib.books[profile.b02.bookId].bindingId!].material).toBe('cloth');
  expect(lib.bindings[lib.books[profile.b03.bookId].bindingId!].material).toBeUndefined();
  expect(books.owned.art.material).toBeUndefined();
});

it('같은 서재로 다시 구성해도 중복 책을 만들지 않는다', () => {
  const a = buildReferenceHome(existing(), empty, time);
  const b = buildReferenceHome(a.lib, a.layout, time);
  expect(b).toEqual(a);
});

it('사용자가 장정을 바꾸면 홈에서도 그 선택을 사용한다', () => {
  const { lib, profile } = buildReferenceHome(existing(), empty, time);
  const id = profile.b03.bookId;
  const bd = lib.bindings[lib.books[id].bindingId!];
  lib.bindings[bd.id] = { ...bd, spineColor: '#123456', updatedAt: '2026-10-05' };
  expect(referenceHomeBooks(lib, profile)[id].themeColor).toBe('#123456');
  expect(referenceHomeBooks(lib, profile)[id].dims).toEqual(MOCKUP_BOOKS.find(b => b.id === 'b03')!.dims);
});

it('설치 전 백업하고, 완료 후 재실행에서 사용자가 바꾼 배치를 덮어쓰지 않는다', async () => {
  const mem: Record<string, string> = {};
  const saveLibrary = jest.fn(async (_lib: Library) => {});
  const setItem = jest.fn(async (k: string, value: string) => { mem[k] = value; });
  const deps = { getItem: async (k: string) => mem[k] ?? null, setItem, saveLibrary };
  const original = existing();
  const profile = await installReferenceHome(original, empty, deps);
  expect(setItem.mock.calls[0][0]).toBe(HOME_REFERENCE_BACKUP_KEY);
  expect(JSON.parse(mem[HOME_REFERENCE_BACKUP_KEY]).lib).toEqual(original);
  mem['shelf-layout'] = 'user-moved-layout';
  expect(await installReferenceHome(original, empty, deps)).toEqual(profile);
  expect(mem['shelf-layout']).toBe('user-moved-layout');
  expect(saveLibrary).toHaveBeenCalledTimes(1);
});

it('배치 저장 실패 후 같은 책 ID로 재시도하고 완료 표시는 마지막에 쓴다', async () => {
  const mem: Record<string, string> = {};
  let savedLib = existing();
  let fail = true;
  const deps = {
    getItem: async (k: string) => mem[k] ?? null,
    setItem: async (k: string, value: string) => {
      if (k === 'shelf-layout' && fail) throw new Error('disk unavailable');
      mem[k] = value;
    },
    saveLibrary: async (lib: Library) => { savedLib = lib; },
  };
  await expect(installReferenceHome(savedLib, empty, deps)).rejects.toThrow('disk unavailable');
  expect(JSON.parse(mem[HOME_REFERENCE_KEY]).complete).toBe(false);
  const ids = Object.keys(savedLib.books);
  fail = false;
  await installReferenceHome(savedLib, empty, deps);
  expect(Object.keys(savedLib.books)).toEqual(ids);
  expect(JSON.parse(mem[HOME_REFERENCE_KEY]).complete).toBe(true);
  expect(JSON.parse(mem['shelf-layout']).placements).toHaveLength(18);
});

it('백업 실패 시 서재/배치를 쓰지 않는다', async () => {
  const saveLibrary = jest.fn();
  await expect(installReferenceHome(existing(), empty, {
    getItem: async () => null,
    setItem: async () => { throw new Error('backup failed'); },
    saveLibrary,
  })).rejects.toThrow('backup failed');
  expect(saveLibrary).not.toHaveBeenCalled();
});
