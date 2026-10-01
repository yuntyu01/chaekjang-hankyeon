// 전환 경로: 모든 진행률 t에서(접촉 근처는 촘촘히) 겹치지 않고, 끝은 정확히 목표, 바닥 아래로 내려가지 않는다.
import { corners, facing, fromPlaced, gap, lowest, xRange, type Book3 } from '../book3';
import { boxSize } from '../box';
import { CAMERA, SHELF_FRONT } from '../geometry';
import { moveBook, moveToDrawer, placementOf, rotateStep, setPose, setTilt, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import { awayTrack, bookAt, firstOverlap, planTransition, PULL_LIFT, shiftTrack } from '../transition';
import type { Book, BookPlacement, ShelfLayout, Tilt } from '../types';

const all: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
// 경로 검사 시간 제한(앱 기본 40ms)은 기기 성능용이라, 시험에서는 넉넉히 줘서 느린 기계에서도 같은 경로를 고르게 한다
const NO_RUSH = { budgetMs: 60_000 };

function planOf(prev: ShelfLayout, nextRaw: ShelfLayout, books: BookMap, shelf: string, from?: Book3[]) {
  const next = withLeans(nextRaw, books);
  const a = from ?? bodiesOf(prev, books, shelf);
  const b = bodiesOf(next, books, shelf);
  return { plan: planTransition(a, b, PLANK_BOUNDS, NO_RUSH), next, a, b };
}

function expectClean(prev: ShelfLayout, nextRaw: ShelfLayout, books: BookMap, shelf: string, from?: Book3[]) {
  const r = planOf(prev, nextRaw, books, shelf, from);
  expect(r.plan).not.toBeNull(); // 막혀도 앞으로 빼서 옮기는 경로로 대신한다(null 없음)
  expect(firstOverlap(r.plan.tracks, PLANK_BOUNDS)).toBeNull();
  expectEnds(r);
  return r;
}

// 시작은 지금 보이는 자세, 끝은 정확히 목표, 도중에 바닥 아래로 내려가지 않는다
function expectEnds({ plan: p, a, b }: ReturnType<typeof planOf>) {
  for (const tr of p.tracks) {
    const end = bookAt(tr, 1);
    const target = b.find((x) => x.id === tr.id)!;
    expect(end.t.x).toBeCloseTo(target.t.x, 4);
    expect(end.t.y).toBeCloseTo(target.t.y, 4);
    expect(end.t.z).toBeCloseTo(target.t.z, 4);
    expect(end.roll).toBeCloseTo(target.roll, 4);
    expect(end.yaw).toBeCloseTo(target.yaw, 4);
    const origin = a.find((x) => x.id === tr.id);
    if (origin) {
      const start = bookAt(tr, 0);
      expect(start.t.x).toBeCloseTo(origin.t.x, 4);
      expect(start.roll).toBeCloseTo(origin.roll, 4);
      expect(start.yaw).toBeCloseTo(origin.yaw, 4);
    }
    for (let k = 0; k <= 96; k++) expect(lowest(bookAt(tr, k / 96))).toBeGreaterThan(-0.05);
  }
}

const book = (id: string, height: number, thickness: number, width = 120): Book => ({
  id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7,
  art: { motif: 'leaf' }, dims: { height, thickness, coverWidth: width },
});
const place = (bookId: string, order: number, pos: number, tilt: Tilt = 0, pose: BookPlacement['pose'] = 'spine'): BookPlacement => ({ bookId, shelfId: 's', order, pose, tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });

// 여유 있는 선반: 예시에서 몇 권을 서랍으로
const roomy = () => {
  let l = withLeans(SAMPLE_LAYOUT, all);
  for (const id of ['b17', 'b06', 'b18', 'b11', 'b14', 'b15']) l = ok(moveToDrawer(l, id, all));
  return withLeans(l, all);
};

// 얇은 책·좁은 틈·선반 끝(C는 오른쪽 끝에 붙어 있다)
const thin: BookMap = { A: book('A', 180, 22), B: book('B', 170, 24, 110), C: book('C', 160, 60) };
const thinBase = () => withLeans(layoutOf(place('A', 0, 0), place('B', 1, 23), place('C', 2, 366 - 60)), thin);

// 제자리 후보가 모두 막혀 앞으로 빼서 옮기는 경로(pull)로 대신할 때 그 경로가 깨끗하지 않은 경우(transition.ts pullPlan·pullSegs).
// 아래 '알려진 문제' 시험이 따로 붙잡고 있다. 고치면 거기서 .failing을 떼고 여기서도 뺀다.
const KNOWN_PULL_BUGS = ['b03>front', 'b12>spine'];

describe('3D 자세', () => {
  it('정지 자세의 상자 = 배치 상자, 보이는 면: 세움(책등·앞표지 옆·머리), 눕힘(책등·앞표지 위·꼬리 끝), 표지(앞표지·책배·머리)', () => {
    const b = all.b01;
    for (const pose of ['spine', 'front', 'horizontal'] as const) {
      const size = boxSize(b, pose);
      const body = fromPlaced({ bookId: 'b01', pose, size, x: 10, y: 0, z: 0, angle: 0 });
      const c = corners(body);
      expect(Math.min(...c.map((q) => q.x))).toBeCloseTo(10, 6);
      expect(Math.max(...c.map((q) => q.x))).toBeCloseTo(10 + size.w, 6);
      expect(Math.min(...c.map((q) => q.y))).toBeCloseTo(0, 6);
      expect(Math.max(...c.map((q) => q.y))).toBeCloseTo(size.h, 6);
      expect(Math.max(...c.map((q) => q.z))).toBeCloseTo(size.d, 6);
      const seen = (['spine', 'cover', 'back', 'head', 'tail', 'fore'] as const).filter((f) => facing(CAMERA, body, f) > 0).sort();
      if (pose === 'spine') expect(seen).toEqual(['cover', 'head', 'spine']);
      if (pose === 'horizontal') expect(seen).toEqual(['cover', 'spine', 'tail']);
      if (pose === 'front') expect(seen).toEqual(['cover', 'fore', 'head']);
    }
  });

  it('기댄 책: 발(축 모서리)이 제자리', () => {
    const size = boxSize(all.b01, 'spine');
    for (const angle of [-9, 12]) {
      const body = fromPlaced({ bookId: 'b01', pose: 'spine', size, x: 100, y: 0, z: 0, angle });
      const foot = { x: angle > 0 ? 100 + size.w : 100, y: 0 };
      expect(corners(body).some((q) => Math.abs(q.x - foot.x) < 1e-6 && Math.abs(q.y - foot.y) < 1e-6)).toBe(true);
      expect(lowest(body)).toBeCloseTo(0, 6);
    }
  });

  it('예시 18권 정지 배치: 서로 파고들지 않는다(3D)', () => {
    const l = withLeans(SAMPLE_LAYOUT, all);
    for (const s of l.shelves) {
      const bs = bodiesOf(l, all, s.id);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(gap(bs[i], bs[j])).toBeGreaterThan(-0.25);
    }
  });
});

describe('기울이기 경로', () => {
  const small: BookMap = { A: book('A', 180, 40), B: book('B', 150, 28), C: book('C', 120, 34) };
  it('기울이고 되돌려도 도중에 겹치지 않는다', () => {
    const base = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40), place('C', 2, 68)), small);
    for (const [id, tilt] of [['C', -7], ['B', -7], ['A', 7], ['B', 7]] as const) {
      const r = setTilt(base, small, id, tilt);
      if (r.ok) expectClean(base, r.layout, small, 's');
    }
    const leaning = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40 + 16, -7)), small);
    expectClean(leaning, ok(setTilt(leaning, small, 'B', 0)), small, 's');
  });

  it('예시 18권: 모든 세운 책을 기울였다 되돌려도 경로가 깨끗하다', () => {
    const base = withLeans(SAMPLE_LAYOUT, all);
    for (const p of base.placements.filter((q) => q.pose === 'spine')) {
      for (const tilt of [-7, 7, 0] as const) {
        if (p.tilt === tilt) continue;
        const r = setTilt(base, all, p.bookId, tilt);
        if (r.ok) expectClean(base, r.layout, all, p.shelfId);
      }
    }
  });
});

describe('자세 변경 경로', () => {
  it('책등 → 표지: 세로축으로 돌며(앞표지가 점점 앞으로) 겹치지 않고, 되돌리기도 된다', () => {
    const base = roomy();
    const { plan, next } = expectClean(base, ok(setPose(base, all, 'b02', 'front')), all, 'shelf-1');
    const tr = plan.tracks.find((t) => t.id === 'b02')!;
    let last = -1;
    for (let k = 0; k <= 20; k++) {
      const f = facing(CAMERA, bookAt(tr, k / 20), 'cover');
      expect(f).toBeGreaterThanOrEqual(last - 1e-6); // 앞표지는 점점 앞을 향한다(엉뚱한 면이 앞으로 오지 않음)
      expect(facing(CAMERA, bookAt(tr, k / 20), 'back')).toBeLessThanOrEqual(1e-6); // 뒤표지는 한 번도 보이지 않는다
      last = f;
    }
    expectClean(next, ok(setPose(next, all, 'b02', 'spine')), all, 'shelf-1');
  });

  it('세움 → 눕힘(좌우 돌리기 끝 단계)과 다시 세우기: 뒤표지가 받침', () => {
    const base = roomy();
    const leaned = withLeans(ok(rotateStep(base, all, 'b09', -1)), all);
    expectClean(base, leaned, all, 'shelf-2');
    const lying = ok(rotateStep(leaned, all, 'b09', -1));
    expect(placementOf(lying, 'b09')?.pose).toBe('horizontal');
    const { next, plan } = expectClean(leaned, lying, all, 'shelf-2');
    const tr = plan.tracks.find((t) => t.id === 'b09')!;
    for (let k = 0; k <= 20; k++) expect(facing(CAMERA, bookAt(tr, k / 20), 'back')).toBeLessThanOrEqual(1e-6);
    expectClean(next, ok(rotateStep(next, all, 'b09', 1)), all, 'shelf-2');
  });

  it('얇은 책·좁은 틈 책도 표지로 돌 수 있다(선반 끝 책은 아래 알려진 문제)', () => {
    const base = thinBase();
    let tried = 0;
    for (const id of ['A', 'B']) {
      const r = setPose(base, thin, id, 'front');
      if (!r.ok) continue;
      tried++;
      expectClean(base, r.layout, thin, 's');
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('쌓인 더미 위 책을 세워도 아래 책을 파고들지 않는다', () => {
    const base = roomy();
    const r = setPose(base, all, 'b13', 'spine');
    expect(r.ok).toBe(true);
    expectClean(base, ok(r), all, 'shelf-3');
  });

  it('도중에 다시 조작하면 지금 보이는 모습에서 이어진다(시작점·목표로 튀지 않음)', () => {
    const base = roomy();
    const a = bodiesOf(base, all, 'shelf-1');
    const mid = withLeans(ok(setPose(base, all, 'b02', 'front')), all);
    const p1 = planTransition(a, bodiesOf(mid, all, 'shelf-1'), PLANK_BOUNDS, NO_RUSH);
    for (const at of [0.3, 0.5, 0.8]) {
      const now = p1.tracks.map((tr) => bookAt(tr, at)); // 도는 도중에 되돌리기
      const { plan } = expectClean(mid, ok(setPose(mid, all, 'b02', 'spine')), all, 'shelf-1', now);
      for (const tr of plan.tracks) {
        const s0 = bookAt(tr, 0);
        const was = now.find((b) => b.id === tr.id)!;
        expect(s0.t.x).toBeCloseTo(was.t.x, 4);
        expect(s0.t.z).toBeCloseTo(was.t.z, 4);
        expect(s0.yaw).toBeCloseTo(was.yaw, 4);
        expect(s0.roll).toBeCloseTo(was.roll, 4);
      }
    }
  });

  it('예시 18권: 여유 있는 선반에서 모든 책의 자세 변경 경로가 깨끗하다', () => {
    const base = roomy();
    let count = 0;
    for (const p of base.placements.filter((q) => q.shelfId !== 'drawer')) {
      for (const pose of ['spine', 'front', 'horizontal'] as const) {
        if (p.pose === pose || KNOWN_PULL_BUGS.includes(`${p.bookId}>${pose}`)) continue;
        const r = setPose(base, all, p.bookId, pose);
        if (!r.ok) continue;
        count++;
        expectClean(base, r.layout, all, p.shelfId);
      }
    }
    expect(count).toBeGreaterThan(10);
  });
});

describe('경로 계획은 늘 결과를 준다(null 없음)', () => {
  const trio: BookMap = { A: book('A', 180, 30), B: book('B', 170, 28), C: book('C', 160, 26) };
  const start = () => withLeans(layoutOf(place('A', 0, 100), place('B', 1, 130), place('C', 2, 158)), trio);

  it('바뀐 것이 없으면 멈춘 경로(still): 멈춘 책은 지금 보이던 자세 객체를 그대로 돌려준다', () => {
    const a = bodiesOf(start(), trio, 's');
    const plan = planTransition(a, a.map((b) => ({ ...b, t: { ...b.t } })), PLANK_BOUNDS);
    expect(plan.strategy).toBe('still');
    for (const tr of plan.tracks) {
      expect(tr.moving).toBe(false);
      const was = a.find((b) => b.id === tr.id)!;
      for (const t of [0, 0.5, 1]) expect(bookAt(tr, t)).toBe(was); // 같은 객체: 이 책을 읽는 화면 계산이 다시 돌지 않는다
    }
  });

  it('제자리 경로가 모두 막혀도(다른 책을 건너가야) 앞으로 빼서 옮긴다: 옆으로 가는 동안은 판 앞 끝보다 앞, 들어 올린 채', () => {
    const l0 = start();
    // A를 B·C 너머 오른쪽 빈자리로: 제자리 경로는 모두 B·C를 뚫는다
    const l1 = withLeans(ok(moveBook(l0, trio, 'A', { kind: 'insert', shelfId: 's', index: 2, x: 184 })), trio);
    const a = bodiesOf(l0, trio, 's');
    const b = bodiesOf(l1, trio, 's');
    const plan = planTransition(a, b, PLANK_BOUNDS, NO_RUSH);
    expect(plan.strategy).toBe('pull');
    expect(firstOverlap(plan.tracks, PLANK_BOUNDS)).toBeNull();
    const tr = plan.tracks.find((t) => t.id === 'A')!;
    const x0 = xRange(a.find((x) => x.id === 'A')!).lo;
    const x1 = xRange(b.find((x) => x.id === 'A')!).lo;
    expect(x1 - x0).toBeGreaterThan(50);
    let sideways = 0;
    for (let k = 0; k <= 200; k++) {
      const body = bookAt(tr, k / 200);
      const x = xRange(body).lo;
      if (Math.abs(x - x0) < 1e-6 || Math.abs(x - x1) < 1e-6) continue;
      sideways++;
      expect(Math.max(...corners(body).map((c) => c.z))).toBeLessThanOrEqual(-SHELF_FRONT);
      expect(lowest(body)).toBeGreaterThanOrEqual(PULL_LIFT - 1e-9);
    }
    expect(sideways).toBeGreaterThan(10);
    const end = bookAt(tr, 1);
    const target = b.find((x) => x.id === 'A')!;
    expect(end.t.x).toBeCloseTo(target.t.x, 6);
    expect(end.t.y).toBeCloseTo(target.t.y, 6);
    expect(end.t.z).toBeCloseTo(target.t.z, 6);
    // 자리를 지키는 책은 지금 자세 객체 그대로
    for (const id of ['B', 'C']) expect(bookAt(plan.tracks.find((t) => t.id === id)!, 0.5)).toBe(a.find((x) => x.id === id));
  });

  it('다른 줄에서 들어오는 책: 그 줄에서 보이던 자세(이 줄 좌표)에서 이어 앞으로 빼서 들어온다', () => {
    const books: BookMap = { ...trio, D: book('D', 150, 24) };
    const next = bodiesOf(withLeans(layoutOf(place('A', 0, 100), place('B', 1, 130), place('C', 2, 158), place('D', 3, 250)), books), books, 's');
    const a = bodiesOf(start(), trio, 's');
    const target = next.find((x) => x.id === 'D')!;
    const from: Book3 = { ...target, t: { ...target.t, x: target.t.x - 120, y: target.t.y + 190 } }; // 윗줄 왼쪽에서
    const plan = planTransition(a, next, PLANK_BOUNDS, { ...NO_RUSH, arrive: { D: from } });
    const tr = plan.tracks.find((t) => t.id === 'D')!;
    expect(tr.moving).toBe(true);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(bookAt(tr, 0).t[k]).toBeCloseTo(from.t[k], 6);
      expect(bookAt(tr, 1).t[k]).toBeCloseTo(target.t[k], 6);
    }
    for (let k = 0; k <= 100; k++) {
      const body = bookAt(tr, k / 100);
      const x = xRange(body).lo;
      if (Math.abs(x - xRange(from).lo) < 1e-6 || Math.abs(x - xRange(target).lo) < 1e-6) continue;
      expect(Math.max(...corners(body).map((c) => c.z))).toBeLessThanOrEqual(-SHELF_FRONT); // 옆·아래로 가는 동안은 판 앞
    }
    // 떠난 줄에 남는 그림자 경로: 같은 경로를 떠난 줄 좌표로(세로만 다르다). 출발은 떠난 줄에서 보이던 자세 그대로.
    const away = shiftTrack(tr, -190);
    for (let k = 0; k <= 20; k++) {
      const p = bookAt(tr, k / 20);
      const q = bookAt(away, k / 20);
      expect([q.t.x, q.t.y + 190, q.t.z, q.roll, q.yaw]).toEqual([p.t.x, p.t.y, p.t.z, p.roll, p.yaw].map((v) => expect.closeTo(v, 9)));
    }
    expect(bookAt(away, 0).t.y).toBeCloseTo(target.t.y, 6);
    // 떠난 줄에 남는 그림자 경로는 떠날 때 자세에서 출발하고, 그림자가 사라지는 첫 진행(k)까지만 쓴다
    const src: Book3 = { ...from, t: { ...from.t, y: from.t.y - 190 } };
    const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    // 앱의 판정(줄 공간 위·아래 밖으로 40DU 넘게)과 같게: 줄 공간 높이 190DU
    const gone = (b: Book3) => {
      const ys = corners(b).map((c) => c.y);
      return Math.min(...ys) < -41 || Math.max(...ys) > 190 + 41;
    };
    const aw = awayTrack(tr, src, ease, gone)!;
    expect(bookAt(aw.track, 0).t).toEqual({ x: expect.closeTo(src.t.x, 9), y: expect.closeTo(src.t.y, 9), z: expect.closeTo(src.t.z, 9) });
    expect(aw.k).toBeGreaterThan(0);
    expect(aw.k).toBeLessThan(1);
    expect(gone(bookAt(aw.track, ease(aw.k)))).toBe(true);
    expect(gone(bookAt(aw.track, ease(aw.k - 1 / 48)))).toBe(false);
    // 다른 책(가로 자리가 다른 출발)이면 남는 경로가 없다
    expect(awayTrack(tr, { ...src, t: { ...src.t, x: src.t.x + 5 } }, ease, gone)).toBeNull();
  });
});

describe('앞으로 빼서 옮기는 대체 경로: 막힌 경우에도 부딪히지 않는다', () => {
  // 제자리 후보가 모두 벽·판 끝·옆 책에 막혀(벽 뚫기·허공 검사) pull로 대신하는 경우들. 준비가 깨지면 모음 단계에서 바로 드러나게 여기서 계산한다.
  const endC = (() => {
    const base = thinBase();
    return planOf(base, ok(setPose(base, thin, 'C', 'front')), thin, 's');
  })();
  const b03 = (() => {
    const base = roomy();
    return planOf(base, ok(setPose(base, all, 'b03', 'front')), all, 'shelf-1');
  })();
  const b12 = (() => {
    const base = roomy();
    return planOf(base, ok(setPose(base, all, 'b12', 'spine')), all, 'shelf-3');
  })();

  it('막혀도 대신 경로가 있다(pull): 시작·끝 자세가 맞고 바닥 아래로 내려가지 않는다', () => {
    for (const r of [endC, b03, b12]) {
      expect(r.plan.strategy).toBe('pull');
      expectEnds(r);
    }
  });

  // 선반 끝 책 C(오른쪽 끝 306~366)를 표지로: 빼낸 채 가운데 정렬로 돌며 가로 폭이 커져 판 오른쪽 끝(371.7)보다 나가지만,
  // 판 앞 끝보다 앞(허공)이라 판 끝 범위와 상관없다.
  it('선반 끝 책(C)도 표지로 돌 수 있다: 빼낸 채 도는 동안은 판 끝 검사에 걸리지 않는다', () => {
    expect(firstOverlap(endC.plan.tracks, PLANK_BOUNDS)).toBeNull();
  });

  // b03을 표지로(벽 쪽 z 98~121): 목표 자리 앞(z 0~31)에 표지 책 b04가 가로로 겹쳐 선다. b04를 먼저 잠깐 빼 두고(먼 차선),
  // b03이 들어간 뒤 b04가 돌아온다.
  it('b03 → 표지: 목표 자리 앞에 선 책을 뚫지 않고 들어간다', () => {
    expect(firstOverlap(b03.plan.tracks, PLANK_BOUNDS)).toBeNull();
  });

  // 쌓인 더미 맨 아래 책(b12)을 세울 때: 위에 얹힌 b13을 먼저 빼고 나서 b12를 든다.
  it('b12 → 세움(쌓인 더미 맨 아래): 위 책이 얹힌 채 들어 올리지 않는다', () => {
    expect(firstOverlap(b12.plan.tracks, PLANK_BOUNDS)).toBeNull();
  });
});
