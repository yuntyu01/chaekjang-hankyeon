// 선반 한 칸의 책 프레임 계산(순수). 프레임 = 선반 공간의 3D 상자(카메라와 무관). 그리기·터치·그림자는 이 상자를
// 매 프레임 같은 카메라로 투영해 쓴다(투영 결과를 여기 저장하지 않는다).
import { boxSize, collide, CONTACT, frontPoly, hull, type Placed } from './box';
import { corners, fromPlaced, type Book3 } from './book3';
import { project, type Cam, type Point } from './camera';
import { SHELF, SHELF_USABLE_WIDTH, SHELF_X0, SHELF_X1 } from './geometry';
import { bookXs, checkSpace, EDGE_PAD, itemBoxes, itemPositions, moveToDrawer, normalize, OVERHANG_MARGIN, placementOf, setTilt, settle, shelfItems, type BookMap } from './layout-engine';
import { firstContact, leanContact, type LeanContact } from './lean';
import { centerXY, contactOf, fallenSpan, isBacked, LEAN_MENU_MAX, leanStatics, supportTips, tipAngle, type Force } from './statics';
import { tiltToward, type Book, type Pose, type ShelfLayout, type Tilt } from './types';

export type { Point };

export type BookFrame = {
  bookId: string;
  itemKey: string;
  shelfId: string;
  pose: Pose;
  tilt: Tilt;
  stackIndex: number;
  // 기대려 했지만 닿을 곳이 없어(또는 선반 밖이라) 바로 선 책
  leanFailed?: boolean;
  // 기댄 상대 책
  leanOn?: string;
  // 받침을 잃고 바닥까지 넘어진 책(넘어진 방향). withLeans가 눕힌 책으로 바꾼다.
  fell?: -1 | 1;
  // 기댄 책의 발이 서 있던 상자 자리에서 기우는 반대쪽으로 미끄러진 거리(DU, 배치 lean.slide). box는 그만큼 옮긴 자리다
  slide?: number;
  // 선반 공간 상자(그리기·충돌의 원본). 기댄 책은 기울어진 상자(angle)
  box: Placed;
};

export type ItemFrame = { key: string; x: number; width: number; bookIds: string[] };

// 선반 판 좌우 끝(선반 공간 x). 이 밖으로 쓰러지거나 지나가면 안 된다(판 3D 상자와 같은 값).
export const PLANK_BOUNDS = { min: SHELF_X0, max: SHELF_X1 };

function frameOf(p: Placed, bookId: string, itemKey: string, shelfId: string, tilt: Tilt, stackIndex: number): BookFrame {
  return { bookId, itemKey, shelfId, pose: p.pose, tilt, stackIndex, box: p };
}

// 선반 한 칸의 상자 배치와 프레임. 충돌·기대기는 선반 공간(가로·깊이·회전).
export function computeShelf(layout: ShelfLayout, books: BookMap, shelfId: string) {
  const positions = itemPositions(shelfItems(layout, shelfId), layout, books);
  const frames: BookFrame[] = [];
  const items: ItemFrame[] = [];
  for (const { item, x, width } of positions) {
    items.push({ key: item.key, x, width, bookIds: item.bookIds });
    itemBoxes(item, layout, books, x).forEach((box, i) => {
      const p = placementOf(layout, box.bookId)!;
      frames.push(frameOf(box, box.bookId, item.key, shelfId, item.stacked || p.pose !== 'spine' ? 0 : p.tilt, item.stacked ? i : 0));
    });
  }
  return { frames: solveBoth(frames, layout), items };
}

// 왼쪽·오른쪽으로 기대는 책이 함께 있으면 두 순서(왼쪽으로 기대는 책 먼저 / 오른쪽 먼저)로 모두 풀고 좌우와 상관없는 기준으로 고른다:
// 넘어진 책·기대지 못한 책이 적은 쪽, 그다음 기대지 못하고 선 책들의 넘어짐 한계가 큰 쪽(두꺼워 기대기 어려운 책이 선다), 그다음 책 id.
// 한 순서만 쓰면 빈틈을 두고 다투는 두 책 중 먼저 푼 쪽이 늘 이겨 좌우를 바꾼 배치에서 결과가 달라진다.
function solveBoth(frames: BookFrame[], layout: ShelfLayout): BookFrame[] {
  const lean = (d: number) => frames.some((f) => f.pose === 'spine' && f.stackIndex === 0 && Math.sign(f.tilt) === d);
  if (!lean(-1) || !lean(1)) {
    solveLeans(frames, layout, -1);
    return frames;
  }
  const copy = () => frames.map((f) => ({ ...f, box: { ...f.box } }));
  const a = copy();
  const b = copy();
  solveLeans(a, layout, -1);
  solveLeans(b, layout, 1);
  const score = (fs: BookFrame[]) => {
    const failed = fs.filter((f) => f.leanFailed);
    return {
      fell: fs.filter((f) => f.fell).length,
      failed: failed.length,
      tip: failed.reduce((s, f) => s + tipAngle(f.box.size.w, f.box.size.h), 0),
      key: failed.map((f) => f.bookId).sort().join(','),
    };
  };
  const sa = score(a);
  const sb = score(b);
  if (sa.fell !== sb.fell) return sa.fell < sb.fell ? a : b;
  if (sa.failed !== sb.failed) return sa.failed < sb.failed ? a : b;
  if (Math.abs(sa.tip - sb.tip) > 1e-6) return sa.tip > sb.tip ? a : b;
  return sa.key <= sb.key ? a : b;
}

// 앞면 윤곽(깊이 밀림 없이 선반 공간 x, 바닥 0·위가 -). 테스트의 접촉·겹침 확인용
export function frontOutline(f: BookFrame): Point[] {
  return frontPoly(f.box).map((q) => ({ x: q.x, y: -q.y }));
}

const inside = (poly: { x: number }[]) => poly.every((p) => p.x >= PLANK_BOUNDS.min - 0.01 && p.x <= PLANK_BOUNDS.max + 0.01);

// 기대는 책들의 각도(선반 공간)와 버틸 수 있는지(statics.ts). 깊이 구간이 겹치는 상자만 장애물이다
// (뒤에 놓인 눕힌 책은 화면에서 겹쳐도 닿지 않는다).
//  - 새로 기대는 책(저장된 기대기 없음): 똑바로 선 자세에서 기울여 LEAN_MENU_MAX까지 처음 닿는 곳. 닿지 않거나,
//    닿아도 무게중심이 축 안쪽이면(넘어짐 한계 이하) 다시 선다.
//  - 이미 기대 있던 책(저장된 각도): 그 각에서 아직 닿아 있으면 그대로(사용자가 꾸민 모습 유지). 받침이 비켜 닿지 않으면
//    그 각에서 더 넘어져 다음 책에 기대고, 미끄러짐 한계를 넘거나 닿을 곳이 없으면 바닥에 눕는다(fell, withLeans가 눕힌다).
//    다른 책이 파고들면(옆 책이 다가오면) 밀려 세워지며 처음 닿는 각을 다시 찾는다.
//  - 받침: 기댄 책들이 미는 힘에 받침이 되는 똑바로 선 책이 넘어가면(너머에 붙은 책이 없을 때) 그 책도 그쪽으로 기울고(도미노),
//    기댄 책이 기댄 책에 기대면 미는 힘을 이어받아 바닥 마찰을 확인한다.
// 순서: 왼쪽으로 기대는 책은 왼쪽부터, 오른쪽으로 기대는 책은 오른쪽부터. 서로 영향을 주므로 바뀌는 것이 없을 때까지 반복한다.
const MAX_ROUNDS = 8;
type Rest = { angle: number; on?: string; failed?: boolean; fell?: boolean; slide?: number };

// first: 먼저 푸는 기울기 방향(-1 왼쪽으로 기대는 책 먼저, 1 오른쪽 먼저). 같은 방향 안에서는 기대는 사슬의 받침 쪽부터
function solveLeans(frames: BookFrame[], layout: ShelfLayout, first: -1 | 1) {
  // 기운 책은 모두 기대기 결과를 처음부터 다시 푼다(받침으로 쓰이다 넘어간 책, 곧 저장된 기울기 없이 이번 계산에서 기운 책도)
  for (const f of frames) if (f.pose === 'spine' && f.tilt !== 0 && f.stackIndex === 0) f.leanFailed = false;
  if (!frames.some((f) => f.pose === 'spine' && f.tilt !== 0)) return;
  const standing = new Set<string>(); // 넘어짐 한계 이하라 다시 선 책
  const fallen = new Set<string>(); // 바닥에 누운 책(다른 책의 받침이 되지 못한다)
  const toppled = new Set<string>(); // 기댄 책이 미는 힘에 넘어간 받침 책(넘어지는 책처럼 90°까지 찾는다)
  // 발이 미끄러진 거리(slide)만큼 상자를 기우는 반대쪽으로 옮긴다(서 있던 자리 = 지금 box.x + 방향 × 지금 slide)
  const set = (f: BookFrame, r: Rest) => {
    const d = Math.sign(f.tilt) || 1;
    const slide = r.slide && r.angle ? r.slide : 0;
    const x = f.box.x + d * (f.slide ?? 0) - d * slide;
    Object.assign(f, { box: { ...f.box, x, angle: r.angle }, slide: slide || undefined, leanOn: r.on, leanFailed: !!r.failed, fell: r.fell ? (Math.sign(f.tilt) as -1 | 1) : undefined });
  };
  // 장애물: 바닥에 누운 책과, 이 책에 기대 있는 책(이 책이 기울면 함께 밀려난다)은 뺀다
  const othersOf = (f: BookFrame) => frames.filter((o) => o !== f && !fallen.has(o.bookId) && o.leanOn !== f.bookId).map((o) => o.box);
  // 발 뒤(기우는 반대쪽)에 붙어 선 책이 발을 막으면 바닥이 미끄러지지 않는다: 바닥 마찰 대신 그 책이 발을 민다
  // (바닥이 발을 기우는 쪽으로 밀어야 할 때만, 바닥이 책을 누르고 있을 때만). 기운 상자 그대로 뒤 책에 닿아 있는지 본다
  // (예전에는 서 있던 상자로 봐서, 기울어 들린 아래 모서리가 뒤 책에서 37mm까지 떨어져 있어도 막힌 것으로 쳤다).
  // 막아 주는 책은 똑바로 서 있거나 누운 책만(기댄 책은 자기도 받침에 기대 있어 발을 받치지 못한다)
  const braced = (f: BookFrame, floor: { x: number; y: number }, on: string) => {
    const dir = Math.sign(f.box.angle) as -1 | 1;
    return floor.y > 0 && Math.sign(floor.x) === dir && isBacked(f.box, -dir, othersOf(f).filter((o) => o.bookId !== on && !o.angle));
  };
  const storedOf = (f: BookFrame) => {
    const s = placementOf(layout, f.bookId)?.lean;
    return s && Math.sign(s.angle) === Math.sign(f.tilt) ? s : undefined;
  };

  // 지금 자세에서 다른 책(받침 포함)을 파고든 기댄 책(맞닿음은 허용: TOLERANCE)
  const overlapping = () =>
    frames.filter((f) => f.pose === 'spine' && f.box.angle && frames.some((o) => o !== f && !fallen.has(o.bookId) && !o.fell && collide(f.box, o.box)));
  const stateKey = () => frames.map((f) => `${f.bookId}:${f.box.angle.toFixed(3)}:${f.leanOn ?? ''}:${f.fell ?? ''}:${f.leanFailed ? 1 : 0}`).join('|');
  const seen = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const leaners = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0 && !standing.has(f.bookId) && !fallen.has(f.bookId));
    const before = stateKey();
    // 마주 보고 기대는 두 권은 같은 각도로 함께 기울여 처음 닿는 곳에서 멈춘다(한 권씩 풀면 먼저 푼 책이 빈틈을 다 차지한다).
    // 둘 다 넘어짐 한계를 넘어야 하고, 다른 책·선반 끝과 부딪히지 않아야 한다. 아니면 한 권씩 푼다.
    // 서로에게 기댄 것으로 저장된 두 권(받침을 잃고 서로 쪽으로 넘어져 A자로 만난 책)은 메뉴 각도 한도를 넘어 90°까지 찾는다:
    // 한 권씩 풀면 서로를 장애물에서 빼(이 책에 기댄 책은 함께 밀려난다) 둘 다 바닥까지 넘어진다
    const paired = new Set<string>();
    const byLeft = frames.filter((f) => f.stackIndex === 0 && !fallen.has(f.bookId)).sort((a, b) => a.box.x - b.box.x);
    for (let i = 0; i + 1 < byLeft.length; i++) {
      const a = byLeft[i];
      const b = byLeft[i + 1];
      if (!(a.pose === 'spine' && b.pose === 'spine' && a.tilt > 0 && b.tilt < 0) || standing.has(a.bookId) || standing.has(b.bookId)) continue;
      // 짝에 기대 있는 책은 짝이 기울면 함께 밀려나므로 장애물에서 뺀다(한 권씩 풀 때 othersOf와 같다. 넣으면 그 책의 지금 자세 때문에
      // 짝이 되었다 풀렸다를 되풀이한다)
      const rest = frames.filter((o) => o !== a && o !== b && !fallen.has(o.bookId) && o.leanOn !== a.bookId && o.leanOn !== b.bookId).map((o) => o.box);
      // 서 있던 자리(앞 바퀴에서 발이 미끄러져 옮긴 상자는 되돌린다)
      const ua = { ...a.box, x: a.box.x + (a.slide ?? 0) };
      const ub = { ...b.box, x: b.box.x - (b.slide ?? 0) };
      const ok = (d: number) => {
        const qa = { ...ua, angle: d };
        const qb = { ...ub, angle: -d };
        return !rest.some((o) => collide(qa, o) || collide(qb, o)) && inside(frontPoly(qa)) && inside(frontPoly(qb));
      };
      const mutual = storedOf(a)?.on === b.bookId && storedOf(b)?.on === a.bookId;
      const c = firstContact((d) => collide({ ...ua, angle: d }, { ...ub, angle: -d }, CONTACT) || !ok(d), 0, mutual ? 90 : LEAN_MENU_MAX);
      if (!c.found || c.angle === 0 || !ok(c.angle)) continue;
      // 마주 기댄 접촉에 닿았는지(다른 책이나 선반 끝에서 멈춘 것이 아닌지)
      if (!collide({ ...ua, angle: c.angle + 0.6 }, { ...ub, angle: -(c.angle + 0.6) }, CONTACT)) continue;
      // 만나는 각이 넘어짐 한계 안인 책은 무게중심이 발 위라 혼자 다시 선다: 세우고, 상대는 한 권씩 풀 때 선 책에 기댄다
      // (그냥 한 권씩 풀면 이 책에 기댄 상대를 장애물에서 빼 바닥까지 넘어지고, 그 상대가 다른 책을 밀어 줄줄이 무너졌다)
      const sa = c.angle <= tipAngle(a.box.size.w, a.box.size.h);
      const sb = c.angle <= tipAngle(b.box.size.w, b.box.size.h);
      if (sa || sb) {
        for (const [f, st] of [[a, sa], [b, sb]] as const) {
          if (!st) continue;
          standing.add(f.bookId);
          set(f, { angle: 0, failed: true });
        }
        continue;
      }
      set(a, { angle: c.angle, on: b.bookId });
      set(b, { angle: -c.angle, on: a.bookId });
      paired.add(a.bookId).add(b.bookId);
    }
    const ordered = leaners.filter((f) => !paired.has(f.bookId)).sort((a, b) => a.box.x - b.box.x);
    const leftward = ordered.filter((f) => f.tilt < 0);
    const rightward = [...ordered].reverse().filter((f) => f.tilt > 0);
    const passes = first < 0 ? [leftward, rightward] : [rightward, leftward];
    for (let iter = 0; iter < 3; iter++) for (const pass of passes) for (const f of pass) set(f, restOf(f, othersOf(f), storedOf(f), toppled.has(f.bookId)));
    for (const f of leaners) if (f.fell) fallen.add(f.bookId);

    // 버티는지(무게중심·바닥 마찰)와 받침이 넘어가는지. 기대는 사슬의 바깥(아무도 기대지 않은 책)부터 미는 힘을 넘긴다.
    const active = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0 && !standing.has(f.bookId) && !fallen.has(f.bookId) && f.leanOn && f.box.angle);
    const byId = new Map(frames.map((f) => [f.bookId, f]));
    const loads = new Map<string, Force[]>();
    const leansOnMe = (id: string) => active.filter((f) => f.leanOn === id && !(paired.has(f.bookId) && paired.has(id)));
    const order: BookFrame[] = [];
    const pending = new Set(active.map((f) => f.bookId));
    while (pending.size) {
      const pick = active.find((f) => pending.has(f.bookId) && leansOnMe(f.bookId).every((g) => !pending.has(g.bookId))) ?? active.find((f) => pending.has(f.bookId))!;
      pending.delete(pick.bookId);
      order.push(pick);
    }
    let changed = false;
    for (const f of order) {
      const s = byId.get(f.leanOn!);
      if (!s) continue;
      const st = leanStatics(f.box, contactOf(f.box, s.box), loads.get(f.bookId) ?? []);
      if (!st.ok && !(st.reason === 'slip' && braced(f, st.floor, s.bookId))) {
        changed = true;
        if (st.reason === 'tip') standing.add(f.bookId);
        else fallen.add(f.bookId);
        continue;
      }
      // 마주 기댄 짝은 서로의 받침이다: 둘 사이 접촉 힘은 하나뿐이라 상대가 미는 힘을 또 더하지 않고 각자 판정한다
      // (더하면 먼저 푼 책의 힘이 두 번 세어져 좌우를 바꾸면 결과가 달라진다)
      if (s.leanOn === f.bookId) continue;
      loads.set(s.bookId, [...(loads.get(s.bookId) ?? []), st.onSupport]);
    }
    // 받침이 되는 똑바로 선 세운 책: 미는 힘에 넘어가면 그쪽으로 기운다(다음 바퀴에 넘어지는 책으로 푼다)
    for (const [id, pushes] of loads) {
      const s = byId.get(id);
      // 지금 똑바로 선 책(기대려다 실패해 선 책 포함: 저장된 기울기와 상관없이 실제 각으로 본다)
      if (!s || s.pose !== 'spine' || s.box.angle !== 0 || s.stackIndex !== 0) continue;
      const others = othersOf(s);
      const d = supportTips(s.box, pushes, (dir) => isBacked(s.box, dir, others));
      if (!d) continue;
      changed = true;
      s.tilt = tiltToward(d);
      s.leanFailed = false;
      standing.delete(s.bookId);
      toppled.add(s.bookId);
    }
    for (const id of standing) {
      const f = byId.get(id)!;
      set(f, { angle: 0, failed: true });
    }
    for (const id of fallen) {
      const f = byId.get(id)!;
      if (!f.fell) set(f, { angle: 0, fell: true });
    }
    const after = stateKey();
    if (!changed && after === before) break;
    if (seen.has(after)) {
      // 같은 상태가 되풀이된다(마주 기대려는 두 책이 서로를 비켜 가는 장애물로 보며 번갈아 기댄다): 다른 책을 파고든 기댄 책을 세워 끊는다
      const bad = overlapping();
      if (!bad.length) break;
      for (const f of bad) {
        standing.add(f.bookId);
        set(f, { angle: 0, failed: true });
      }
    }
    seen.add(after);
  }
  // 끝까지 풀리지 않았으면(바퀴 수 한도) 다른 책을 파고든 기댄 책은 그대로 둘 수 없다: 선다
  for (const f of overlapping()) set(f, { angle: 0, failed: true });
}

// 한 권이 쉬는 자세: 저장된 기대기·옆 상자로 처음 닿는 각과 그 각에서 버티는지(넘어짐·미끄러짐 한계, 힘의 사슬은 solveLeans)
// falling: 기댄 책들이 미는 힘에 밀려 넘어가는 받침 책(90°까지 찾고, 닿을 곳이 없으면 바닥에 눕는다). 미는 힘이 붙잡고 있으므로
// 넘어짐 한계보다 작은 각에서 이웃에 닿아도 그 각으로 기댄다(예전에는 다시 세워, 미는 힘에 넘어가야 할 받침이 똑바로 서 있었다)
// 저장된 기대기의 slide(발이 미끄러진 거리)는 그 자리에서 다시 본다. 옆 책이 파고들어 다시 찾을 때는 서 있던 자리에서
function restOf(f: BookFrame, others: Placed[], stored?: { angle: number; on: string; slide?: number }, falling = false): Rest {
  const dir = Math.sign(f.tilt) as -1 | 1;
  const up = { ...f.box, x: f.box.x + dir * (f.slide ?? 0), angle: 0 };
  const slide = stored?.slide ?? 0;
  const base = slide ? { ...up, x: up.x - dir * slide } : up;
  const T = base.size.w;
  const H = base.size.h;
  // 미끄러짐은 여기서 보지 않는다: 평평한 받침 공식(slipAngle)은 낮은 받침의 모서리에 닿을 때 맞지 않아(버틸 책이 눕는다)
  // 실제 접촉점의 힘 평형(solveLeans의 leanStatics)이 정한다
  const holds = (c: LeanContact, at = 0, pushed = false): Rest => {
    if (c.outside || !c.found) return { angle: 0, fell: true };
    if (c.angle <= (pushed ? 0.01 : tipAngle(T, H))) return { angle: 0, failed: true };
    return { angle: dir * c.angle, on: c.on, slide: at || undefined };
  };
  if (falling) return holds(leanContact(up, dir, others, PLANK_BOUNDS, 0, 90), 0, true);
  if (stored) {
    const q = { ...base, angle: stored.angle };
    if (!others.some((o) => collide(q, o)) && inside(frontPoly(q))) {
      // 그 각에서 더 넘어지며(받침이 그대로면 바로 닿는다) 처음 닿는 곳. 90°까지 닿지 않으면 바닥에 눕는다.
      const c = leanContact(base, dir, others, PLANK_BOUNDS, Math.abs(stored.angle), 90);
      if (c.found && Math.abs(c.angle - Math.abs(stored.angle)) < 0.05) {
        // 예전 규칙으로 저장된 각이 넘어짐 한계 이하면 버티지 못하고 선다(불러올 때 restore가 틈을 벌려 둔다)
        return Math.abs(stored.angle) <= tipAngle(T, H) ? { angle: 0, failed: true } : { angle: stored.angle, on: c.on, slide: slide || undefined };
      }
      return holds(c, slide);
    }
    // 옆 책이 다가와 파고든다: 서 있던 자리에서 밀려 세워지며 처음 닿는 각
    const c = leanContact(up, dir, others, PLANK_BOUNDS, 0, Math.max(LEAN_MENU_MAX, Math.abs(stored.angle)));
    if (!c.found) return { angle: 0, failed: true };
    return holds(c);
  }
  const c = leanContact(up, dir, others, PLANK_BOUNDS, 0, LEAN_MENU_MAX);
  if (!c.found) return { angle: 0, failed: true };
  return holds(c);
}

// 받침을 잃고 넘어진 책을 머무는 자리에 둔다(넘어지는 쪽 앞선 책부터 한 권씩: 앞서 누운 책은 뒤 책의 장애물·받침이 된다).
//  - 넘어지는 쪽에 닿을 곳이 없으면 발을 축으로 키만큼 넘어진 쪽에 눕는다(깊이는 서 있던 그대로, 오른쪽으로 넘어지면 머리가 오른쪽: flip).
//    무게중심이 선반 판 끝에서 OVERHANG_MARGIN 안쪽이 아니면 선반에서 떨어진 것이라 서랍으로 간다. 그 안이면 판 끝 밖으로 걸쳐 눕는다(overhang).
//  - 닿는 곳이 있는데 버티지 못한 책(미끄러짐)은 머리를 그 책에 댄 채 발이 넘어지는 반대쪽으로 미끄러진다: 발을 조금씩 옮기며
//    처음 닿는 각에서 버티는(힘 평형, 기운 몸이 발 뒤 책에 닿아 막히면 미끄러지지 않음) 자리에 기대 서고, 머리가 그 책을 지나면 그 앞에 눕는다.
//    배치 자리(서 있던 상자)는 뒤 책에 닿는 데까지만 옮기고, 그 너머로 미끄러진 발은 기대기의 slide로 둔다.
//  - 넘어지자마자(넘어짐 한계 안에서) 닿거나 닿은 곳이 책을 되밀면(먼저 누운 옆 책이 발 바로 앞에 있을 때) 다시 똑바로 선다(stand).
//  - 그래도 머물 자리가 없으면(발 뒤도 막혀 있다) 예전처럼 넘어진 쪽에 눕히며 옆 책을 밀고, 그 줄에 자리가 없으면 서랍으로.
const SLIDE_STEP = 1; // DU: 발을 미끄러뜨리며 머물 자리를 찾는 걸음
const MAX_FALL_SHOVE = 20; // DU: 머물 자리를 못 찾아 눕힐 때 옆 책을 밀 수 있는 거리
const NO_SHOVE = 0.5; // DU: 판 끝 밖으로 넘어진 책이 안쪽으로 미끄러질 때 옆 책을 민 것으로 보지 않는 거리

type FallRest = { kind: 'lean'; x: number; angle: number; on: string; slide?: number } | { kind: 'lie'; x: number; d: -1 | 1 } | { kind: 'stand'; x: number } | { kind: 'drawer' } | null;

// 서 있던 상자(up, 기울기 0)가 d쪽으로 넘어졌을 때 머무는 곳. others: 이 책을 뺀 그 줄의 상자(기댄 책은 기댄 자세)
// 발 뒤(넘어지는 반대쪽) 책은 미끄러지는 발을 막는 것으로만 본다: 기운 몸(그 걸음에서 처음 닿는 각의 상자)이 뒤 책에 닿으면 발이 막힌다
// (solveLeans braced와 같은 규칙). 배치는 기댄 책도 서 있던 상자로 자리를 잡으므로(layout-engine itemBoxes) 배치 자리는 서 있던
// 상자가 뒤 책에 닿는 데까지(upMax)만 옮기고, 그 너머로 미끄러진 만큼은 slide로 둔다(기운 상자는 들린 아래 모서리만큼 뒤 책과 떨어져 있다).
function fallRest(up: Placed, d: -1 | 1, others: Placed[]): FallRest {
  const T = up.size.w;
  const H = up.size.h;
  const mid = up.x + T / 2;
  const ahead = others.filter((o) => Math.sign(centerXY(o).x - mid) === d);
  const behind = others.filter((o) => Math.sign(centerXY(o).x - mid) !== d);
  // 발을 s만큼 미끄러뜨린 자리에서: 처음 닿는 곳(앞 책)과 그 기운 상자.
  // 판 끝은 넘어지는 쪽만 본다(발 쪽 판 끝은 아래 footX로: 기운 책의 뒤 아래 모서리는 들려 있어 판 끝 너머여도 된다)
  const ends = d > 0 ? { min: -Infinity, max: PLANK_BOUNDS.max } : { min: PLANK_BOUNDS.min, max: Infinity };
  // from: 이 각 아래로는 닿지 않는다(발이 앞 책에서 멀어질수록 처음 닿는 각은 커지기만 한다: 앞 걸음의 각부터 찾는다)
  const atOf = (s: number) => ({ ...up, x: up.x - d * s });
  const probe = (s: number, from = 0) => {
    const at = atOf(s);
    const c = leanContact(at, d, ahead, ends, from, 90);
    return { at, c, lean: { ...at, angle: d * c.angle } };
  };
  // 배치 자리가 옮겨 갈 수 있는 거리: 서 있던 상자가 뒤 책에 처음 닿기 직전까지(멀리 옮기면 뒤 책을 지나치므로 앞에서부터 찾는다).
  // 배치는 서 있던 상자끼리 파고들지 않게 붙이므로(layout-engine packedPositions) 허용 오차 없이 잰다
  const upHit = (s: number) => behind.some((o) => collide(atOf(s), o, 0));
  let upMax = H;
  for (let s = 0; s <= H; s += SLIDE_STEP / 2) {
    if (!upHit(s)) continue;
    let lo = Math.max(0, s - SLIDE_STEP / 2);
    let hi = s;
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      if (upHit(m)) hi = m;
      else lo = m;
    }
    upMax = lo;
    break;
  }
  const layoutX = (s: number) => up.x - d * Math.min(s, upMax);
  // 그 걸음의 몸(닿는 곳이 있으면 그 각으로 기운 상자, 없으면 서 있던 상자)이 뒤 책에 닿는다. 접촉 탐색 기준(CONTACT)으로 얕게 잡아
  // 저장할 때 각·거리를 반올림해도 다시 풀 때 허용 오차(TOLERANCE) 안에 든다
  const hits = (q: ReturnType<typeof probe>) => behind.some((o) => collide(q.c.found ? q.lean : q.at, o, CONTACT));
  const blocked = (s: number) => hits(probe(s));
  const settleAt = (q: ReturnType<typeof probe>, s: number): FallRest | 'slip' => {
    if (!q.c.found) {
      // 닿을 곳 없이 바닥까지(또는 판 끝 너머로)
      const span = fallenSpan(q.at, d);
      const center = (span.x0 + span.x1) / 2;
      if (center < PLANK_BOUNDS.min + OVERHANG_MARGIN || center > PLANK_BOUNDS.max - OVERHANG_MARGIN) return { kind: 'drawer' };
      return { kind: 'lie', x: span.x0, d };
    }
    // 무게중심이 아직 발 위인데 닿았다: 넘어지지 않고 다시 선다(서 있던 상자가 뒤 책을 넘지 않는 자리에)
    if (q.c.angle <= tipAngle(T, H)) return { kind: 'stand', x: layoutX(s) };
    const support = ahead.find((o) => o.bookId === q.c.on)!;
    const st = leanStatics(q.lean, contactOf(q.lean, support));
    // 저장할 자리·각(반올림)으로 다시 풀 때와 같은 상자로 막혔는지 본다(solveLeans braced)
    const x = layoutX(s);
    const slide = Math.round((s - Math.min(s, upMax)) * 100) / 100;
    const kept = { ...up, x: x - d * slide, angle: Math.round(d * q.c.angle * 1000) / 1000 };
    const braced = st.floor.y > 0 && Math.sign(st.floor.x) === d && isBacked(kept, -d, behind.filter((o) => !o.angle));
    if (st.ok || (st.reason === 'slip' && braced)) {
      // 배치 자리(서 있던 상자)나 기운 몸이 판 밖이면 나타낼 수 없다: 기대지 못하고 더 미끄러진다
      return inside(frontPoly({ ...up, x })) && inside(frontPoly(q.lean)) ? { kind: 'lean', x, angle: d * q.c.angle, on: q.c.on!, slide: slide > 0 ? slide : undefined } : 'slip';
    }
    // 닿은 곳이 책을 되민다(접촉 힘이 0 이하): 다시 선다
    return st.reason === 'tip' ? { kind: 'stand', x: layoutX(s) } : 'slip';
  };
  // 바닥에 닿은 발(넘어지는 쪽 아래 모서리)의 x
  const footX = (at: Placed) => (d > 0 ? at.x + T : at.x);
  let prev = 0;
  let from = 0;
  for (let s = 0; s <= H; s += SLIDE_STEP) {
    const q = probe(s, from);
    if (q.c.found) from = Math.max(0, q.c.angle - 0.5);
    // 발(바닥에 닿은 축 모서리)이 판 끝 밖으로 미끄러지면 선반에서 떨어진다. 서 있던 상자 자리는 판 끝을 넘어도 발은 두께만큼 안쪽이다
    const fx = footX(q.at);
    if (s > 0 && (fx < PLANK_BOUNDS.min || fx > PLANK_BOUNDS.max)) return { kind: 'drawer' };
    if (s > 0 && hits(q)) {
      // 기운 몸이 발 뒤 책에 막혔다: 막히기 직전(맞닿는 곳)까지 좁혀 거기서 본다(발 뒤 책이 막으면 미끄러지지 않는다)
      let lo = prev;
      let hi = s;
      for (let i = 0; i < 14; i++) {
        const m = (lo + hi) / 2;
        if (blocked(m)) hi = m;
        else lo = m;
      }
      const r = settleAt(probe(lo), lo);
      return r === 'slip' ? null : r;
    }
    const r = settleAt(q, s);
    if (r !== 'slip') return r;
    prev = s;
  }
  return null;
}

// 서로 쪽으로 넘어지는 이웃 두 권(a 오른쪽으로, b 왼쪽으로): 함께 기울여 가운데서 처음 닿는 각에서 둘 다 버티면(발 마찰, 기운 몸이 발 뒤
// 책에 닿아 막힘) 그 각(a 기준, 양수). 한 권씩 풀면 먼저 푼 책이 아직 서 있는 상대에 크게 기대다 미끄러져 눕는다. others: 두 권을 뺀 그 줄 상자
function aFrame(a: Placed, b: Placed, others: Placed[]): number | null {
  const ok = (d: number) => {
    const qa = { ...a, angle: d };
    const qb = { ...b, angle: -d };
    return !others.some((o) => collide(qa, o) || collide(qb, o)) && inside(frontPoly(qa)) && inside(frontPoly(qb));
  };
  const c = firstContact((d) => collide({ ...a, angle: d }, { ...b, angle: -d }, CONTACT) || !ok(d), 0, 90);
  if (!c.found || !ok(c.angle) || !collide({ ...a, angle: c.angle + 0.6 }, { ...b, angle: -(c.angle + 0.6) }, CONTACT)) return null;
  if (c.angle <= tipAngle(a.size.w, a.size.h) || c.angle <= tipAngle(b.size.w, b.size.h)) return null;
  const qa = { ...a, angle: c.angle };
  const qb = { ...b, angle: -c.angle };
  const holds = (q: Placed, s: Placed, dir: -1 | 1) => {
    const st = leanStatics(q, contactOf(q, s));
    return st.ok || (st.reason === 'slip' && st.floor.y > 0 && Math.sign(st.floor.x) === dir && isBacked(q, -dir, others.filter((o) => !o.angle)));
  };
  return holds(qa, qb, 1) && holds(qb, qa, -1) ? c.angle : null;
}

// simple: 머물 자리를 찾지 않고 넘어진 쪽에 눕힌다(withLeans가 같은 상태를 되풀이할 때 끊는 데만)
function layFallen(layout: ShelfLayout, books: BookMap, fallen: BookFrame[], falls: Record<string, -1 | 1>, simple = false): ShelfLayout {
  let next = layout;
  // 서로 쪽으로 넘어지는 이웃 두 권은 먼저 A자로 만나는지 본다(둘 다 같은 줄, 사이에 다른 책이 없다). 만나면 서로에게 기댄 것으로 두고 한 권씩 풀지 않는다
  const paired = new Set<string>();
  if (!simple) {
    const byX = [...fallen].sort((a, b) => a.box.x - b.box.x);
    for (let i = 0; i + 1 < byX.length; i++) {
      const a = byX[i];
      const b = byX[i + 1];
      if (a.fell !== 1 || b.fell !== -1 || a.shelfId !== b.shelfId) continue;
      const rest = next.placements.filter((q) => q.bookId !== a.bookId && q.bookId !== b.bookId);
      const others = computeShelf({ ...next, placements: rest }, books, a.shelfId).frames.map((o) => o.box);
      const ua = { ...a.box, angle: 0 };
      const ub = { ...b.box, angle: 0 };
      if (others.some((o) => centerXY(o).x > ua.x + ua.size.w / 2 && centerXY(o).x < ub.x + ub.size.w / 2)) continue;
      const c = aFrame(ua, ub, others);
      if (c === null) continue;
      const angle = Math.round(c * 1000) / 1000;
      next = {
        ...next,
        placements: next.placements.map((q) =>
          q.bookId === a.bookId ? { ...q, tilt: 7 as Tilt, lean: { angle, on: b.bookId } } : q.bookId === b.bookId ? { ...q, tilt: -7 as Tilt, lean: { angle: -angle, on: a.bookId } } : q,
        ),
      };
      paired.add(a.bookId).add(b.bookId);
      i++;
    }
  }
  // 넘어지는 쪽으로 앞선 책부터(좌우를 바꾸어도 같은 순서)
  const ahead = (f: BookFrame) => (f.fell! > 0 ? f.box.x : SHELF_USABLE_WIDTH - f.box.x - f.box.size.w);
  const order = [...fallen].filter((f) => !paired.has(f.bookId)).sort((a, b) => ahead(b) - ahead(a) || (a.bookId < b.bookId ? -1 : 1));
  for (const f of order) {
    const p = placementOf(next, f.bookId);
    if (!p) continue;
    const d = f.fell!;
    const without = { ...next, placements: next.placements.filter((q) => q.bookId !== f.bookId) };
    const others = computeShelf(without, books, p.shelfId).frames.map((o) => o.box);
    const rest = simple ? null : fallRest({ ...f.box, angle: 0 }, d, others);
    if (rest?.kind === 'drawer') {
      next = detachToDrawer(next, books, f.bookId, d, falls);
      continue;
    }
    if (rest?.kind === 'stand') {
      const desired = bookXs(next, books);
      desired.set(f.bookId, rest.x);
      const placements = next.placements.map((q) => (q.bookId === f.bookId ? { ...q, tilt: 0 as Tilt, lean: undefined, pos: rest.x } : q));
      const stood = settle(normalize({ ...next, placements }), books, desired, p.shelfId);
      if (!checkSpace(stood, books, p.shelfId)) {
        next = stood;
        continue;
      }
    }
    if (rest?.kind === 'lean') {
      const desired = bookXs(next, books);
      desired.set(f.bookId, rest.x);
      const placements = next.placements.map((q) =>
        q.bookId === f.bookId ? { ...q, tilt: tiltToward(d), lean: { angle: Math.round(rest.angle * 1000) / 1000, on: rest.on, ...(rest.slide ? { slide: rest.slide } : null) }, pos: rest.x } : q,
      );
      const leant = settle(normalize({ ...next, placements }), books, desired, p.shelfId);
      if (!checkSpace(leant, books, p.shelfId)) {
        next = leant;
        continue;
      }
    }
    const lie = rest?.kind === 'lie' ? rest.x : fallenSpan({ ...f.box, angle: 0 }, d).x0;
    const h = f.box.size.h;
    const lo = SHELF.innerLeft;
    const hi = SHELF.innerLeft + SHELF_USABLE_WIDTH;
    // x에 눕혀 본다: 옆 책이 밀린 거리(shoved)와 이 책이 넘어진 반대쪽으로 밀려난 거리(moved)
    const tryAt = (x: number) => {
      const over = x < lo - 0.01 || x + h > hi + 0.01;
      const desired = bookXs(next, books);
      desired.set(f.bookId, x);
      const placements = next.placements.map((q) =>
        q.bookId === f.bookId
          ? { ...q, pose: 'horizontal' as const, tilt: 0 as Tilt, lean: undefined, pos: x, spin: undefined, pitch: undefined, depth: f.box.z, flip: d > 0 || undefined, overhang: over || undefined }
          : q,
      );
      const laid = settle(normalize({ ...next, placements }), books, desired, p.shelfId);
      const after = bookXs(laid, books);
      const moved = ((after.get(f.bookId) ?? x) - x) * -d;
      const shoved = Math.max(0, ...[...desired].filter(([id]) => id !== f.bookId).map(([id, v]) => Math.abs((after.get(id) ?? v) - v)));
      return { laid, moved, shoved, space: !checkSpace(laid, books, p.shelfId) };
    };
    if (rest?.kind === 'lie' && (lie < lo - 0.01 || lie + h > hi + 0.01)) {
      // 판 끝 밖으로 넘어진 책(무게중심은 판 위, fallRest가 확인): 옆 책을 밀지 않고 남는 빈자리만큼 안쪽으로 미끄러져 눕는다.
      // 다 들어가지 못하면 화면에 보이는 데까지만(판 끝 너머 화면 가장자리 EDGE_PAD 안) 판 끝에 걸친다. 그래도 옆 책을 밀어야 하면 서랍으로.
      // 물리대로 걸치면 선반이 화면 폭과 같아 책이 반쯤 화면 밖으로 잘렸다(사용자 결정 2026-10-27)
      const inside = Math.max(lo, Math.min(hi - h, lie));
      const vis = Math.max(-SHELF.sideMargin + EDGE_PAD, Math.min(hi + SHELF.sideMargin - EDGE_PAD - h, lie));
      const ok = (r: ReturnType<typeof tryAt>) => r.space && Math.abs(r.moved) < 0.5 && r.shoved <= NO_SHOVE;
      const a = tryAt(inside);
      if (ok(a)) {
        next = a.laid;
        continue;
      }
      const b = tryAt(vis);
      if (!ok(b)) {
        next = detachToDrawer(next, books, f.bookId, d, falls);
        continue;
      }
      // 밀지 않는 데까지 안쪽으로(빈자리만큼)
      let good = vis;
      let bad = inside;
      let best = b;
      for (let i = 0; i < 10; i++) {
        const m = (good + bad) / 2;
        const r = tryAt(m);
        if (ok(r)) {
          good = m;
          best = r;
        } else bad = m;
      }
      next = best.laid;
      continue;
    }
    // 머물 자리를 못 찾아 넘어진 쪽에 눕힌 책은 넘어진 반대쪽으로 밀려날 수 있다(키만큼까지만 본다). 옆 책은 조금만 밀 수 있다:
    // 더 밀어야 하면 실제로는 옆 책 위에 걸쳐 눕는데 그 자세는 나타낼 수 없어 서랍으로 보낸다(알림·되돌리기)
    const x = Math.max(lo, Math.min(hi - h, lie));
    const r = tryAt(x);
    const fits = r.space && r.moved > -1 && r.moved < h && r.shoved <= MAX_FALL_SHOVE;
    next = fits ? r.laid : detachToDrawer(next, books, f.bookId, d, falls);
  }
  return next;
}

// 서랍으로 떨어진 방향은 해당 계산 결과와 함께 전달한다. 다른 미리보기·책장 계산과 공유하지 않는다.
export type FallDirections = Readonly<Record<string, -1 | 1>>;
export type LeanResolution = { layout: ShelfLayout; falls: FallDirections };

function detachToDrawer(layout: ShelfLayout, books: BookMap, bookId: string, d: -1 | 1, falls: Record<string, -1 | 1>): ShelfLayout {
  const r = moveToDrawer(layout, bookId, books);
  if (!r.ok) return layout;
  falls[bookId] = d;
  return r.layout;
}

// 불러올 때: 예전 규칙(고정 7°·8° 틈)으로 저장된 기대기 중 버티지 못하는 각(넘어짐 한계 이하)에 걸려 있던 책은
// 메뉴로 기울일 때처럼 틈을 맞춰 다시 기대게 한다(사용자가 고른 기울기를 지킨다). 자리가 모자라면 그대로 두어 withLeans가 바로 세운다.
export function ensureLeanGaps(layout: ShelfLayout, books: BookMap): { layout: ShelfLayout; changed: boolean } {
  let cur = layout;
  let changed = false;
  const leaning = (l: ShelfLayout, p: { bookId: string; shelfId: string }) => {
    const f = computeShelf(l, books, p.shelfId).frames.find((q) => q.bookId === p.bookId);
    return !!f && !!f.box.angle && !f.leanFailed && !f.fell;
  };
  for (const p of layout.placements) {
    if (p.pose !== 'spine' || p.tilt === 0 || p.stackId) continue;
    if (leaning(cur, p)) continue;
    const r = setTilt(cur, books, p.bookId, p.tilt);
    if (!r.ok || !leaning(r.layout, p)) continue;
    cur = r.layout;
    changed = true;
  }
  return { layout: cur, changed };
}

// 확정할 때 기대기 결과를 저장한다. 기댈 수 없던 책은 놓은 자리에서 바로 서고(tilt 0), 받침을 잃고 바닥까지 넘어진 책은 눕히며,
// 미는 힘에 넘어간 받침 책은 기운 책으로 저장한다. 눕힌 책이 생기면 그 줄을 다시 푼다(눕힌 책이 다른 책의 받침이 될 수 있다).
// only: 그 선반의 기대기만 다시 푼다(나머지 선반은 그대로 둔다)
export function resolveLeans(layout: ShelfLayout, books: BookMap, only?: string): LeanResolution {
  const falls: Record<string, -1 | 1> = Object.create(null);
  let cur = layout;
  const tried = new Set<string>();
  for (let pass = 0; pass < 16; pass++) {
    const result = new Map<string, BookFrame>();
    for (const shelf of cur.shelves) if (!only || shelf.id === only) for (const f of computeShelf(cur, books, shelf.id).frames) result.set(f.bookId, f);
    const next: ShelfLayout = {
      ...cur,
      placements: cur.placements.map((p) => {
        if (only && p.shelfId !== only) return p;
        const f = result.get(p.bookId);
        if (!f || p.pose !== 'spine' || f.tilt === 0 || f.stackIndex !== 0) return p.lean ? { ...p, lean: undefined } : p;
        // 기댄 상대 없이 기울기만 남은 책(밀려 넘어가다 닿기 전에 선 받침)도 선 책으로 저장한다: 기울기만 남기면 다시 열 때
        // 새로 기대려 해 배치가 바뀐다
        if (f.leanFailed || f.fell || !f.leanOn) return { ...p, tilt: 0 as Tilt, lean: undefined };
        return { ...p, tilt: f.tilt, lean: f.leanOn ? { angle: Math.round(f.box.angle * 1000) / 1000, on: f.leanOn, ...(f.slide ? { slide: f.slide } : null) } : undefined };
      }),
    };
    const fallen = [...result.values()].filter((f) => f.fell);
    if (!fallen.length) {
      // 저장한 결과를 다시 풀어도 같아야 끝난다(받침이 넘어가 기댄 책이 다른 길로 풀린 것은 저장된 각으로 다시 풀면 바뀔 수 있다)
      if (JSON.stringify(next.placements) === JSON.stringify(cur.placements)) return { layout: next, falls };
      cur = next;
      continue;
    }
    // 넘어진 책을 머물 자리에 두었는데 다시 풀면 또 같은 책이 넘어져 같은 배치로 돌아오면(되풀이) 넘어진 쪽에 눕혀 끊는다
    const key = JSON.stringify(next.placements);
    cur = layFallen(next, books, fallen, falls, tried.has(key));
    tried.add(key);
  }
  return { layout: cur, falls };
}

// 배치만 필요한 호출의 호환 함수. 떨어지는 연출에는 resolveLeans의 falls도 함께 전달한다.
export function withLeans(layout: ShelfLayout, books: BookMap, only?: string): ShelfLayout {
  return resolveLeans(layout, books, only).layout;
}

export function pointInPoly(pt: Point, poly: Point[]) {
  'worklet';
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 상자를 카메라로 투영한 외곽(설계 단위, 원점 = 책 기준선 왼쪽 끝)
export function outlineOf(cam: Cam, b: Book3): Point[] {
  'worklet';
  const out: Point[] = [];
  for (const c of corners(b)) out.push(project(cam, c));
  return hull(out);
}

// 프레임의 화면 외곽 경계 상자(설계 단위): 접근성 칸·정보 상자 자리처럼 정지한 자세로 충분한 곳
export function frameBBox(f: BookFrame, cam: Cam) {
  const poly = outlineOf(cam, fromPlaced(f.box));
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// 선반 밖에서 한 권만 그릴 때(서랍·상세): 똑바로 선 상자 하나의 프레임. 바닥 = FLOOR, 왼쪽 = 0.
export function standaloneFrame(book: Book, pose: Pose): BookFrame {
  const box: Placed = { bookId: book.id, pose, size: boxSize(book, pose), x: 0, y: 0, z: 0, angle: 0 };
  return frameOf(box, book.id, book.id, '', 0, 0);
}

// 선반 한 칸의 3D 자세(그리기·전환 경로의 입력)
export function bodiesOf(layout: ShelfLayout, books: BookMap, shelfId: string): Book3[] {
  return computeShelf(layout, books, shelfId).frames.map((f) => fromPlaced(f.box));
}
