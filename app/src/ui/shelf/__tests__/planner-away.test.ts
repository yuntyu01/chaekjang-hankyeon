// 다른 줄로 떠난 책이 떠난 줄에 남기는 경로(away): 그 책이 있는 줄이 경로를 다시 짜도 거두지 않고 새 경로로 옮겨 잇는다.
// planner는 UI 스레드 값(makeMutable)과 UI 실행(scheduleOnUI)을 쓰므로, 테스트에서는 값 상자와 바로 실행으로 바꾼다.
// withTiming은 목표 값을 바로 돌려준다(진행은 보지 않고, 어떤 경로·시각이 놓였는지만 본다). 시각은 가짜 타이머로 움직인다.
jest.mock('react-native-reanimated', () => {
  const cubic = (x: number) => x * x * x;
  return {
    makeMutable: <T,>(value: T) => ({ value }),
    withTiming: (to: number) => to,
    Easing: {
      cubic,
      linear: (x: number) => x,
      out: (f: (x: number) => number) => (x: number) => 1 - f(1 - x),
      inOut: (f: (x: number) => number) => (x: number) => (x < 0.5 ? f(2 * x) / 2 : 1 - f(2 * (1 - x)) / 2),
    },
  };
});
jest.mock('react-native-worklets', () => ({
  scheduleOnUI: (f: (...a: unknown[]) => void, ...a: unknown[]) => f(...a),
  scheduleOnRN: (f: (...a: unknown[]) => void, ...a: unknown[]) => f(...a),
}));

import { fromPlaced, type Book3 } from '@/domain/book3';
import { SHELF_THICK } from '@/domain/geometry';
import { moveToShelf, type BookMap, type Result } from '@/domain/layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '@/domain/test-fixtures/interaction-books';
import { bodiesOf, computeShelf, withLeans } from '@/domain/shelf-scene';
import { bookAt, type Track } from '@/domain/transition';
import type { ShelfLayout } from '@/domain/types';
import type { Motion } from '@/ui/shelf/scene';

type Planner = typeof import('@/ui/shelf/planner');
type Scene = typeof import('@/ui/shelf/scene');

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const SPACE = 193.6625;
const P = SPACE + SHELF_THICK; // 줄 간격(판 윗면 사이)
const opts = { reduceMotion: false, space: SPACE, budgetMs: 2000 };
const PATH_DONE = 600; // 다른 줄로 가는 경로(PULL_MS)가 끝난 뒤
const rowsOf = (layout: ShelfLayout, shelfId: string) => computeShelf(layout, books, shelfId).frames.map((f) => fromPlaced(f.box));
// 줄 i에서 줄 j 좌표로(아래 줄일수록 좌표가 위로 간다: 같은 점이 j 좌표에서 (j - i)·P 높다)
const toRow = (b: Book3, from: number, to: number): Book3 => ({ ...b, t: { ...b.t, y: b.t.y + (to - from) * P } });
// 이어 주기(UI가 적용할 때 더한 차이)를 뺀, JS가 짠 경로 그대로의 자세
const planned = (tr: Track, t: number) => bookAt({ ...tr, off: undefined }, t);
const vals = (b: Book3) => [b.t.x, b.t.y, b.t.z, b.roll, b.yaw, b.spin ?? 0, b.pitch ?? 0];
const same = (p: Book3, q: Book3) => expect(vals(p)).toEqual(vals(q).map((v) => expect.closeTo(v, 6)));

// planner는 모듈 상태(남는 경로 기록·미뤄 둔 묶음)를 가지므로 테스트마다 새로 불러온다
let pl: Planner;
let sc: Scene;
beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (t: number) => void) => {
    cb(0);
    return 0;
  };
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  pl = require('@/ui/shelf/planner');
  sc = require('@/ui/shelf/scene');
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function scene(layout: ShelfLayout) {
  const m: Record<string, Motion> = {};
  for (const id of ['shelf-1', 'shelf-2', 'shelf-3']) m[id] = sc.makeMotion(bodiesOf(layout, books, id));
  return m;
}
// 한 책을 줄 from → to로 옮기는 한 묶음(HomeScreen처럼 두 줄을 짜서 한 번에 보낸다). 도착 줄은 그 책이 보이던 자세에서 이어서 들어온다
function move(m: Record<string, Motion>, after: ShelfLayout, id: string, from: number, to: number) {
  const src = `shelf-${from}`;
  const dst = `shelf-${to}`;
  const pose = pl.displayedPoses(m[src])[id];
  pl.planInto(m[src], src, rowsOf(after, src), `${src}:${JSON.stringify(after.placements)}`, opts);
  pl.planInto(m[dst], dst, rowsOf(after, dst), `${dst}:${JSON.stringify(after.placements)}`, { ...opts, arrive: { [id]: toRow(pose, from, to) } });
  pl.flushApply();
  return pose;
}

describe('떠난 줄에 남는 경로(away)', () => {
  it('도착 줄이 경로를 다시 짜도 원래 줄의 남는 경로를 거두지 않고 새 경로로 옮겨 잇는다(그림자가 한 프레임에 사라지지 않는다)', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    sc.presentSV.value = { b18: { 'shelf-3': true } };
    const pose = move(m, after, 'b18', 2, 3);
    const e1 = m['shelf-2'].away.value.b18;
    expect(e1).toBeDefined();
    expect(Number.isFinite(e1.t0)).toBe(true); // 도착 줄 경로와 함께 출발했다
    expect(planned(e1.tr, 0).t.y).toBeCloseTo(pose.t.y, 6); // 떠날 때 자세(원래 줄 좌표)에서 출발
    jest.advanceTimersByTime(120);
    // UI는 JS 어림보다 앞서 있다(짜서 보내는 동안에도 움직이고, 긴 프레임이면 더)
    const m2 = m['shelf-2'];
    const m3 = m['shelf-3'];
    m3.t.value = 0.3;
    m2.awayT.value = e1.t0 + e1.dur * 0.1;
    const uiBook = bookAt(m3.tracks.value.b18, m3.t.value);
    const uiAway = sc.awayAt(e1, m2.awayT.value);
    // 손가락이 도착 줄에서 움직여 도착 줄만 다시 짠다(가로 0.5DU)
    const shown = pl.displayedPoses(m3).b18;
    const next3 = rowsOf(after, 'shelf-3').map((b) => (b.id === 'b18' ? { ...b, t: { ...b.t, x: b.t.x + 0.5 } } : b));
    pl.planInto(m3, 'shelf-3', next3, 'shelf-3:replan', opts);
    pl.flushApply();
    const e2 = m2.away.value.b18;
    expect(e2).toBeDefined(); // 예전에는 여기서 거둬 원래 줄의 그림자가 한 프레임에 사라졌다
    expect(e2).not.toBe(e1);
    const tr2 = m3.tracks.value.b18;
    // JS는 JS 어림 자세에서 짰다. 원래 줄에 남는 경로는 같은 경로를 원래 줄 좌표로(세로만 P 차이)
    expect(planned(tr2, 0).t.y).toBeCloseTo(shown.t.y, 6);
    const s2 = planned(e2.tr, 0);
    const d2 = planned(tr2, 0);
    expect(s2.t.x).toBeCloseTo(d2.t.x, 6);
    expect(s2.t.z).toBeCloseTo(d2.t.z, 6);
    expect(s2.t.y).toBeCloseTo(d2.t.y - P, 6);
    // 화면에서는 바꾸기 직전 자세에서 그대로 이어진다(책도, 원래 줄 그림자 자세도)
    same(bookAt(tr2, 0), uiBook);
    same(bookAt(e2.tr, 0), uiAway);
    expect(tr2.off).toBeDefined();
  });

  it('움직이던 책이 다른 줄로 떠나면 도착 줄 경로와 남는 경로 모두 원래 줄에서 보이던 자세에서 잇는다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    const m2 = m['shelf-2'];
    const m3 = m['shelf-3'];
    // 같은 줄 안에서 앞으로 빼는 중(UI는 JS 어림보다 앞서 있다)
    const pulled = rowsOf(base, 'shelf-2').map((b) => (b.id === 'b18' ? { ...b, t: { ...b.t, z: b.t.z - 12 } } : b));
    pl.planInto(m2, 'shelf-2', pulled, 'shelf-2:pull', opts);
    pl.flushApply();
    m2.t.value = 0.5;
    const ui = bookAt(m2.tracks.value.b18, m2.t.value);
    sc.presentSV.value = { b18: { 'shelf-3': true } };
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    const pose = move(m, after, 'b18', 2, 3);
    expect(Math.abs(pose.t.z - ui.t.z)).toBeGreaterThan(0.5); // JS 어림은 UI와 다르다
    same(bookAt(m3.tracks.value.b18, 0), toRow(ui, 2, 3));
    same(bookAt(m2.away.value.b18.tr, 0), ui);
  });

  it('지나가던 줄에 닿기 전에 또 다른 줄로 가면(1 → 2 → 3) 처음 떠난 줄의 남는 경로를 지금 경로로 옮겨 잇는다(버린 경로를 따라 잔상이 남지 않는다)', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    sc.presentSV.value = { b17: { 'shelf-2': true, 'shelf-3': true } };
    const mid = ok(moveToShelf(base, books, 'b17', 'shelf-2'));
    const pose = move(m, mid, 'b17', 1, 2);
    const a0 = m['shelf-1'].away.value.b17;
    expect(a0).toBeDefined();
    jest.advanceTimersByTime(80); // 아직 1줄 가까이(화면도: 2줄 경로와 1줄에 남는 경로가 막 출발했다)
    m['shelf-2'].t.value = 0;
    m['shelf-1'].awayT.value = a0.t0;
    const end = ok(moveToShelf(mid, books, 'b17', 'shelf-3'));
    move(m, end, 'b17', 2, 3);
    const a1 = m['shelf-1'].away.value.b17;
    expect(a1).toBeDefined();
    expect(a1).not.toBe(a0); // 1 → 2 경로가 아니라
    expect(planned(a1.tr, 0).t.y).toBeCloseTo(planned(m['shelf-3'].tracks.value.b17, 0).t.y - 2 * P, 6); // 지금 경로(3줄)를 두 줄 위 좌표로
    expect(Math.abs(planned(a1.tr, 0).t.y - pose.t.y)).toBeLessThan(P / 2); // 1줄 가까이에서 이어진다
    // 2줄 공간에는 아직 닿지 않았다: 2줄에는 그림자를 남기지 않는다
    expect(m['shelf-2'].away.value.b17).toBeUndefined();
  });

  it('지나가던 줄에 내려앉은 뒤 또 다른 줄로 가면 그 줄에 남는 경로를 두고, 그림자가 없는 처음 줄의 남는 경로는 거둔다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    sc.presentSV.value = { b17: { 'shelf-2': true, 'shelf-3': true } };
    const mid = ok(moveToShelf(base, books, 'b17', 'shelf-2'));
    move(m, mid, 'b17', 1, 2);
    jest.advanceTimersByTime(PATH_DONE);
    const end = ok(moveToShelf(mid, books, 'b17', 'shelf-3'));
    const pose = move(m, end, 'b17', 2, 3);
    const a2 = m['shelf-2'].away.value.b17;
    expect(a2).toBeDefined();
    expect(planned(a2.tr, 0).t.y).toBeCloseTo(pose.t.y, 6); // 2줄 자리에서 출발
    expect(planned(a2.tr, 0).t.y).toBeCloseTo(planned(m['shelf-3'].tracks.value.b17, 0).t.y - P, 6);
    expect(m['shelf-1'].away.value.b17).toBeUndefined();
  });

  it('책이 남는 경로를 둔 줄로 돌아오면 그 줄의 남는 경로를 지우고, 이번에 떠난 줄에 새로 둔다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    sc.presentSV.value = { b18: { 'shelf-2': true, 'shelf-3': true } };
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    move(m, after, 'b18', 2, 3);
    expect(m['shelf-2'].away.value.b18).toBeDefined();
    jest.advanceTimersByTime(PATH_DONE);
    move(m, base, 'b18', 3, 2);
    expect(m['shelf-2'].away.value.b18).toBeUndefined();
    expect(m['shelf-2'].tracks.value.b18).toBeDefined();
    expect(m['shelf-3'].away.value.b18).toBeDefined();
  });

  it('같은 줄을 다시 짜도 다른 책의 남는 경로는 그대로 둔다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    sc.presentSV.value = { b18: { 'shelf-3': true } };
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    move(m, after, 'b18', 2, 3);
    const e1 = m['shelf-2'].away.value.b18;
    // 원래 줄의 다른 책이 움직여(예: 놓을 때 원래 줄 정리) 원래 줄만 다시 짠다
    const next2 = rowsOf(after, 'shelf-2').map((b) => (b.id === 'b10' ? { ...b, t: { ...b.t, z: b.t.z - 3 } } : b));
    pl.planInto(m['shelf-2'], 'shelf-2', next2, 'shelf-2:other', opts);
    pl.flushApply();
    expect(m['shelf-2'].away.value.b18).toBe(e1);
  });
});

describe('미뤄 둔 적용(도착 줄 캔버스를 기다림)', () => {
  it('앞 묶음의 대기 시간 초과 타이머가 새 기다림을 건 묶음을 미리 적용하지 않는다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    const before3 = m['shelf-3'].tracks.value;
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    move(m, after, 'b18', 2, 3); // shelf-3에 올라가기를 기다린다
    expect(m['shelf-3'].tracks.value).toBe(before3);
    jest.advanceTimersByTime(600);
    const back = ok(moveToShelf(after, books, 'b18', 'shelf-1'));
    const before1 = m['shelf-1'].tracks.value;
    move(m, back, 'b18', 3, 1); // 새 기다림(shelf-1)
    jest.advanceTimersByTime(pl.WAIT_MAX + 50 - 600); // 앞 묶음 타이머: 새 묶음은 아직 기다린다
    expect(m['shelf-1'].tracks.value).toBe(before1);
    jest.advanceTimersByTime(600); // 새 묶음 자기 타이머
    expect(m['shelf-1'].tracks.value).not.toBe(before1);
  });
});

describe('남는 경로: 바로 옮기기와 화면 기준 판정', () => {
  it('경로 없이 바로 옮기면(동작 줄이기) 떠난 줄에 남는 경로를 두지 않고, 앞서 남긴 경로도 거둔다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    sc.presentSV.value = { b18: { 'shelf-3': true, 'shelf-1': true } };
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    move(m, after, 'b18', 2, 3);
    expect(m['shelf-2'].away.value.b18).toBeDefined();
    // 같은 책을 동작 줄이기로 첫째 줄로(경로 없음)
    const next = ok(moveToShelf(after, books, 'b18', 'shelf-1'));
    const still = { reduceMotion: true, space: SPACE };
    const pose = pl.displayedPoses(m['shelf-3']).b18;
    pl.planInto(m['shelf-3'], 'shelf-3', rowsOf(next, 'shelf-3'), 'shelf-3:rm', still);
    pl.planInto(m['shelf-1'], 'shelf-1', rowsOf(next, 'shelf-1'), 'shelf-1:rm', { ...still, arrive: { b18: toRow(pose, 3, 1) } });
    pl.flushApply();
    expect(m['shelf-3'].away.value.b18).toBeUndefined();
    expect(m['shelf-2'].away.value.b18).toBeUndefined();
    expect(m['shelf-1'].tracks.value.b18).toBeDefined();
  });

  it('남길지는 화면 자세로 정한다: JS 어림 출발점은 이미 그림자 범위 밖이어도 화면의 책이 아직 그 줄 가까이면 남긴다', () => {
    const base = withLeans(SAMPLE_LAYOUT, books);
    const m = scene(base);
    sc.presentSV.value = { b18: { 'shelf-3': true } };
    const after = ok(moveToShelf(base, books, 'b18', 'shelf-3'));
    move(m, after, 'b18', 2, 3);
    // JS 어림은 경로 끝(이미 3줄), 화면은 아직 출발점(2줄 자리)
    jest.advanceTimersByTime(PATH_DONE);
    m['shelf-3'].t.value = 0;
    const e1 = m['shelf-2'].away.value.b18;
    m['shelf-2'].awayT.value = e1.t0;
    const ui = sc.awayAt(e1, m['shelf-2'].awayT.value);
    const next3 = rowsOf(after, 'shelf-3').map((b) => (b.id === 'b18' ? { ...b, t: { ...b.t, x: b.t.x + 0.5 } } : b));
    pl.planInto(m['shelf-3'], 'shelf-3', next3, 'shelf-3:replan', opts);
    pl.flushApply();
    const e2 = m['shelf-2'].away.value.b18;
    expect(e2).toBeDefined();
    same(bookAt(e2.tr, 0), ui);
    expect(e2.k).toBeGreaterThan(0);
  });
});

