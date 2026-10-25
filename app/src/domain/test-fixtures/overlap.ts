// 테스트용: 앞면 윤곽(2D) 볼록 다각형이 겹치는지(분리축). margin만큼 겹쳐야 겹침으로 본다(맞닿음은 허용).
// 앱은 3D 상자(book3 gap)로 충돌을 판정한다. 이 함수는 화면 윤곽이 서로 파고들지 않는지 확인할 때만 쓴다.
import { hull } from '../box';
import type { Point } from '../camera';

export function overlaps(a: Point[], b: Point[], margin = 0.05) {
  const A = hull(a);
  const B = hull(b);
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const len = Math.hypot(nx, ny) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of A) {
        const d = (v.x * nx + v.y * ny) / len;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of B) {
        const d = (v.x * nx + v.y * ny) / len;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB + margin || maxB < minA + margin) return false;
    }
  }
  return true;
}
