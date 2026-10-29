// 책 → 벽·선반 윗면 그림자(한 모델, cast-shadow bookCast): 두 면이 만나는 선에서 같은 빛줄기의 진하기가 같고,
// 책을 앞뒤로 조금씩 옮기는 동안 벽 그림자 진하기가 한 번에 튀지 않는다(흐림은 빼고 층 모양·진하기만 본다).
import type { Book3, Vec3 } from '../book3';
import { hull } from '../box';
import { bookCast, DROP_K, entryY, frontCast, travelOf, wallParts } from '../cast-shadow';
import { corners } from '../book3';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK } from '../geometry';
import { light, physShadow } from '@/scene-config/lighting';

const D = travelOf(light.dir);
const W = 97.6; // 128mm 판형 책의 깊이(DU)
const standing = (z: number): Book3 => ({ id: 'a', dims: { T: 22, H: 143, W }, roll: 0, yaw: 0, t: { x: 100, y: 0, z } });

type P2 = { x: number; y: number };
function inside(p: P2, poly: P2[]) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

// 한 점이 가려진 몫: 그 점을 덮는 구간들의 합집합(구간마다 얇은 가리개 몫 w). 받는 면 평면 좌표는 벽 (x, y), 선반 윗면 (x, z)
function blocked(b: Book3, P: Vec3, wall: boolean) {
  let keep = 1;
  physShadow.bands.forEach((_, k) => {
    const c = bookCast(b, 1, k, wall);
    if (!c) return;
    const poly = hull(c.pts.map((q) => (wall ? { x: q.x, y: q.y } : { x: q.x, y: q.z })));
    if (inside(wall ? { x: P.x, y: P.y } : { x: P.x, y: P.z }, poly)) keep *= 1 - c.w;
  });
  return 1 - keep;
}

// 그 점으로 가는 빛줄기를 가리는 빛 길이 구간들(받는 면과 상관없이 같은 빛줄기는 같은 가리개에 막힌다)
function blockedBands(b: Book3, P: Vec3, wall: boolean) {
  const out: number[] = [];
  physShadow.bands.forEach((_, k) => {
    const c = bookCast(b, 1, k, wall);
    if (!c) return;
    const poly = hull(c.pts.map((q) => (wall ? { x: q.x, y: q.y } : { x: q.x, y: q.z })));
    if (inside(wall ? { x: P.x, y: P.y } : { x: P.x, y: P.z }, poly)) out.push(k);
  });
  return out;
}

describe('책 → 벽·선반 윗면 그림자', () => {
  it('벽과 선반 윗면이 만나는 선에서 같은 빛줄기는 같은 구간의 가리개에 막힌다(책을 앞으로 뺀 자리부터 벽에 붙인 자리까지)', () => {
    // 앞면 z: 앞으로 뺌(-20), 기준선(0), 뒤로(10, 20)
    for (const z of [-20, 0, 10, 20]) {
      const b = standing(z);
      let shaded = 0;
      for (let x = 90; x <= 330; x += 1) {
        const P = { x, y: 0, z: SHELF_DEPTH };
        const w = blockedBands(b, P, true);
        // 경계선 위 점은 두 면 모두에서 같은 구간에 막힌다
        const f = blockedBands(b, P, false);
        expect(f).toEqual(w);
        if (w.length) shaded++;
      }
      expect(shaded).toBeGreaterThan(10);
    }
  });

  it('책을 벽 쪽으로 0.5DU씩 밀 때 책 뒤 벽이 가려진 몫이 한 번에 튀지 않고, 벽에 붙이면 다 가린다', () => {
    let prev = -1;
    let maxStep = 0;
    for (let z = -30; z <= SHELF_DEPTH - W; z += 0.5) {
      const b = standing(z);
      // 뒷면 가운데에서 빛 방향으로 벽에 닿는 점
      const back = { x: 111, y: 70, z: z + W };
      const t = (SHELF_DEPTH - back.z) / D.z;
      const P = { x: back.x + D.x * t, y: back.y + D.y * t, z: SHELF_DEPTH };
      const d = blocked(b, P, true);
      if (prev >= 0) maxStep = Math.max(maxStep, Math.abs(d - prev));
      prev = d;
    }
    expect(maxStep).toBeLessThan(0.05);
    expect(prev).toBeCloseTo(1, 6);
  });
});

describe('얇은 가리개 몫은 빛에서 본 폭으로', () => {
  // 표지가 앞으로 보이는 책(yaw 90): 두께가 빛 방향(깊이)이라 빛에서는 표지 폭 × 키로 넓게 보인다. 선반 앞쪽(벽에서 멀다)에 있어도
  // 반그림자보다 넓어 벽 그림자는 끝까지 진하다(예전에는 상자의 짧은 두 변을 써 0.47까지 옅었다)
  const front = (z: number): Book3 => ({ id: 'f', dims: { T: 35, H: 160, W: 112 }, roll: 0, yaw: 90, t: { x: 100, y: 0, z } });
  it('표지 책은 앞쪽에서도 벽 그림자 몫이 1이다', () => {
    for (const z of [-53, -20, 17]) {
      const ws = physShadow.bands.map((_, k) => bookCast(front(z), 1, k, true)?.w).filter((w): w is number => w !== undefined);
      expect(ws.length).toBeGreaterThan(0);
      for (const w of ws) expect(w).toBeCloseTo(1, 6);
    }
  });
  it('세운 책은 두께가 반그림자보다 좁은 먼 구간만 옅다(빛에서 본 두께)', () => {
    const b = standing(-60);
    const last = bookCast(b, 1, physShadow.bands.length - 1, true)!;
    expect(last.w).toBeGreaterThan(0);
    expect(last.w).toBeLessThanOrEqual(1);
  });
});

describe('벽 그림자 중 판에 가려지지 않는 부분(wallParts)', () => {
  const X0 = 0;
  const X1 = 360;
  const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
  it('판 윗면 위는 그대로, 판 윗면 아래는 판 끝 너머만(오른쪽은 빛이 판 끝을 지난 뒤)', () => {
    const sq = [{ x: 340, y: -16 }, { x: 380, y: -16 }, { x: 380, y: 20 }, { x: 340, y: 20 }];
    const parts = wallParts(sq, X0, X1);
    expect(parts.length).toBe(2);
    const [top, right] = parts;
    expect(Math.min(...top.map((q) => q.y))).toBeCloseTo(0, 9);
    expect(area(top)).toBeCloseTo(40 * 20, 6);
    for (const q of right) {
      expect(q.y).toBeLessThanOrEqual(1e-9);
      expect(q.x - X1 - DROP_K * -q.y).toBeGreaterThanOrEqual(-1e-9);
    }
    // 판 끝 바로 옆 벽 일부에 그림자가 닿는다(예전에는 판 윗면 아래를 모두 잘랐다)
    expect(area(right)).toBeGreaterThan(50);
  });
  it('판 안쪽 아래(판 앞면 뒤)는 그리지 않는다', () => {
    expect(wallParts([{ x: 100, y: -10 }, { x: 150, y: -10 }, { x: 150, y: -1 }, { x: 100, y: -1 }], X0, X1)).toEqual([]);
  });
});

describe('판 앞면 그림자(frontCast)', () => {
  it('판 앞 끝 뒤에 있는 책은 판 앞면에 드리우지 않는다', () => {
    for (let k = 0; k < physShadow.bands.length; k++) expect(frontCast(standing(-SHELF_FRONT + 1), 1, k)).toBeNull();
  });
  it('선반 앞으로 빼낸 책은 판 앞면(판 두께 안)에 드리운다', () => {
    // 앞으로 빼고 든 책: 앞 아래 모서리의 빛줄기가 판 앞면 가운데 높이로
    const b0: Book3 = { id: 'a', dims: { T: 22, H: 143, W }, roll: 0, yaw: 0, t: { x: 100, y: 0, z: -SHELF_FRONT - W - 4 } };
    const lift = -SHELF_THICK / 2 - Math.min(...corners(b0).map(entryY));
    const b = { ...b0, t: { ...b0.t, y: lift } };
    const casts = physShadow.bands.map((_, k) => frontCast(b, 1, k)).filter((c) => c !== null);
    expect(casts.length).toBeGreaterThan(0);
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of casts) {
      for (const q of c!.pts) {
        expect(q.z).toBeCloseTo(-SHELF_FRONT, 9);
        lo = Math.min(lo, q.y);
        hi = Math.max(hi, q.y);
      }
      expect(c!.w).toBeGreaterThan(0);
    }
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(-SHELF_THICK);
  });
});
