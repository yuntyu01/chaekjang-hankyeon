// 책 → 벽·선반 윗면 그림자(한 모델, cast-shadow bookCast): 두 면이 만나는 선에서 같은 빛줄기의 진하기가 같고,
// 책을 앞뒤로 조금씩 옮기는 동안 벽 그림자 진하기가 한 번에 튀지 않는다(흐림은 빼고 층 모양·진하기만 본다).
import type { Book3, Vec3 } from '../book3';
import { hull } from '../box';
import { bookCast, travelOf } from '../cast-shadow';
import { SHELF_DEPTH } from '../geometry';
import { light, physShadow } from '@/ui/lighting';

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
