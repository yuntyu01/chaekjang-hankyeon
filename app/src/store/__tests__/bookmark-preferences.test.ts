const mockMemory: Record<string, string> = {};
const mockRead = jest.fn(async (key: string) => mockMemory[key] ?? null);
const mockWrite = jest.fn(async (key: string, value: string) => { mockMemory[key] = value; });
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItem: (...args: [string]) => mockRead(...args), setItem: (...args: [string, string]) => mockWrite(...args) } }));

type Store = typeof import('../bookmark-preferences-store')['bookmarkPreferencesStore'];
const freshStore = (): Store => {
  let store!: Store;
  jest.isolateModules(() => { store = require('../bookmark-preferences-store').bookmarkPreferencesStore as Store; });
  return store;
};
const key = 'bookmark-favorites:v1';
beforeEach(() => { Object.keys(mockMemory).forEach((k) => delete mockMemory[k]); mockRead.mockClear(); mockWrite.mockClear(); });

it('restores saved marks before handling early taps and persists across app instances', async () => {
  mockMemory[key] = JSON.stringify(['old']);
  mockMemory['library:v1'] = 'original library';
  const store = freshStore();
  await Promise.all([store.toggle('new'), store.toggle('another'), store.toggle('new')]);
  expect(store.get().ids).toEqual(['old', 'another']);
  const restarted = freshStore();
  await restarted.load();
  expect(restarted.get().ids).toEqual(['old', 'another']);
  expect(mockMemory['library:v1']).toBe('original library');
  expect(mockWrite.mock.calls.every(([storageKey]) => storageKey === key)).toBe(true);
});

it('retains the last saved UI state when a write fails and permits a retry', async () => {
  const store = freshStore();
  await store.toggle('first');
  mockWrite.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.toggle('first')).rejects.toThrow('disk full');
  expect(store.get().ids).toEqual(['first']);
  await store.toggle('second');
  expect(JSON.parse(mockMemory[key])).toEqual(['first', 'second']);
});

it('never replaces existing preferences when their initial read fails', async () => {
  mockMemory[key] = JSON.stringify(['kept']);
  mockRead.mockRejectedValueOnce(new Error('read unavailable'));
  const store = freshStore();
  await expect(store.toggle('new')).rejects.toThrow('read unavailable');
  expect(mockWrite).not.toHaveBeenCalled();
  await store.toggle('new');
  expect(store.get().ids).toEqual(['kept', 'new']);
});
