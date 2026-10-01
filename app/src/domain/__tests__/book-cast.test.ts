// 책 → 벽·선반 윗면 그림자(한 모델, cast-shadow bookCast): 두 면이 만나는 선에서 같은 빛줄기의 진하기가 같고,
// 책을 앞뒤로 조금씩 옮기는 동안 벽 그림자 진하기가 한 번에 튀지 않는다(흐림은 빼고 층 모양·진하기만 본다).
import type { Book3, Vec3 } from '../book3';
import { hull } from '../box';
import { bookCast, travelOf } from '../cast-shadow';
import { SHELF_DEPTH } from '../geometry';
import { light, shadow } from '@/ui/lighting';

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

// 한 점의 진하기: 그 점을 덮는 층의 진하기 × 옅어짐(w)을 포갠 값. 받는 면 평면 좌표는 벽 (x, y), 선반 윗면 (x, z)
function darkness(b: Book3, P: Vec3, wall: boolean) {
  let keep = 1;
  shadow.cast.book.layers.forEach((_, k) => {
    const c = bookCast(b, 1, k, wall);
    if (!c) return;
    const poly = hull(c.pts.map((q) => (wall ? { x: q.x, y: q.y } : { x: q.x, y: q.z })));
    if (inside(wall ? { x: P.x, y: P.y } : { x: P.x, y: P.z }, poly)) keep *= 1 - shadow.cast.book.opacity[k] * c.w;
  });
  return 1 - keep;
}

describe('책 → 벽·선반 윗면 그림자', () => {
  it('벽과 선반 윗면이 만나는 선에서 같은 빛줄기의 진하기가 같다(책을 앞으로 뺀 자리부터 벽에 붙인 자리까지)', () => {
    // 앞면 z: 앞으로 뺌(-20), 기준선(0), 뒤로(10, 20). 뒷면에서 벽까지 빛 길이 약 80·44·26·8DU
    for (const z of [-20, 0, 10, 20]) {
      const b = standing(z);
      let shaded = 0;
      for (let x = 90; x <= 260; x += 1) {
        const P = { x, y: 0, z: SHELF_DEPTH };
        const dw = darkness(b, P, true);
        const df = darkness(b, P, false);
        expect(Math.abs(dw - df)).toBeLessThan(1e-6);
        if (dw > 0) shaded++;
      }
      expect(shaded).toBeGreaterThan(10);
    }
  });

  it('책을 벽 쪽으로 0.5DU씩 밀 때 책 뒤 벽 그림자 진하기가 한 번에 튀지 않는다', () => {
    let prev = -1;
    for (let z = -30; z <= SHELF_DEPTH - W; z += 0.5) {
      const b = standing(z);
      // 뒷면 가운데에서 빛 방향으로 벽에 닿는 점
      const back = { x: 111, y: 70, z: z + W };
      const t = (SHELF_DEPTH - back.z) / D.z;
      const P = { x: back.x + D.x * t, y: back.y + D.y * t, z: SHELF_DEPTH };
      const d = darkness(b, P, true);
      if (prev >= 0) expect(Math.abs(d - prev)).toBeLessThan(0.02);
      prev = d;
    }
    // 벽에 붙이면 가장 진하다(세 층이 모두 덮는다)
    expect(prev).toBeCloseTo(1 - shadow.cast.book.opacity.reduce((a, o) => a * (1 - o), 1), 6);
  });
});
