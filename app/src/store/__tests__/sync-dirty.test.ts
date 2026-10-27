const storage: Record<string, string> = {};
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => storage[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { storage[key] = value; }),
  },
}));

type DirtyStore = typeof import('../sync-dirty');
let dirty: DirtyStore;
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  for (const key of Object.keys(storage)) delete storage[key];
  dirty = require('../sync-dirty') as DirtyStore;
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('업로드가 진행되는 동안 바뀐 배치를 대기 목록에 남긴다', async () => {
  dirty.noteLayoutChange('2026-10-01T00:00:00.000Z');
  const uploaded = dirty.layoutSnapshot();
  dirty.noteLayoutChange('2026-10-02T00:00:00.000Z');
  dirty.clearPushed({}, uploaded);
  expect(dirty.layoutSnapshot()).not.toBeNull();
  jest.runAllTimers();
  await Promise.resolve();
  expect(storage['sync-layout-dirty:v1']).toBe('1');
});

it('올린 뒤 바뀌지 않은 배치는 대기 표시를 지운다', async () => {
  dirty.noteLayoutChange('2026-10-01T00:00:00.000Z');
  const uploaded = dirty.layoutSnapshot();
  dirty.clearPushed({}, uploaded);
  expect(dirty.layoutSnapshot()).toBeNull();
  jest.runAllTimers();
  await Promise.resolve();
  expect(storage['sync-layout-dirty:v1']).toBe('0');
});

it('서재 전체를 다시 올리도록 표시하면 진행 중인 이전 배치 완료로 지워지지 않는다', () => {
  dirty.noteLayoutChange('2026-10-01T00:00:00.000Z');
  const uploaded = dirty.layoutSnapshot();
  dirty.markAllDirty({});
  dirty.clearPushed({}, uploaded);
  expect(dirty.layoutSnapshot()).not.toBeNull();
});

it('재시작 후 저장된 대기 배치도 올리고 지울 수 있다', async () => {
  storage['sync-layout-dirty:v1'] = '1';
  await dirty.loadDirty();
  const uploaded = dirty.layoutSnapshot();
  expect(uploaded).not.toBeNull();
  dirty.clearPushed({}, uploaded);
  expect(dirty.layoutSnapshot()).toBeNull();
});
