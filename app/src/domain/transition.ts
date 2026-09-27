// 배치 전환 경로(순수, UI 스레드 워클릿에서도 쓴다). 한 동작 = 관련 책 전부의 위치·각도를 공통 진행률 t(0→1)로 푸는 경로.
// 끝 위치만 맞추면 중간에 겹칠 수 있으므로, 후보 경로를 t 전 구간에서 선반 공간 충돌로 검사해 처음 통과하는 것을 쓴다.
//  A. 함께: 이동과 회전을 같은 t로
//  B. 비켜서 기울기: 더 기우는 책은 옆 책이 먼저 비켜 준 뒤 회전, 덜 기우는(세워지는) 책은 먼저 세운 뒤 이동
//  C. 세우고-옮기고-기울기: 모두 세운 뒤 이동, 다시 기울기(세운 책끼리 순서를 지키는 이동은 겹치지 않는다)
import { collide, frontPoly, type Placed } from './box';

// 각도 키프레임 [t, 각도]와 이동 구간 [시작 t, 끝 t]
export type TransitionEntry = {
  id: string;
  from: Placed;
  to: Placed;
  move: [number, number];
  angle: [number, number][];
};

export type Plan = { entries: TransitionEntry[]; strategy: 'A' | 'B' | 'C' | 'snap' };

function seg(t: number, s: number, e: number) {
  'worklet';
  if (e <= s) return t >= e ? 1 : 0;
  return Math.max(0, Math.min(1, (t - s) / (e - s)));
}

function angleAt(keys: [number, number][], t: number) {
  'worklet';
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, a1] = keys[i];
    if (t <= t1) {
      const [t0, a0] = keys[i - 1];
      return a0 + (a1 - a0) * seg(t, t0, t1);
    }
  }
  return keys[keys.length - 1][1];
}

// 진행률 t에서의 상자
export function boxAt(e: TransitionEntry, t: number): Placed {
  'worklet';
  const m = seg(t, e.move[0], e.move[1]);
  return {
    bookId: e.to.bookId,
    pose: e.to.pose,
    size: e.to.size,
    x: e.from.x + (e.to.x - e.from.x) * m,
    y: e.from.y + (e.to.y - e.from.y) * m,
    z: e.from.z + (e.to.z - e.from.z) * m,
    angle: angleAt(e.angle, t),
  };
}

const still = (p: Placed): TransitionEntry => ({ id: p.bookId, from: p, to: p, move: [0, 1], angle: [[0, p.angle], [1, p.angle]] });
const moves = (e: TransitionEntry) => e.from.x !== e.to.x || e.from.y !== e.to.y || e.from.z !== e.to.z;
const turns = (e: TransitionEntry) => e.from.angle !== e.to.angle;

function build(prev: Placed[], next: Placed[], kind: 'A' | 'B' | 'C'): TransitionEntry[] {
  const before = new Map(prev.map((p) => [p.bookId, p]));
  return next.map((to) => {
    const from = before.get(to.bookId);
    // 새로 들어온 책·자세가 바뀐 책은 이번 단계에서는 바로 적용(자세 경로는 다음 단계)
    if (!from || from.pose !== to.pose) return still(to);
    const e: TransitionEntry = { id: to.bookId, from, to, move: [0, 1], angle: [[0, from.angle], [1, to.angle]] };
    if (kind === 'B') {
      if (Math.abs(to.angle) > Math.abs(from.angle)) {
        e.move = [0, 0.55];
        e.angle = [[0.45, from.angle], [1, to.angle]];
      } else if (Math.abs(to.angle) < Math.abs(from.angle)) {
        e.angle = [[0, from.angle], [0.55, to.angle]];
        e.move = [0.45, 1];
      }
    } else if (kind === 'C') {
      e.move = [1 / 3, 2 / 3];
      e.angle = [[0, from.angle], [1 / 3, 0], [2 / 3, 0], [1, to.angle]];
    }
    return e;
  });
}

export const SAMPLES = 48;
const MARGIN = 0.25; // 이 이상 파고들면 겹침(맞닿음과 계산 오차는 허용)

// 모든 t에서 겹침이 없는지: 움직이는 책이 끼는 쌍만 본다(처음과 끝 배치는 이미 겹치지 않는다)
export function firstOverlap(entries: TransitionEntry[], bounds?: { min: number; max: number }) {
  const active = entries.map((e) => moves(e) || turns(e));
  if (!active.some(Boolean)) return null;
  for (let k = 1; k < SAMPLES; k++) {
    const t = k / SAMPLES;
    const boxes = entries.map((e) => boxAt(e, t));
    for (let i = 0; i < boxes.length; i++) {
      if (bounds && active[i] && boxes[i].y === 0) {
        const xs = frontPoly(boxes[i]).map((q) => q.x);
        if (Math.min(...xs) < bounds.min - 0.5 || Math.max(...xs) > bounds.max + 0.5) {
          if (boxes[i].pose !== 'horizontal') return { t, a: entries[i].id, b: 'bounds' };
        }
      }
      for (let j = i + 1; j < boxes.length; j++) {
        if (!active[i] && !active[j]) continue;
        if (collide(boxes[i], boxes[j], MARGIN)) return { t, a: entries[i].id, b: entries[j].id };
      }
    }
  }
  return null;
}

export function planTransition(prev: Placed[], next: Placed[], bounds?: { min: number; max: number }): Plan {
  const any = next.some((p) => {
    const q = prev.find((o) => o.bookId === p.bookId);
    return q && q.pose === p.pose && (q.x !== p.x || q.y !== p.y || q.z !== p.z || q.angle !== p.angle);
  });
  if (!any) return { entries: next.map(still), strategy: 'snap' };
  for (const kind of ['A', 'B', 'C'] as const) {
    const entries = build(prev, next, kind);
    if (!firstOverlap(entries, bounds)) return { entries, strategy: kind };
  }
  return { entries: build(prev, next, 'C'), strategy: 'C' };
}
