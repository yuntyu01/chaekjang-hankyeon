// 받침 판정(순수). 수평 쌓기: 위 책의 바닥 다각형이 아래 책의 실제 윗면 다각형 안에 있어야 한다(보수적 첫 버전).
// 부분 돌출·여러 받침에 걸친 배치는 질량중심·지지 영역 판정 없이는 허용하지 않는다.
import { containsXZ, footprintXZ, fromPlaced, topXZ, topY } from './book3';
import { boxSize, type Placed } from './box';
import { defaultDepth, spunExtent, stackOffsets } from './geometry';
import type { Book } from './types';

export const SUPPORT_TOL = 0.3; // DU: 이만큼 삐져나오는 것은 모서리 둥글림·계산 오차로 본다

// 아래 책 위에 올린 책이 받쳐지는지
export function supportedOn(upper: Placed, lower: Placed) {
  const u = fromPlaced(upper);
  const l = fromPlaced(lower);
  // 놓이는 높이 = 아래 책의 변환된 실제 윗면
  if (Math.abs(upper.y - topY(l)) > 0.5) return false;
  return containsXZ(topXZ(l), footprintXZ(u), SUPPORT_TOL);
}

// 쌓기 더미의 상자들(아래 → 위). x: 더미 자리 왼쪽 끝. 위 책은 아래 책의 실제 윗면 높이에, 깊이는 아래 책 가운데에 맞춘다.
export function stackBoxes(
  members: { bookId: string; book: Book; spin?: number; depth?: number; dx?: number; dz?: number }[],
  x: number,
): Placed[] {
  const offs = stackOffsets(members.map((m) => m.book), members.map(m=>m.spin ?? 0));
  const out: Placed[] = [];
  members.forEach((m, i) => {
    const size = boxSize(m.book, 'horizontal');
    const spin = m.spin ?? 0;
    const d = spunExtent(m.book, spin).d;
    let y = 0;
    let z = m.depth ?? defaultDepth(m.book, 'horizontal');
    if (i > 0) {
      const lower = out[i - 1];
      y = topY(fromPlaced(lower));
      const dl = spunExtent(members[i - 1].book, members[i - 1].spin ?? 0).d;
      z = lower.z + (dl - d) / 2 + (m.dz ?? 0);
    }
    out.push({ bookId: m.bookId, pose: 'horizontal', size, x: x + offs[i] + (i > 0 ? m.dx ?? 0 : 0), y, z, angle: 0, spin });
  });
  return out;
}

// 더미 전체가 받쳐지는지(각 위 책이 바로 아래 책 윗면 안에)
export function stackSupported(boxes: Placed[]) {
  for (let i = 1; i < boxes.length; i++) if (!supportedOn(boxes[i], boxes[i - 1])) return false;
  return true;
}
