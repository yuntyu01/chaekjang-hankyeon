// 가만히 있는 자세 판정(정역학, 순수). 물리 엔진 없이 책을 고른 직육면체로 보고, 화면에 그리는 치수(DU)로 판정한다.
// 세운 책 기대기·표지 책 벽 기대기·받침이 되는 책이 모두 같은 규칙을 쓴다.
//  - 넘어짐: 기운 책은 기우는 쪽 바닥 모서리 하나로 선다. 무게중심이 그 모서리 바깥(기우는 쪽)으로 넘어가야 받침에 기대고,
//    안쪽이면 받침을 밀지 않고 다시 선다. 평평한 받침(옆 책 옆면·벽)에 윗모서리가 닿을 때 한계각 = atan(두께 / 키).
//  - 미끄러짐: 받침이 미는 힘을 바닥 마찰이 버텨야 한다(바닥 마찰계수 FLOOR_FRICTION, 책·벽 사이 마찰은 0으로 본다: 보수적).
//    평평한 받침이면 미는 힘 = 무게 × (tan θ − 두께/키) / 2 이고, 마찰이 버티는 한계각 = atan(2μ + 두께/키).
//  - 받침: 기댄 책이 미는 힘에 받침이 되는 세운 책이 반대쪽 바닥 모서리로 넘어가는지(그 너머에 닿은 책이 있으면 줄 전체가 버틴다).
// 정할 값(2026-10-26 사용자 결정): 바닥 마찰 0.4, 메뉴로 기울이는 한도 20°.
import { corners, fromPlaced, gap } from './book3';
import { hull, type Placed } from './box';
import type { Point } from './camera';

export const FLOOR_FRICTION = 0.4;
// 메뉴로 기울일 때(새로 기대게 할 때) 쓰는 가장 큰 각(디자인 한도). 이미 기대 있던 책이 받침을 잃고 더 넘어가는 각은 물리(미끄러짐)가 정한다.
export const LEAN_MENU_MAX = 20;
// 메뉴로 기울일 때 넘어짐 한계보다 이만큼 더 기울게 틈을 벌린다(놓자마자 다시 서지 않게, 계산 오차 여유)
export const LEAN_MARGIN = 1.5;

const DEG = 180 / Math.PI;

// 평평한 받침에 기댈 때 다시 서는 한계(도): 이 각 이하로 기운 책은 무게중심이 축 안쪽이라 혼자 다시 선다
export function tipAngle(T: number, H: number) {
  return Math.atan2(T, H) * DEG;
}

// 평평한 받침(옆 책 옆면·벽)에 기댈 때 바닥이 미끄러지지 않는 가장 큰 각(도)
export function slipAngle(T: number, H: number, mu = FLOOR_FRICTION) {
  return Math.atan(2 * mu + T / H) * DEG;
}

// 메뉴로 기울일 때 노리는 각: 넘어짐 한계 + 여유. 한도(LEAN_MENU_MAX)를 넘으면 null(두꺼워서 기댈 수 없는 책)
export function menuLeanAngle(T: number, H: number) {
  const want = tipAngle(T, H) + LEAN_MARGIN;
  return want <= LEAN_MENU_MAX && want < slipAngle(T, H) ? want : null;
}

// 표지 책이 벽에 기댈 때(뒤쪽 아래 모서리가 축, 윗모서리가 벽) 손을 놓은 뒤 머무는 젖힘 각:
// 넘어짐 한계 이하면 다시 서고(0), 미끄러짐 한계를 넘으면 바닥이 앞으로 미끄러져 눕고(90), 그 사이면 그대로.
export function wallLeanRest(T: number, H: number, pitch: number) {
  if (pitch >= 89.95) return 90;
  if (pitch <= tipAngle(T, H)) return 0;
  if (pitch > slipAngle(T, H)) return 90;
  return pitch;
}

// 기대 있을 수 있는 각인지(평평한 받침 기준): 넘어짐 한계 초과 ~ 미끄러짐 한계 이하
export function leanHolds(T: number, H: number, angle: number, mu = FLOOR_FRICTION) {
  const a = Math.abs(angle);
  return a > tipAngle(T, H) && a <= slipAngle(T, H, mu);
}

// ---------- 접촉점과 힘(선반 공간 x-y 평면, y 위) ----------

export type Vec2 = { x: number; y: number };
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

// 상자의 x-y 외곽(깊이 방향으로 본 실루엣): 회전한 상자 꼭짓점 8개를 x-y로 눌러 볼록 외곽
export function outlineXY(p: Placed): Point[] {
  return hull(corners(fromPlaced(p)).map((c) => ({ x: c.x, y: c.y })));
}

// 무게(부피, 밀도 1)
export function massOf(p: Placed) {
  return p.size.w * p.size.h * p.size.d;
}

// 무게중심(x-y)
export function centerXY(p: Placed): Vec2 {
  const cs = corners(fromPlaced(p));
  return { x: cs.reduce((s, c) => s + c.x, 0) / cs.length, y: cs.reduce((s, c) => s + c.y, 0) / cs.length };
}

// 기댄 세운 책의 바닥 축 모서리(x-y)
export function pivotOf(p: Placed): Vec2 {
  return { x: p.angle > 0 ? p.x + p.size.w : p.x, y: p.y };
}

function closestOnSegment(q: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  const c = { x: a.x + t * dx, y: a.y + t * dy };
  return { c, d: Math.hypot(q.x - c.x, q.y - c.y) };
}

// 반시계 다각형 변의 바깥 법선
function outward(a: Vec2, b: Vec2): Vec2 {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
}

export type Contact = { at: Vec2; n: Vec2 }; // n: 받침이 기댄 책을 미는 방향(단위)

// 기댄 책(angle ≠ 0)과 받침 상자의 접촉: 기댄 책 윗모서리가 받침 면에 닿거나(받침이 높을 때), 받침 꼭짓점이 기댄 책 옆면에 닿는다(받침이 낮을 때).
export function contactOf(leaner: Placed, support: Placed): Contact {
  const L = outlineXY({ ...leaner }); // 회전한 직사각형(반시계)
  const S = outlineXY(support);
  const P = pivotOf(leaner);
  const dir = Math.sign(leaner.angle) || 1;
  // 기우는 쪽 윗모서리: 위쪽 꼭짓점 둘 중 기우는 쪽으로 더 나간 것
  const [u, v] = [...L].sort((a, b) => b.y - a.y);
  const top = dir * (u.x - v.x) >= 0 ? u : v;
  // 후보 1: 윗모서리 → 받침 변
  let best: { d: number; at: Vec2; n: Vec2 } = { d: Infinity, at: top, n: { x: -dir, y: 0 } };
  for (let i = 0; i < S.length; i++) {
    const a = S[i];
    const b = S[(i + 1) % S.length];
    const { d } = closestOnSegment(top, a, b);
    if (d < best.d) best = { d, at: top, n: outward(a, b) };
  }
  // 후보 2: 받침 꼭짓점 → 기댄 책의 기우는 쪽 옆면(축 → 윗모서리). 미는 방향은 그 면의 안쪽 법선
  const side = { a: P, b: top };
  let inward = outward(side.a, side.b);
  // 바깥 법선이 받침 쪽(기우는 쪽)을 향하게 맞춘 뒤 뒤집는다
  if (Math.sign(inward.x) !== dir) inward = { x: -inward.x, y: -inward.y };
  inward = { x: -inward.x, y: -inward.y };
  for (const v of S) {
    const { c, d } = closestOnSegment(v, side.a, side.b);
    if (d < best.d - 1e-6) best = { d, at: c, n: inward };
  }
  return { at: best.at, n: best.n };
}

export type Force = { f: Vec2; at: Vec2 };
export type LeanStatics = {
  // 받침이 미는 힘(무게 대비, 음수면 받침을 밀지 않는다 = 다시 선다)
  normal: number;
  // 받침이 이 책에서 받는 힘(무게 단위 그대로, 받침 쪽 계산에 넘긴다)
  onSupport: Force;
  // 바닥 반력
  floor: Vec2;
  ok: boolean;
  reason?: 'tip' | 'slip';
};

// 기댄 세운 책 한 권의 힘 평형: 바닥 축(마찰) + 무게 + 받침 접촉(마찰 0) + 밖에서 오는 힘(이 책에 기댄 다른 책).
export function leanStatics(leaner: Placed, contact: Contact, external: Force[] = [], mu = FLOOR_FRICTION): LeanStatics {
  const P = pivotOf(leaner);
  const m = massOf(leaner);
  const g = centerXY(leaner);
  const r = (q: Vec2) => ({ x: q.x - P.x, y: q.y - P.y });
  // 축 둘레 돌림힘(반시계 +)
  let tau = cross(r(g), { x: 0, y: -m });
  for (const e of external) tau += cross(r(e.at), e.f);
  const lever = cross(r(contact.at), contact.n);
  const N = Math.abs(lever) < 1e-9 ? -1 : -tau / lever;
  const fx = N * contact.n.x + external.reduce((s, e) => s + e.f.x, 0);
  const fy = N * contact.n.y + external.reduce((s, e) => s + e.f.y, 0) - m;
  const floor = { x: -fx, y: -fy };
  const onSupport = { f: { x: -N * contact.n.x, y: -N * contact.n.y }, at: contact.at };
  if (N <= 0) return { normal: N / m, onSupport, floor, ok: false, reason: 'tip' };
  if (floor.y <= 0 || Math.abs(floor.x) > mu * floor.y + 1e-9) return { normal: N / m, onSupport, floor, ok: false, reason: 'slip' };
  return { normal: N / m, onSupport, floor, ok: true };
}

// 받침이 되는 똑바로 선 세운 책이 기댄 책들이 미는 힘에 밀리는 쪽 바닥 모서리를 축으로 넘어가는지(넘어가면 그 방향).
// backed(dir): 그쪽 너머에 붙어 선 책이 있으면 줄 전체가 버틴다. 표지 책·눕힌 책은 바닥이 넓어 넘어가지 않는다고 본다.
export function supportTips(support: Placed, pushes: Force[], backed: (dir: -1 | 1) => boolean): -1 | 0 | 1 {
  if (support.pose !== 'spine' || support.angle || !pushes.length) return 0;
  const fx = pushes.reduce((s, p) => s + p.f.x, 0);
  const d = Math.sign(fx) as -1 | 0 | 1;
  if (!d || backed(d)) return 0;
  const q = { x: d < 0 ? support.x : support.x + support.size.w, y: support.y };
  const g = centerXY(support);
  const m = massOf(support);
  const r = (v: Vec2) => ({ x: v.x - q.x, y: v.y - q.y });
  let tau = cross(r(g), { x: 0, y: -m });
  for (const p of pushes) tau += cross(r(p.at), p.f);
  // 왼쪽으로 밀리면 왼쪽 아래 모서리를 축으로 반시계(+)로 넘어간다
  const tips = d < 0 ? tau > 1e-9 : tau < -1e-9;
  if (tips) return d;
  // 미끄러짐: 미는 힘을 바닥 마찰이 버티지 못하면 밀려난다(그쪽으로 넘어가는 것과 같이 다룬다)
  const fy = m - pushes.reduce((s, p) => s + p.f.y, 0);
  return Math.abs(fx) > FLOOR_FRICTION * fy + 1e-9 ? d : 0;
}

// 받침 너머(밀리는 쪽)에 붙어 선 책이 있는지(깊이가 겹치고 간격이 tol 이하)
export function isBacked(support: Placed, dir: number, others: Placed[], tol = 0.5) {
  const s = fromPlaced(support);
  const sc = centerXY(support).x;
  return others.some((o) => o.bookId !== support.bookId && Math.sign(centerXY(o).x - sc) === dir && gap(s, fromPlaced(o)) < tol);
}

// 넘어지는 책이 바닥에 누울 때 차지하는 가로 범위(축 모서리를 기준으로 키만큼 기우는 쪽으로)
export function fallenSpan(p: Placed, dir: number) {
  const P = pivotOf({ ...p, angle: dir });
  return dir < 0 ? { x0: P.x - p.size.h, x1: P.x } : { x0: P.x, x1: P.x + p.size.h };
}
