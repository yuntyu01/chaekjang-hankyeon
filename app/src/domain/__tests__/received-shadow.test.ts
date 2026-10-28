// 책 면이 받는 그림자: 가리개가 받는 면보다 빛 쪽에 있을 때만, 경계는 가리개를 따라 움직이고 받는 책 위치와는 무관하다.
import { corners, faceCorners, faceNormal, rot, type Book3 } from '../book3';
import { hull } from '../shadow-shape';
import { shadowOnPlane, travelOf } from '../cast-shadow';
import { SHELF_FRONT } from '../geometry';
import { applySwapTarget, bookXs, findSwapTarget, moveBook, placementOf, setDepth, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../test-fixtures/interaction-books';
import { bodiesOf } from '../shelf-scene';
import type { ShelfLayout } from '../types';
import { receivedShadow3, shiftRecv, type Face3 } from '../received3';
import { physShadow } from '@/ui/lighting';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
// 기하 검사용 비스듬한 빛(왼쪽 위 앞, 예전 앱 광원). 앱 광원은 거의 정면이라 그림자가 책 뒤로 숨는다
const TEST_DIR = { x: -0.42, y: 0.72, z: -0.55 };
const L = travelOf(TEST_DIR);
const LIGHT_Z = -L.z; // 빛이 받는 면(앞면, 법선 -z)으로 들어오는 성분
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const body = (l: ShelfLayout, id: string) => bodiesOf(l, books, 'shelf-2').find((b) => b.id === id)!;

// 받는 책 앞면(책등) 평면 위 그림자의 오른쪽 끝 x
function shadowRight(occ: Book3, recv: Book3) {
  const n = rot(recv.roll, recv.yaw, faceNormal('spine'), recv.spin ?? 0, recv.pitch ?? 0);
  const p0 = corners(recv)[faceCorners('spine')[0]];
  const r = shadowOnPlane(corners(occ), p0, n, L);
  return r.pts.length ? Math.max(...r.pts.map((q) => q.x)) : null;
}

describe('월든 → 채식주의자', () => {
  it('같은 깊이(앞면이 같은 평면)면 그림자가 닿지 않는다', () => {
    expect(shadowRight(body(SAMPLE_LAYOUT, 'b07'), body(SAMPLE_LAYOUT, 'b09'))).toBeNull();
  });

  it('월든을 앞으로 당기면 그림자가 생기고, 끝(오른쪽 경계)은 월든 오른쪽 끝 + 앞으로 나온 거리 × (빛의 x/z)', () => {
    const l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', -SHELF_FRONT));
    const w = body(l, 'b07');
    const right = shadowRight(w, body(l, 'b09'))!;
    let wx = -Infinity;
    for (const c of corners(w)) wx = Math.max(wx, c.x);
    expect(right).toBeCloseTo(wx + SHELF_FRONT * (L.x / L.z), 1);
  });

  it('경계는 월든을 따라 움직이고, 채식주의자를 옮겨도 그대로(책등의 특정 위치에 붙어 있지 않다)', () => {
    const l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', -SHELF_FRONT));
    const base = shadowRight(body(l, 'b07'), body(l, 'b09'))!;
    // 월든을 오른쪽으로 6DU
    const x7 = bookXs(l, books).get('b07')!;
    const w7 = bodiesOf(l, books, 'shelf-2').find((b) => b.id === 'b07')!;
    let cx = 0;
    for (const c of corners(w7)) cx += c.x / 8;
    const moved = applySwapTarget(l, books, 'b07', findSwapTarget(l, books, 'b07', cx + 6));
    if (moved.ok) {
      const dx = bookXs(moved.layout, books).get('b07')! - x7;
      expect(shadowRight(body(moved.layout, 'b07'), body(moved.layout, 'b09'))).toBeCloseTo(base + dx, 1);
    }
    // 채식주의자만 같은 깊이에서 옆으로: 받는 평면이 같으므로 경계 x는 그대로
    const b9 = body(l, 'b09');
    const shifted = { ...b9, t: { ...b9.t, x: b9.t.x + 5 } };
    expect(shadowRight(body(l, 'b07'), shifted)).toBeCloseTo(base, 6);
  });
});

describe('윗면이 받는 그림자(같은 깊이)', () => {
  // 받는 책 윗면(머리) 평면 위 그림자 점 수. 빛이 아래로 가므로 가리개가 받는 윗면보다 높을 때만 생긴다.
  function onHead(occ: Book3, recv: Book3) {
    const n = rot(recv.roll, recv.yaw, faceNormal('head'), recv.spin ?? 0, recv.pitch ?? 0);
    const p0 = corners(recv)[faceCorners('head')[0]];
    return shadowOnPlane(corners(occ), p0, n, L).pts.length;
  }

  it('앞면이 같은 평면이어도 더 높은 월든은 여행의 이유 윗면에 그림자를 드리운다', () => {
    expect(onHead(body(SAMPLE_LAYOUT, 'b07'), body(SAMPLE_LAYOUT, 'b08'))).toBeGreaterThanOrEqual(3);
  });

  it('낮은 여행의 이유는 월든 윗면에 그림자를 드리우지 않는다', () => {
    expect(onHead(body(SAMPLE_LAYOUT, 'b08'), body(SAMPLE_LAYOUT, 'b07'))).toBe(0);
  });
});

describe('채식주의자 → 뒤로 민 월든 표지', () => {
  // 월든을 벽 쪽으로 밀고(앞면 z 83) 채식주의자를 그 왼쪽에 둔다. 빛은 오른쪽·아래·벽 쪽으로 가므로 채식주의자 그림자가 월든 표지에 닿는다.
  const setup = (dz = 0) => {
    let l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', 100));
    l = ok(moveBook(l, books, 'b09', { kind: 'insert', shelfId: 'shelf-2', index: 0, x: bookXs(l, books).get('b07')! + 45 }));
    if (dz) l = ok(setDepth(l, books, 'b09', (placementOf(l, 'b09')!.depth ?? 0) + dz));
    return l;
  };
  // 월든 표지(앞면) 사각형 안에 들어오는 그림자 점이 있는지(면 좌표 u, v ∈ 0~1)
  function coverHit(l: ShelfLayout, occId: string) {
    const w = body(l, 'b07');
    const n = rot(w.roll, w.yaw, faceNormal('cover'), w.spin ?? 0, w.pitch ?? 0);
    const fc = faceCorners('cover').map((i) => corners(w)[i]);
    const r = shadowOnPlane(corners(body(l, occId)), fc[0], n, L);
    const e1 = { x: fc[1].x - fc[0].x, y: fc[1].y - fc[0].y, z: fc[1].z - fc[0].z };
    const e2 = { x: fc[3].x - fc[0].x, y: fc[3].y - fc[0].y, z: fc[3].z - fc[0].z };
    const uv = r.pts.map((q) => {
      const d = { x: q.x - fc[0].x, y: q.y - fc[0].y, z: q.z - fc[0].z };
      return { u: (d.x * e1.x + d.y * e1.y + d.z * e1.z) / (e1.x ** 2 + e1.y ** 2 + e1.z ** 2), v: (d.x * e2.x + d.y * e2.y + d.z * e2.z) / (e2.x ** 2 + e2.y ** 2 + e2.z ** 2) };
    });
    return { n, uv, reaches: uv.length >= 3 && Math.max(...uv.map((q) => q.u)) > 0 && Math.min(...uv.map((q) => q.u)) < 1 && Math.max(...uv.map((q) => q.v)) > 0 && Math.min(...uv.map((q) => q.v)) < 1 };
  }

  it('표지는 앞을 향하고, 채식주의자 그림자는 표지에 닿지만 다른 이웃 그림자는 닿지 않는다', () => {
    const l = setup();
    const hit = coverHit(l, 'b09');
    expect(hit.n.z).toBeCloseTo(-1, 3);
    expect(hit.reaches).toBe(true);
    for (const id of ['b08', 'b10', 'b18']) expect(coverHit(l, id).reaches).toBe(false);
  });

  it('채식주의자를 앞뒤로 조금씩 옮기면 표지 위 그림자 경계가 이어서 움직인다', () => {
    const edges = [-10, -5, 5, 10].map((dz) => Math.max(...coverHit(setup(dz), 'b09').uv.map((q) => q.u)));
    for (let i = 1; i < edges.length; i++) expect(Math.abs(edges[i] - edges[i - 1])).toBeLessThan(0.08);
  });
});


describe('받는 그림자: 가리개 모델 하나(벽·선반과 같은 빛 길이 구간)', () => {
  // 받는 책(가운데)의 책등 면에 왼쪽 앞의 키 큰 책 둘이 모두 그림자를 드리우는 배치
  const box = (id: string, x: number, z: number, T: number, H: number): Book3 => ({ id, dims: { T, H, W: 100 }, roll: 0, yaw: 0, t: { x, y: 0, z } });
  const recv = box('r', 100, 0, 24, 120);
  const near1 = box('o1', 74, -18, 22, 175);
  const near2 = box('o2', 50, -30, 20, 178);
  const faceOf = (r: ReturnType<typeof receivedShadow3>, f: string) => r!.faces.find((q) => q.f === f);
  // 그림자 다각형이 실제로 보이는 넓이: 면 좌표(u·v)의 볼록 껍질을 면 사각형으로 잘라 잰다(그리기도 면 모양으로 자른다)
  const faceHull = (fa: Face3, pts: { x: number; y: number; z: number }[]) => {
    const [o, a1, , a3] = fa.fc;
    const e1 = { x: a1.x - o.x, y: a1.y - o.y, z: a1.z - o.z };
    const e2 = { x: a3.x - o.x, y: a3.y - o.y, z: a3.z - o.z };
    const l1 = Math.hypot(e1.x, e1.y, e1.z);
    const l2 = Math.hypot(e2.x, e2.y, e2.z);
    let poly = hull(pts.map((q) => ({ x: ((q.x - o.x) * e1.x + (q.y - o.y) * e1.y + (q.z - o.z) * e1.z) / l1, y: ((q.x - o.x) * e2.x + (q.y - o.y) * e2.y + (q.z - o.z) * e2.z) / l2 })));
    // 사각형 [0, l1] × [0, l2]로 자르기(Sutherland–Hodgman)
    const clip = (inside: (p: { x: number; y: number }) => boolean, cut: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }) => {
      const out: { x: number; y: number }[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (inside(b)) {
          if (!inside(a)) out.push(cut(a, b));
          out.push(b);
        } else if (inside(a)) out.push(cut(a, b));
      }
      poly = out;
    };
    const atX = (X: number) => (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: X, y: a.y + ((b.y - a.y) * (X - a.x)) / (b.x - a.x) });
    const atY = (Y: number) => (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x + ((b.x - a.x) * (Y - a.y)) / (b.y - a.y), y: Y });
    clip((q) => q.x >= 0, atX(0));
    clip((q) => q.x <= l1, atX(l1));
    clip((q) => q.y >= 0, atY(0));
    clip((q) => q.y <= l2, atY(l2));
    return { poly, l1, l2 };
  };
  const area = (fa: Face3, pts: { x: number; y: number; z: number }[]) => {
    const { poly } = faceHull(fa, pts);
    let A = 0;
    for (let i = 0; i < poly.length; i++) A += poly[i].x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * poly[i].y;
    return Math.abs(A) / 2;
  };
  // 여러 다각형의 합집합 넓이(면 위 0.5DU 칸 가운데 점이 어느 볼록 다각형 안에 드는지 세어)
  const unionArea = (fa: Face3, list: { x: number; y: number; z: number }[][]) => {
    const hulls = list.map((pts) => faceHull(fa, pts));
    if (!hulls.length) return 0;
    const { l1, l2 } = hulls[0];
    const inside = (poly: { x: number; y: number }[], x: number, y: number) => {
      if (poly.length < 3) return false;
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (Math.abs(c) < 1e-12) continue;
        if (sign === 0) sign = Math.sign(c);
        else if (Math.sign(c) !== sign) return false;
      }
      return true;
    };
    const h = 0.5;
    let n = 0;
    for (let x = h / 2; x < l1; x += h) for (let y = h / 2; y < l2; y += h) if (hulls.some((q) => inside(q.poly, x, y))) n++;
    return n * h * h;
  };

  it('구간 그림자는 기울기 추정을 생략해도 같은 투영과 거리 범위를 얻는다', () => {
    const cs = corners(near1);
    const p0 = corners(recv)[faceCorners('spine')[0]];
    const n = faceNormal('spine');
    const full = shadowOnPlane(cs, p0, n, L);
    const fast = shadowOnPlane(cs, p0, n, L, Infinity, 0, false);
    expect(fast.pts.length).toBeGreaterThan(2);
    expect(fast.pts).toEqual(full.pts);
    expect(fast.dist).toBe(full.dist);
    expect(fast.tFar).toBe(full.tFar);
    expect(fast.near).toBeNull();
    expect(fast.far).toBeNull();
  });

  it('선반 줄 사이 좌표를 바꿔도 모든 그림자의 투명도와 흐림을 보존한다', () => {
    const before = receivedShadow3(recv, [near1, { ...near2, alpha: 0.2 }], 3, TEST_DIR)!;
    const shifted = shiftRecv(before, -200)!;
    for (let i = 0; i < before.faces.length; i++) {
      const original = before.faces[i].bands.flat();
      const moved = shifted.faces[i].bands.flat();
      expect(moved.length).toBe(original.length);
      original.forEach((layer, j) => {
        expect(moved[j].w).toBe(layer.w);
        expect(moved[j].sigma).toBe(layer.sigma);
        expect(moved[j].poly).toEqual(layer.poly.map((p) => ({ ...p, y: p.y - 200 })));
      });
    }
  });

  it('가리개 수에 제한이 없다: 가까운 책 둘이 한 면에 모두 남는다', () => {
    const r = receivedShadow3(recv, [near1, near2], 3, TEST_DIR);
    const both = r!.faces.filter((fa) => fa.bands.reduce((n, band) => n + band.length, 0) >= 2);
    expect(both.length).toBeGreaterThan(0);
  });

  it('책 가리개는 벽·선반 그림자와 같은 빛 길이 구간을 쓰고, 다가올 때 그림자 전체가 한 번에 바뀌지 않는다', () => {
    // 받는 책 앞(받는 면 평면 z=0보다 완전히 앞)에 선 책을 0.5DU씩 밀어 넣는다. 구간 k는 가장 가까운 빛 길이가 구간 끝 L_k 안에 들 때만 있다.
    // 빛 방향으로 자른 상자 조각의 그림자는 조각 두께와 상관없이 상자 실루엣이라, 구간이 새로 생기면 그 구간은 한 걸음에 다 나타난다(이미 먼 구간이
    // 같은 자리를 덮고 있어 흐림만 바뀐다). 이어지는 것은 구간을 모두 합친 그림자(합집합 넓이)다
    const L = physShadow.bands;
    const series: { d: number; areas: number[]; union: number }[] = [];
    for (let z = -260; z <= -100.5; z += 0.5) {
      const o = box('o', 92, z, 22, 170);
      const r = receivedShadow3(recv, [o], 3, TEST_DIR);
      const spine = faceOf(r, 'spine');
      const d = -(z + 100) / -LIGHT_Z; // 가리개 뒷면 → 받는 면 평면까지 빛 길이
      series.push({ d, areas: L.map((_, k) => (spine ? spine.bands[k].reduce((acc, layer) => acc + area(spine, layer.poly), 0) : 0)), union: spine ? unionArea(spine, spine.bands.flat().map((layer) => layer.poly)) : 0 });
    }
    // 가까운 구간까지 차례로 나타나고, 구간 끝보다 멀면 없다
    expect(Math.max(...series.map((q) => q.areas[0]))).toBeGreaterThan(0);
    L.forEach((Lk, k) => {
      for (const q of series) if (q.d > Lk + 0.6) expect(q.areas[k]).toBe(0);
    });
    const total = series.map((q) => q.union);
    const fin = Math.max(...total);
    expect(fin).toBeGreaterThan(0);
    for (let i = 1; i < total.length; i++) expect(Math.abs(total[i] - total[i - 1])).toBeLessThan(fin * 0.25);
  });

  it('서랍으로 떨어지며 옅어지는 가리개(alpha)는 드리우는 그림자 몫도 그만큼 옅다', () => {
    const full = receivedShadow3(recv, [near1], 3, TEST_DIR);
    const half = receivedShadow3(recv, [{ ...near1, alpha: 0.4 }], 3, TEST_DIR);
    const fw = faceOf(full, 'spine')!.bands.flat().map((l) => l.w);
    const hw = faceOf(half, 'spine')!.bands.flat().map((l) => l.w);
    expect(fw.some((w) => w > 0)).toBe(true);
    fw.forEach((w, k) => expect(hw[k]).toBeCloseTo(w * 0.4, 9));
  });

  it('그림자 외곽은 순서가 있는 볼록 다각형이라 그릴 때 경로가 교차하지 않는다', () => {
    const r = receivedShadow3(recv, [near1, near2], 3, TEST_DIR)!;
    let checked = 0;
    for (const face of r.faces) for (const layer of face.bands.flat()) {
      const [o, a, , b] = face.fc;
      const u = { x: a.x - o.x, y: a.y - o.y, z: a.z - o.z };
      const v = { x: b.x - o.x, y: b.y - o.y, z: b.z - o.z };
      const poly = layer.poly.map((q) => ({
        x: (q.x - o.x) * u.x + (q.y - o.y) * u.y + (q.z - o.z) * u.z,
        y: (q.x - o.x) * v.x + (q.y - o.y) * v.y + (q.z - o.z) * v.z,
      }));
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
        expect((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)).toBeGreaterThan(0);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('같은 구간의 다른 책 때문에 옅어지는 책의 그림자가 진해지지 않는다', () => {
    const opaque = faceOf(receivedShadow3(recv, [near1], 3, TEST_DIR), 'spine')!;
    const fadingBook = { ...near1, id: 'fading', t: { ...near1.t, y: 10 }, alpha: 0.2 };
    const fading = faceOf(receivedShadow3(recv, [fadingBook], 3, TEST_DIR), 'spine')!;
    const together = faceOf(receivedShadow3(recv, [near1, fadingBook], 3, TEST_DIR), 'spine')!;
    let sharedBands = 0;
    for (let k = 0; k < together.bands.length; k++) {
      expect(together.bands[k]).toEqual([...opaque.bands[k], ...fading.bands[k]]);
      if (opaque.bands[k].length && fading.bands[k].length) sharedBands++;
    }
    expect(sharedBands).toBeGreaterThan(0);
    const hidden = receivedShadow3(recv, [{ ...near1, alpha: 0 }], 3, TEST_DIR)!;
    expect(hidden.faces).toEqual([]);
  });

  it('창빛을 향한 면만 받는다(진하기는 셰이더가 그 면의 빛으로): 빛을 등진 옆면은 받지 않는다', () => {
    const r = receivedShadow3(recv, [near1, near2], 3, TEST_DIR);
    expect(faceOf(r, 'spine')).toBeTruthy();
    // 오른쪽 옆면(법선 +x, 빛은 왼쪽에서): 없다
    for (const f of r!.faces) expect(['cover']).not.toContain(f.f);
  });
});
