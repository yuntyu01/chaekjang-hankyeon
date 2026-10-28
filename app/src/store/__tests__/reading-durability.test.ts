const mockData: Record<string, string> = {};
let mockFailWrites = false;
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    if (mockFailWrites && key === 'reading-state:v2') throw new Error('disk full');
    mockData[key] = value;
  }),
} }));

type ReadingStore = typeof import('../reading-store')['readingStore'];
let store: ReadingStore;
beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  for (const k of Object.keys(mockData)) delete mockData[k];
  mockFailWrites = false;
  store = (require('../reading-store') as typeof import('../reading-store')).readingStore;
  await store.load();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('종료 초안 저장 실패 시 이전 진행 기록이 저장소에 남고 복구된다', async () => {
  store.start('book');
  // 쓰기 직렬화가 완료될 때까지 기다린다.
  await new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));
  mockFailWrites = true;
  const draft = store.finish();
  await new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));
  expect(store.get().error).toContain('disk full');
  expect(JSON.parse(mockData['reading-state:v2']).active.id).toBe(draft?.id);
  mockFailWrites = false;
  jest.resetModules();
  const next = (require('../reading-store') as typeof import('../reading-store')).readingStore;
  await next.load();
  expect(next.get().interrupted?.active.id).toBe(draft?.id);
});

it('종료 초안을 지우지 못하면 다시 시도할 수 있도록 메모리와 저장소에 남긴다', async () => {
  store.start();
  store.finish();
  await new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));
  mockFailWrites = true;
  await expect(store.clearPending()).rejects.toThrow('disk full');
  expect(store.get().pending).not.toBeNull();
  expect(JSON.parse(mockData['reading-state:v2']).pending).not.toBeNull();
  mockFailWrites = false;
  await store.clearPending();
  expect(store.get().pending).toBeNull();
  expect(JSON.parse(mockData['reading-state:v2']).pending).toBeNull();
});

it('이전 버전의 종료 초안과 진행 기록이 같으면 초안만 복원한다', async () => {
  delete mockData['reading-state:v2'];
  const id = 'ss_old';
  mockData['active-reading:v1'] = JSON.stringify({ id, startedAt: '2026-01-01T00:00:00.000Z', accumulatedMs: 0, runningSince: 1, lastBeat: 2 });
  mockData['finished-reading:v1'] = JSON.stringify({ id, startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', durationMs: 60000 });
  jest.resetModules();
  const next = (require('../reading-store') as typeof import('../reading-store')).readingStore;
  await next.load();
  expect(next.get().active).toBeNull();
  expect(next.get().pending?.id).toBe(id);
  expect(JSON.parse(mockData['reading-state:v2']).pending.id).toBe(id);
});
