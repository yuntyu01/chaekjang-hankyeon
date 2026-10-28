// 타이머 복구 기준: 앱이 꺼진 정확한 시각은 모른다. 마지막 확인 시각까지만 세고, 복구·재종료·끝내기에서 시간·기록이 겹치지 않는다.
const mem: Record<string, string> = {};
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mem[k] ?? null,
    setItem: async (k: string, v: string) => {
      mem[k] = v;
    },
    removeItem: async (k: string) => {
      delete mem[k];
    },
  },
}));

import { finishActive, recoverOnLoad, type Active } from '../reading-store';

const MIN = 60000;
const base = (p: Partial<Active>): Active => ({ id: 'ss_1', startedAt: new Date(0).toISOString(), accumulatedMs: 0, runningSince: 0, lastBeat: 0, ...p });

describe('강제 종료 복구', () => {
  it('실행 중 종료: 마지막 확인 시각까지만 센다(꺼져 있던 시간은 넣지 않는다)', () => {
    // 10분 누적 + 이번 구간 0분부터 달리다 12분에 마지막 확인, 30분에 다시 켬
    const saved = base({ accumulatedMs: 10 * MIN, runningSince: 0, lastBeat: 12 * MIN });
    const r = recoverOnLoad(saved, 30 * MIN);
    expect(r.interrupted?.countedMs).toBe(22 * MIN);
    expect(r.interrupted?.gapMs).toBe(18 * MIN);
    expect(r.active).toMatchObject({ runningSince: null, accumulatedMs: 22 * MIN, interruptedAt: 12 * MIN });
  });

  it('일시정지 중 종료: 누적 그대로, 복구 창 없음', () => {
    const saved = base({ accumulatedMs: 7 * MIN, runningSince: null, lastBeat: 7 * MIN });
    const r = recoverOnLoad(saved, 99 * MIN);
    expect(r.interrupted).toBeNull();
    expect(r.active?.accumulatedMs).toBe(7 * MIN);
  });

  it('복구 후 고르기 전에 다시 종료: 시간이 다시 더해지지 않고 복구 창을 다시 띄운다', () => {
    const first = recoverOnLoad(base({ accumulatedMs: 10 * MIN, runningSince: 0, lastBeat: 12 * MIN }), 30 * MIN).active!;
    const again = recoverOnLoad(first, 60 * MIN);
    expect(again.active?.accumulatedMs).toBe(22 * MIN);
    expect(again.interrupted?.countedMs).toBe(22 * MIN);
    expect(again.interrupted?.lastBeat).toBe(12 * MIN);
  });

  it('복구 뒤 "그때 끝내기": 끝 시각은 마지막 확인 시각, 시간은 센 만큼', () => {
    const rec = recoverOnLoad(base({ accumulatedMs: 10 * MIN, runningSince: 0, lastBeat: 12 * MIN }), 30 * MIN).active!;
    const d = finishActive(rec, 31 * MIN);
    expect(d.durationMs).toBe(22 * MIN);
    expect(Date.parse(d.endedAt)).toBe(12 * MIN);
    expect(d.id).toBe('ss_1');
  });
});

describe('끝내기·저장이 겹치지 않는다', () => {
  it('두 번 끝내기를 눌러도 초안은 하나, 초안은 재실행해도 남는다', async () => {
    for (const k of Object.keys(mem)) delete mem[k];
    type RS = typeof import('../reading-store')['readingStore'];
    let a: ReturnType<RS['finish']> = null;
    jest.isolateModules(() => {
      const { readingStore } = require('../reading-store') as { readingStore: RS };
      readingStore.start('bk1');
      a = readingStore.finish();
      expect(readingStore.finish()).toBeNull();
    });
    expect(a).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    let again!: RS;
    jest.isolateModules(() => {
      again = (require('../reading-store') as { readingStore: RS }).readingStore;
    });
    await again.load();
    expect(again.get().pending?.id).toBe(a!.id);
    expect(again.get().pendingRestored).toBe(true);
    expect(again.get().active).toBeNull();
    await again.clearPending();
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(mem['reading-state:v2']).pending).toBeNull();
  });
});
