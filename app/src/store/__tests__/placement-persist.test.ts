import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
const mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));

// 저장하고 다시 실행하면 같은 배치: 확정(commit)이 저장소에 쓴 것을 앱을 새로 켤 때처럼 다시 불러오면(load)
// 선반·순서·가로 자리·깊이·자세(기대기·표지 책 젖힘·좌우 돌림)·쌓기가 그대로다.
// 예시 세 줄 배치에서 다른 줄로 옮기기, 앞뒤(벽 쪽)·뒤로 젖히기, 표지 책 좌우 돌리기, 누운 더미 옮기기, 기대기를 확정한 뒤 확인한다.
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

import { bookXs, depthRange, detach, findDropTarget, frontRelease, frontSpin, frontStateOf, frontTilt, itemWidth, moveBook, placementOf, setDepth, setTilt, shelfItems, type BookMap, type Result } from '@/domain/layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '@/domain/test-fixtures/interaction-books';
import { computeShelf, withLeans } from '@/domain/shelf-scene';
import type { ShelfLayout } from '@/domain/types';

import { placementStore } from '../placement-store';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const commit = (l: ShelfLayout) => expect(placementStore.commit(l)).toBe(true);
const now = () => placementStore.get().layout;

// 화면에 그리는 3D 자세(선반마다 프레임): 자리·높이·깊이·기울기·돌림·젖힘
function poses(l: ShelfLayout) {
  const out: Record<string, number[]> = {};
  for (const s of l.shelves) {
    for (const f of computeShelf(l, books, s.id).frames) out[f.bookId] = [f.box.x, f.box.y, f.box.z, f.box.angle, f.box.spin ?? 0, f.box.pitch ?? 0];
  }
  return out;
}

describe('저장 후 다시 실행', () => {
  it('예시 세 줄 배치에서 여러 조작을 확정한 뒤 다시 불러오면 같은 배치·자세다', async () => {
    await placementStore.load(books); // 빈 저장소: 첫 실행
    commit(withLeans(SAMPLE_LAYOUT, books));

    // 다른 줄로: 아몬드(둘째 줄) → 첫째 줄 두 책 경계(양쪽 이웃을 나눠 비키는 자리)
    {
      const l = now();
      const item = shelfItems(l, 'shelf-2').find((it) => it.bookIds.includes('b18'))!;
      const t = findDropTarget(detach(l, 'b18', books), books, 'shelf-1', 88.5, 'spine', itemWidth(item, l, books));
      commit(ok(moveBook(l, books, 'b18', t)));
      expect(placementOf(now(), 'b18')?.shelfId).toBe('shelf-1');
    }
    // 앞뒤: 표지 책 월든을 벽 쪽 끝까지 → 윗손잡이로 뒤로 젖혀 벽에 기대고 놓기(앱의 손잡이 확정과 같은 함수)
    {
      commit(ok(setDepth(now(), books, 'b07', depthRange(now(), books, 'b07').hi)));
      const l = now();
      const f = frontStateOf(l, books, 'b07')!;
      const r = frontTilt(l, books, 'b07', f.state, f.qx, 22)!; // 넘어짐 한계(두께/키)보다 크게 젖혀야 벽에 기대 남는다
      const fin = frontRelease(r.layout, books, 'b07', r.state, f.qx);
      expect(fin).not.toBeNull();
      commit(fin!);
    }
    // 표지 책 좌우 돌리기: 우리가 빛의 속도로(셋째 줄)를 오른쪽으로 6DU 옮겨 돌릴 틈을 만든 뒤, 손잡이·돌리기 막대와 같은 함수로
    {
      commit(ok(moveBook(now(), books, 'b16', { kind: 'insert', shelfId: 'shelf-3', index: 3, x: bookXs(now(), books).get('b16')! + 6 })));
      const l = now();
      const f = frontStateOf(l, books, 'b16')!;
      const r = frontSpin(l, books, 'b16', f.state, f.qx, 12)!;
      const fin = frontRelease(r.layout, books, 'b16', r.state, f.qx);
      expect(fin).not.toBeNull();
      commit(fin!);
      expect(Math.abs(frontStateOf(now(), books, 'b16')!.state.spin)).toBeGreaterThan(1);
    }
    // 누운 더미(나미야 + 불편한 편의점)를 받침째 왼쪽으로 조금
    {
      const l = now();
      const x = bookXs(l, books).get('b12')!;
      const r = moveBook(l, books, 'b12', { kind: 'insert', shelfId: 'shelf-3', index: 0, x: x - 8 });
      commit(ok(r));
    }
    // 세운 책 기대기: 채식주의자를 왼쪽으로
    {
      const l = now();
      commit(ok(setTilt(l, books, 'b09', -7)));
      expect(placementOf(now(), 'b09')?.lean?.on).toBeDefined();
    }
    const saved = now();
    const before = poses(saved);
    expect(frontStateOf(saved, books, 'b07')?.state.pitch).toBeGreaterThan(0); // 벽에 기대 있다
    await flush();

    // 앱을 새로 켤 때처럼 저장소에서 다시 불러온다
    await placementStore.load(books);
    const restored = now();
    expect(placementStore.get().notice).toBeNull(); // 서랍으로 밀려난 책 없음
    expect(restored.drawer).toEqual(saved.drawer);
    for (const s of saved.shelves) {
      expect(shelfItems(restored, s.id).map((it) => it.key)).toEqual(shelfItems(saved, s.id).map((it) => it.key));
    }
    const after = poses(restored);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const id of Object.keys(before)) {
      before[id].forEach((v, i) => expect(after[id][i]).toBeCloseTo(v, 2));
      const a = placementOf(saved, id)!;
      const b = placementOf(restored, id)!;
      expect([b.pose, b.stackId, b.stackOrder, b.tilt, b.lean?.on]).toEqual([a.pose, a.stackId, a.stackOrder, a.tilt, a.lean?.on]);
    }
  });
});
