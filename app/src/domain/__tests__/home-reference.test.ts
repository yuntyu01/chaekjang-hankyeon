import { buildReferenceHome, checkSampleBooks, referenceHomeBooks, withoutBooks } from '../home-reference';
import { defaultBinding, emptyLibrary, toShelfBook, type Library } from '../library';
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

it('예시는 서재에 저장하지 않고(표시 전용) 홈 장식만 적용한다', () => {
  const original = existing();
  const { lib, profile } = buildReferenceHome(original, empty, time);
  // 같은 제목의 내 책(모순)만 연결되고, 나머지 17권은 서재 레코드를 만들지 않는다
  expect(Object.keys(lib.books).sort()).toEqual(Object.keys(original.books).sort());
  expect(Object.keys(lib.editions)).toHaveLength(Object.keys(original.editions).length);
  expect(Object.keys(lib.bindings)).toHaveLength(0);
  expect(Object.keys(lib.rounds)).toHaveLength(0);
  const books = referenceHomeBooks(lib, profile);
  expect(books.owned.quotes).toBe(1);
  expect(hasRibbon(books.owned)).toBe(false);
  expect(hasRibbon(books[profile.b03.bookId])).toBe(true);
  expect(books[profile.b03.bookId].quotes).toBe(0);
  expect(toShelfBook(lib, 'owned')!.art.ribbonVisible).toBeUndefined();
  // 시안 재질은 표시 전용 책 모양에만
  expect(books[profile.b04.bookId].art.material).toBe('coated');
  expect(books[profile.b02.bookId].art.material).toBe('cloth');
  expect(books[profile.b03.bookId].art.material).toBeUndefined();
  expect(books.owned.art.material).toBeUndefined();
});

it('같은 서재로 다시 구성해도 중복 책을 만들지 않는다', () => {
  const a = buildReferenceHome(existing(), empty, time);
  const b = buildReferenceHome(a.lib, a.layout, time);
  expect(b).toEqual(a);
});

it('사용자가 장정을 바꾸면 홈에서도 그 선택을 사용한다', () => {
  const original = existing();
  const bd0 = defaultBinding('owned', '모순', 0, time);
  original.bindings[bd0.id] = bd0;
  original.books.owned = { ...original.books.owned, bindingId: bd0.id };
  const { lib, profile } = buildReferenceHome(original, empty, time);
  const id = profile.b01.bookId;
  expect(id).toBe('owned');
  const bd = lib.bindings[lib.books[id].bindingId!];
  lib.bindings[bd.id] = { ...bd, spineColor: '#123456', updatedAt: '2026-10-05' };
  expect(referenceHomeBooks(lib, profile)[id].themeColor).toBe('#123456');
  expect(referenceHomeBooks(lib, profile)[id].dims).toEqual(MOCKUP_BOOKS.find(b => b.id === 'b01')!.dims);
});

it('설치 전 백업하고, 완료 후 재실행에서 사용자가 바꾼 배치를 덮어쓰지 않는다', async () => {
  const mem: Record<string, string> = {};
  const saveLibrary = jest.fn(async (_lib: Library) => {});
  const setItem = jest.fn(async (k: string, value: string) => { mem[k] = value; });
  const deps = { getItem: async (k: string) => mem[k] ?? null, setItem, saveLibrary };
  const original = emptyLibrary();
  const profile = await installReferenceHome(original, empty, deps);
  expect(setItem.mock.calls[0][0]).toBe(HOME_REFERENCE_BACKUP_KEY);
  expect(JSON.parse(mem[HOME_REFERENCE_BACKUP_KEY]).lib).toEqual(original);
  mem['shelf-layout'] = 'user-moved-layout';
  expect(await installReferenceHome(original, empty, deps)).toEqual(profile);
  expect(mem['shelf-layout']).toBe('user-moved-layout');
  // 새 서재에 예시를 저장하지 않는다(2026-11): 서재 쓰기 없음
  expect(saveLibrary).not.toHaveBeenCalled();
});

it('배치 저장 실패 후 같은 책 ID로 재시도하고 완료 표시는 마지막에 쓴다', async () => {
  const mem: Record<string, string> = {};
  let savedLib = emptyLibrary();
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
  await expect(installReferenceHome(emptyLibrary(), empty, {
    getItem: async () => null,
    setItem: async () => { throw new Error('backup failed'); },
    saveLibrary,
  })).rejects.toThrow('backup failed');
  expect(saveLibrary).not.toHaveBeenCalled();
});

it('기존 서재와 배치는 시안으로 덮어쓰지 않는다', async () => {
  const original = existing();
  const prior: ShelfLayout = { version: 2, shelves: [{ id: 'my-shelf', order: 0 }], placements: [{ bookId: 'owned', shelfId: 'my-shelf', order: 0, pose: 'spine', tilt: 0, pos: 10 }], drawer: ['other'] };
  const mem: Record<string, string> = { 'shelf-layout': JSON.stringify(prior) };
  const setItem = jest.fn(async (key: string, value: string) => { mem[key] = value; });
  const saveLibrary = jest.fn();
  expect(await installReferenceHome(original, prior, { getItem: async key => mem[key] ?? null, setItem, saveLibrary, hasSavedLayout: true })).toEqual({});
  expect(mem['shelf-layout']).toBe(JSON.stringify(prior));
  expect(setItem).not.toHaveBeenCalled();
  expect(saveLibrary).not.toHaveBeenCalled();
});

it('저장된 빈 책장도 사용자 배치로 보존한다', async () => {
  const setItem = jest.fn();
  const saveLibrary = jest.fn();
  expect(await installReferenceHome(emptyLibrary(), empty, { getItem: async () => null, setItem, saveLibrary, hasSavedLayout: true })).toEqual({});
  expect(setItem).not.toHaveBeenCalled();
  expect(saveLibrary).not.toHaveBeenCalled();
});

it('기존 기록을 가진 이전 미완료 시안 계획은 다시 실행하지 않는다', async () => {
  const original = existing();
  const prior = buildReferenceHome(original, empty, time);
  const mem: Record<string, string> = {
    [HOME_REFERENCE_KEY]: JSON.stringify({ ...prior, complete: false }),
    [HOME_REFERENCE_BACKUP_KEY]: JSON.stringify({ lib: original, layout: empty }),
  };
  const setItem = jest.fn();
  const saveLibrary = jest.fn();
  expect(await installReferenceHome(original, empty, { getItem: async key => mem[key] ?? null, setItem, saveLibrary })).toEqual({});
  expect(setItem).not.toHaveBeenCalled();
  expect(saveLibrary).not.toHaveBeenCalled();
});

it('미완료 설치 이후 사용자가 바꾼 배치는 보존한다', async () => {
  const original = emptyLibrary();
  const prior = buildReferenceHome(original, empty, time);
  const changed = { ...prior.layout, drawer: [...prior.layout.drawer, 'later-book'] };
  const mem: Record<string, string> = {
    [HOME_REFERENCE_KEY]: JSON.stringify({ ...prior, complete: false }),
    [HOME_REFERENCE_BACKUP_KEY]: JSON.stringify({ lib: original, layout: empty }),
  };
  const setItem = jest.fn();
  const saveLibrary = jest.fn();
  expect(await installReferenceHome(prior.lib, changed, { getItem: async key => mem[key] ?? null, setItem, saveLibrary, hasSavedLayout: true })).toEqual({});
  expect(setItem).not.toHaveBeenCalled();
  expect(saveLibrary).not.toHaveBeenCalled();
});

describe('예시 책 분리(2026-11 이전 설치본)', () => {
  // 예전 설치가 만든 모양: home-reference-bNN 책 + '시안 예시' 판본 + 장정, 만든 시각 = 수정 시각
  function oldInstall() {
    const lib = emptyLibrary();
    for (const n of ['b01', 'b02', 'b03']) {
      const id = `home-reference-${n}`;
      const ed = `home-reference-ed-${n}`;
      const bd = defaultBinding(id, n, 0, time);
      bd.id = `home-reference-bd-${n}`;
      lib.editions[ed] = { id: ed, title: n, authors: [], source: 'manual', sourceName: '시안 예시', createdAt: time, updatedAt: time };
      lib.books[id] = { id, editionId: ed, bindingId: bd.id, status: 'want', createdAt: time, updatedAt: time };
      lib.bindings[bd.id] = bd;
    }
    return lib;
  }
  it('손대지 않은 예시만 고르고, 기록·갈피·수정이 있으면 이유와 함께 보존', () => {
    const lib = oldInstall();
    lib.bookmarks.m = { id: 'm', myBookId: 'home-reference-b02', text: '남긴 문장', createdAt: time, updatedAt: time };
    lib.books['home-reference-b03'] = { ...lib.books['home-reference-b03'], rating: 4, updatedAt: '2026-10-20' };
    const checks = checkSampleBooks(lib);
    expect(checks.find(c => c.id === 'home-reference-b01')).toMatchObject({ pure: true });
    expect(checks.find(c => c.id === 'home-reference-b02')!.reasons).toContain('갈피가 있음');
    expect(checks.find(c => c.id === 'home-reference-b03')!.reasons).toEqual(expect.arrayContaining(['책 기록을 고친 적 있음', '별점·감상·쪽수가 있음']));
  });
  it('제목이 같아도 예시 ID·출처가 아니면 건드리지 않는다', () => {
    const lib = existing();
    lib.books.owned = { ...lib.books.owned, status: 'want' };
    expect(checkSampleBooks(lib)).toEqual([]);
    const fake = oldInstall();
    fake.editions['home-reference-ed-b01'] = { ...fake.editions['home-reference-ed-b01'], sourceName: undefined };
    expect(checkSampleBooks(fake).map(c => c.id)).not.toContain('home-reference-b01');
  });
  it('뺀 예시는 책·판본·장정이 서재에서 사라지고, 책장에는 표시 전용으로 남는다', () => {
    const lib = oldInstall();
    const profile = { b01: { bookId: 'home-reference-b01' }, b02: { bookId: 'home-reference-b02' }, b03: { bookId: 'home-reference-b03' } };
    const next = withoutBooks(lib, ['home-reference-b01']);
    expect(next.books['home-reference-b01']).toBeUndefined();
    expect(next.editions['home-reference-ed-b01']).toBeUndefined();
    expect(next.bindings['home-reference-bd-b01']).toBeUndefined();
    expect(next.books['home-reference-b02']).toBeDefined();
    const books = referenceHomeBooks(next, profile);
    expect(books['home-reference-b01'].title).toBe(MOCKUP_BOOKS.find(b => b.id === 'b01')!.title);
  });
});

