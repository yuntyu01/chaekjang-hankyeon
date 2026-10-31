// '아껴둔' 갈피(2026-11): 갈피 기록의 savedAt으로 저장(백업·동기화 포함). 예전 기기 키 목록은 한 번 옮기고 옛 키는 그대로 둔다.
const mockMemory: Record<string, string> = {};
const mockRead = jest.fn(async (key: string) => mockMemory[key] ?? null);
const mockWrite = jest.fn(async (key: string, value: string) => { mockMemory[key] = value; });
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItem: (...args: [string]) => mockRead(...args), setItem: (...args: [string, string]) => mockWrite(...args) } }));

type Mark = { id: string; savedAt?: string };
const mockLib: { bookmarks: Record<string, Mark> } = { bookmarks: {} };
const mockFlush = jest.fn(async () => {});
const mockListeners = new Set<() => void>();
jest.mock('../library-store', () => ({
  libraryStore: {
    get: () => ({ lib: mockLib }),
    subscribe: (l: () => void) => { mockListeners.add(l); return () => mockListeners.delete(l); },
    updateBookmark: (id: string, patch: Partial<Mark>) => {
      mockLib.bookmarks = { ...mockLib.bookmarks, [id]: { ...mockLib.bookmarks[id], ...patch } };
      mockListeners.forEach((l) => l());
    },
    flushPending: () => mockFlush(),
  },
}));

type Store = typeof import('../bookmark-preferences-store')['bookmarkPreferencesStore'];
const freshStore = (): Store => {
  let store!: Store;
  jest.isolateModules(() => { store = require('../bookmark-preferences-store').bookmarkPreferencesStore as Store; });
  return store;
};
const key = 'bookmark-favorites:v1';
beforeEach(() => {
  Object.keys(mockMemory).forEach((k) => delete mockMemory[k]);
  mockRead.mockClear();
  mockWrite.mockClear();
  mockFlush.mockReset();
  mockFlush.mockImplementation(async () => {});
  mockListeners.clear();
  mockLib.bookmarks = { old: { id: 'old' }, new: { id: 'new' }, another: { id: 'another' }, first: { id: 'first' }, second: { id: 'second' } };
});

it('예전 기기 목록을 갈피 기록으로 옮기고(옛 키는 그대로), 먼저 누른 것도 순서대로 처리한다', async () => {
  mockMemory[key] = JSON.stringify(['old', 'gone']);
  const store = freshStore();
  await Promise.all([store.toggle('new'), store.toggle('another'), store.toggle('new')]);
  expect(store.get().ids).toEqual(['old', 'another']);
  expect(mockLib.bookmarks.old.savedAt).toBeDefined();
  expect(mockLib.bookmarks.gone).toBeUndefined();
  expect(mockMemory[key]).toBe(JSON.stringify(['old', 'gone']));
  // 다시 켜도 기록에서 읽는다(옛 목록을 다시 옮기지 않는다)
  const restarted = freshStore();
  await restarted.load();
  expect(restarted.get().ids).toEqual(['old', 'another']);
});

it('저장에 실패하면 알리고, 다시 누르면 이어서 된다', async () => {
  const store = freshStore();
  await store.toggle('first');
  mockFlush.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.toggle('second')).rejects.toThrow('disk full');
  await store.toggle('first');
  expect(mockLib.bookmarks.first.savedAt).toBeUndefined();
  expect(store.get().ids).toEqual(['second']);
});

it('예전 목록을 읽지 못하면 아무것도 바꾸지 않고 다음에 다시 옮긴다', async () => {
  mockMemory[key] = JSON.stringify(['old']);
  mockRead.mockRejectedValueOnce(new Error('read unavailable'));
  const store = freshStore();
  await expect(store.toggle('new')).rejects.toThrow('read unavailable');
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockLib.bookmarks.new.savedAt).toBeUndefined();
  await store.toggle('new');
  expect(store.get().ids).toEqual(['old', 'new']);
});
