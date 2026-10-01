// 선반 한 줄의 그리기(UI 스레드). 줄의 움직임(scene.ts Motion)에서 매 프레임 같은 3D 자세를 읽어
// 책 면(BookNode), 받는 그림자, 벽·선반 윗면 그림자, 바닥 접촉, 선택 빛을 함께 그린다. React 상태는 배치가 바뀔 때만 건드린다.
// 그리는 순서(zIndex)는 장면 전체의 가림 순서(scene.ts sceneOrder: 모든 줄의 책과 선반 판)를 따른다.
// 한 줄의 좌표 변환은 px 하나(설계 단위 → 캔버스 px, 원점 = 그 줄 책 기준선 왼쪽 끝)뿐이다.
import { BlurMask, Group, LinearGradient, Path, Skia, vec, type SkPath, type SkRect } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { corners, faceCorners, faceNormal, FACE_IDS, fromPlaced, gap, lowest, rot, type Book3, type FaceId, type Vec3 } from '@/domain/book3';
import { project, toPx, type Affine, type Cam } from '@/domain/camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_X0, SHELF_X1, VIEW_KX } from '@/domain/geometry';
import { shelfFaces } from '@/domain/shelf-geom';
import { BOX_EDGES, bookCast, type BookCast } from '@/domain/cast-shadow';
import { hull, rgba } from '@/domain/shadow-shape';
import { outlineOf, type BookFrame, type Point } from '@/domain/shelf-scene';
import { RECV_LAYER, RECV_PARTS, RECV_STOPS, recvProject, type Part, type Recv, type Recv3 } from '@/ui/book3d/received';
import { REACH_L, REACH_R, receivedShadow3 } from '@/domain/received3';
import type { Book } from '@/domain/types';
import type { Shared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import { faceMatrix, pageGeom, silhouette } from '@/ui/book3d/face-geometry';
import { colors } from '@/ui/theme';
import { shadow } from '@/ui/lighting';
import { SHOW } from '@/ui/shelf/shadow-debug';

import { scheduleOnUI } from 'react-native-worklets';

import { tryApplyPending } from './planner';
import { bodyOf, outsideRow, presentSV, type Motion } from './scene';

export type CamSV = Readonly<SharedValue<Cam>>;
type Order = Readonly<SharedValue<Record<string, number>>>;

// 그리는 순서: 순위 × 10에 책 앞뒤로 붙는 표시를 끼운다. 벽은 모든 것보다 먼저.
export const Z_WALL = -1e7;
const zOf = (order: Order, key: string, off = 0) => {
  'worklet';
  return (order.value[key] ?? 0) * 10 + off;
};

// ---------- 개발용 형상 보기: 상자 모서리 12개, 바닥 지지 영역(선반 위 투영). 일반 화면에는 나오지 않는다 ----------
function DebugGeom({ m, id, cam: camSV, px }: { m: Motion; id: string; cam: CamSV; px: Affine }) {
  const edges = useDerivedValue(() => {
    const cam = camSV.value;
    const p = Skia.PathBuilder.Make();
    const b = bodyOf(m, id);
    if (!b) return p.detach();
    const c = corners(b).map((q) => toPx(cam, px, q));
    for (const [i, j] of BOX_EDGES) {
      p.moveTo(c[i].x, c[i].y);
      p.lineTo(c[j].x, c[j].y);
    }
    return p.detach();
  });
  const support = useDerivedValue(() => {
    const cam = camSV.value;
    const b = bodyOf(m, id);
    if (!b) return pathOf([]);
    const lo = lowest(b);
    const base = corners(b).filter((q) => q.y < lo + 0.6).map((q) => toPx(cam, px, q));
    return pathOf([hull(base)]);
  });
  return (
    <Group zIndex={1e8}>
      <Path path={edges} style="stroke" strokeWidth={1} color="rgba(30,90,200,0.8)" />
      <Path path={support} color="rgba(40,170,90,0.35)" />
    </Group>
  );
}

// 계산상의 선반(shelf-geom): 윗면·앞면·옆면 외곽과 책 기준선(z=0). 그려진 판과 겹쳐 맞는지 본다.
function DebugShelf({ cam: camSV, px }: { cam: CamSV; px: Affine }) {
  const path = useDerivedValue(() => {
    const cam = camSV.value;
    const f = shelfFaces(cam);
    const P = (q: Point) => ({ x: q.x * px.s + px.tx, y: q.y * px.s + px.ty });
    const p = Skia.PathBuilder.Make();
    for (const fc of [f.top, f.front, f.side]) {
      if (!fc) continue;
      const pts = fc.poly.map(P);
      p.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) p.lineTo(q.x, q.y);
      p.close();
    }
    const a = toPx(cam, px, { x: SHELF_X0, y: 0, z: 0 });
    const b = toPx(cam, px, { x: SHELF_X1, y: 0, z: 0 });
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
    return p.detach();
  });
  return <Path path={path} zIndex={1e8} style="stroke" strokeWidth={1.2} color="rgba(200,40,150,0.85)" />;
}

// ---------- 책 ----------

// 줄의 구조(그 줄에 있는 책, 쌓인 쌍, 책 치수, 처음 보일 자세). 자세만 바뀌면 그대로라 캔버스 안 React가 다시 돌지 않는다:
// 자세는 트랙(UI 스레드)으로만 흐른다. 책이 들어오고 나가거나 쌓임이 바뀔 때만 새로 만든다.
export type RowStruct = { ids: string[]; dims: Record<string, Book3['dims']>; rest: Record<string, Book3>; stacks: [string, string][] };

const dimsKey = (d: Book3['dims']) => `${d.T.toFixed(3)},${d.H.toFixed(3)},${d.W.toFixed(3)}`;
export function structKeyOf(frames: BookFrame[]) {
  return frames.map((f) => `${f.bookId}:${f.itemKey}:${f.stackIndex}:${dimsKey(fromPlaced(f.box).dims)}`).join('|');
}
export function makeStruct(frames: BookFrame[], arrive?: Record<string, Book3>): RowStruct {
  const dims: Record<string, Book3['dims']> = {};
  const rest: Record<string, Book3> = {};
  for (const f of frames) {
    const b = arrive?.[f.bookId] ?? fromPlaced(f.box);
    rest[f.bookId] = b;
    dims[f.bookId] = b.dims;
  }
  const stacks: [string, string][] = [];
  for (const f of frames) {
    if (f.stackIndex === 0) continue;
    const lower = frames.find((g) => g.itemKey === f.itemKey && g.stackIndex === f.stackIndex - 1);
    if (lower) stacks.push([f.bookId, lower.bookId]);
  }
  return { ids: frames.map((f) => f.bookId), dims, rest, stacks };
}

const SHOW_ALL: SkRect = Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5);
const SHOW_NONE: SkRect = Skia.XYWHRect(0, 0, 0, 0);

// rest: 트랙이 아직 없을 때의 자리 표시용 자세(마운트할 때 한 번).
// 그리지 않는 때: 이 줄 움직임에 이 책 트랙이 없을 때(다른 줄로 옮겨 가서 이 캔버스에서 내려가기 직전),
// 제 줄 공간 밖에 걸친 동안(다른 줄로 옮겨 가는 중). 그동안은 이동 캔버스가 그린다.
// 첫 그림을 낸 뒤 '올라감'을 알린다(그 전에는 이동 캔버스가 대신 그린다).
const RowBook = memo(
  function RowBook({ m, shelfId, id, dims, rest, book, cam, px, shared, recv, order, space }: { m: Motion; shelfId: string; id: string; dims: Book3['dims']; rest: Book3; book: Book; cam: CamSV; px: Affine; shared: Shared; recv?: { ids: string[]; space: number; plankAbove: boolean; debug?: boolean }; order: Order; space: number }) {
    const first = useMemo(() => rest, []); // eslint-disable-line react-hooks/exhaustive-deps
    const state = useDerivedValue(() => bodyOf(m, id) ?? first);
    const clip = useDerivedValue<SkRect>(() => {
      const b = bodyOf(m, id);
      return !b || outsideRow(b, space) ? SHOW_NONE : SHOW_ALL;
    });
    // 캔버스 안 효과는 그 캔버스를 다시 기록해 첫 그림을 UI로 보낸 뒤에 돈다: 이때부터 이 줄이 이 책을 그린다
    useEffect(() => {
      scheduleOnUI(() => {
        'worklet';
        presentSV.value = { ...presentSV.value, [id]: shelfId };
        // 이 책을 기다리며 미뤄 둔 경로가 있으면 이제 움직인다
        tryApplyPending();
      });
      return () => {
        scheduleOnUI(() => {
          'worklet';
          if (presentSV.value[id] !== shelfId) return;
          const next = { ...presentSV.value };
          delete next[id];
          presentSV.value = next;
        });
      };
    }, [id, shelfId]);
    const under = recv ? <BookReceives m={m} id={id} ids={recv.ids} cam={cam} px={px} space={recv.space} plankAbove={recv.plankAbove} debug={recv.debug} /> : null;
    const z = useDerivedValue(() => zOf(order, id));
    return <BookNode book={book} dims={dims} state={state} cam={cam} px={px} shared={shared} under={under} order={z} clip={clip} />;
  },
  (a, b) =>
    a.m === b.m && a.shelfId === b.shelfId && a.id === b.id && a.book === b.book && dimsKey(a.dims) === dimsKey(b.dims) && a.cam === b.cam && a.px === b.px && a.shared === b.shared && a.space === b.space &&
    a.recv?.ids.join('|') === b.recv?.ids.join('|') && a.recv?.space === b.recv?.space && a.recv?.plankAbove === b.recv?.plankAbove && a.recv?.debug === b.recv?.debug && a.order === b.order,
);

// 한 줄의 책과 그 줄에 붙는 표시(선택 빛·놓일 범위·쌓기 접촉·기대기 접촉). 캔버스 안에 형제로 펼쳐 넣는다(가림 순서가 zIndex로 섞이게).
// shared는 캔버스 밖에서 읽어 넘긴다(캔버스 안에는 React 컨텍스트가 닿지 않는다).
export const RowBooks = memo(function RowBooks({ m, shelfId, st, books, glowId = null, dragId = null, cam, px, space, shared, order, debug = false, plankAbove = false }: { m: Motion; shelfId: string; st: RowStruct; books: Record<string, Book>; glowId?: string | null; dragId?: string | null; cam: CamSV; px: Affine; space: number; shared: Shared; order: Order; debug?: boolean; plankAbove?: boolean }) {
  // 책 면이 받는 그림자의 가리개 후보(같은 줄의 다른 책 + 윗 선반 판)
  const ids = st.ids;
  const recv = useMemo(() => (SHOW.cast ? { ids, space, plankAbove, debug } : undefined), [ids, space, plankAbove, debug]);
  return (
    <>
      {ids.map((id) => (
        <RowBook key={id} m={m} shelfId={shelfId} id={id} dims={st.dims[id]} rest={st.rest[id]} book={books[id]} cam={cam} px={px} shared={shared} recv={recv} order={order} space={space} />
      ))}
      {/* 끄는 책이 놓일 가로 범위: 선반 앞턱에 얇게(끄는 동안만) */}
      {dragId && ids.includes(dragId) ? <LipRange m={m} id={dragId} cam={cam} px={px} order={order} /> : null}
      {glowId && ids.includes(glowId) ? <SelectGlow m={m} id={glowId} cam={cam} px={px} order={order} space={space} /> : null}
      {debug ? ids.map((id) => <DebugGeom key={`dbg${id}`} m={m} id={id} cam={cam} px={px} />) : null}
      {debug ? <DebugShelf cam={cam} px={px} /> : null}
      {SHOW.stack ? st.stacks.map(([up, lo]) => <StackShade key={`sh${up}`} m={m} id={up} lowerId={lo} cam={cam} px={px} order={order} space={space} />) : null}
      {SHOW.lean ? <LeanContacts m={m} ids={ids} cam={cam} px={px} order={order} space={space} /> : null}
    </>
  );
});

// 끄는 책이 놓일 가로 범위: 책 바닥의 좌우 끝을 선반 앞턱(판 앞 윗모서리) 바로 아래에 얇은 선으로.
// 3°처럼 앞 책에 가려 자리가 잘 안 보일 때도 어디에 놓이는지 읽히게. 끄는 동안만(상시 선택 막대가 아니다).
function LipRange({ m, id, cam, px, order }: { m: Motion; id: string; cam: CamSV; px: Affine; order: Order }) {
  const z = useDerivedValue(() => zOf(order, id, 8));
  const path = useDerivedValue(() => {
    const b = bodyOf(m, id);
    const p = Skia.PathBuilder.Make();
    if (!b) return p.detach();
    let x0 = Infinity;
    let x1 = -Infinity;
    const lo = lowest(b);
    for (const c of corners(b)) {
      if (c.y > lo + 0.6) continue;
      x0 = Math.min(x0, c.x);
      x1 = Math.max(x1, c.x);
    }
    // 판 앞면 위쪽 1.5DU 아래(3D): 앞턱 모서리 바로 아래 앞면에 긋는다
    const a = toPx(cam.value, px, { x: x0, y: -1.5, z: -SHELF_FRONT });
    const e = toPx(cam.value, px, { x: x1, y: -1.5, z: -SHELF_FRONT });
    p.moveTo(a.x, a.y);
    p.lineTo(e.x, e.y);
    return p.detach();
  });
  return (
    <Group zIndex={z}>
      <Path path={path} style="stroke" strokeWidth={1.6 * px.s} strokeCap="round" color={colors.dropRange} />
    </Group>
  );
}

// 고른 한 권(정보 상자·꾸미기): 보이는 윤곽 바깥으로 따뜻한 얇은 선과 좁은 번짐(책 면·글자는 덮지 않는다, 책은 들어 올리지 않는다).
// 그 책 바로 뒤 순서로 그려 선의 안쪽 절반과 앞에 있는 책이 빛을 가리고, 바닥 면(받치는 면) 아래로는 새지 않게 바닥 면에서 자른다.
function SelectGlow({ m, id, cam, px, order, space }: { m: Motion; id: string; cam: CamSV; px: Affine; order: Order; space: number }) {
  const z = useDerivedValue(() => zOf(order, id, -3));
  const body = useDerivedValue(() => {
    const b = bodyOf(m, id);
    return !b || outsideRow(b, space) ? null : b;
  });
  return <GlowOf body={body} cam={cam} px={px} z={z} />;
}

// 윤곽 빛(책 한 권의 지금 자세 body, 없으면 그리지 않는다). 줄 캔버스와 이동 캔버스가 같이 쓴다.
export function GlowOf({ body, cam, px, z }: { body: Readonly<SharedValue<Book3 | null>>; cam: CamSV; px: Affine; z: Readonly<SharedValue<number>> | number }) {
  const shape = useDerivedValue(() => {
    const b = body.value;
    if (!b) return { path: pathOf([]), clip: Skia.XYWHRect(0, 0, 0, 0) };
    const pts = outlineOf(cam.value, b).map((q) => ({ x: q.x * px.s + px.tx, y: q.y * px.s + px.ty }));
    let bottom = -Infinity;
    for (const q of pts) bottom = Math.max(bottom, q.y);
    return { path: pathOf([pts]), clip: Skia.XYWHRect(-4000, bottom - 4000, 8000, 4000) };
  });
  const path = useDerivedValue(() => shape.value.path);
  const clip = useDerivedValue(() => shape.value.clip);
  return (
    <Group zIndex={z} clip={clip}>
      <Path path={path} color={colors.selectGlow} opacity={0.65}>
        <BlurMask blur={3.2 * px.s} style="outer" />
      </Path>
      <Path path={path} style="stroke" strokeWidth={3 * px.s} strokeJoin="round" color={colors.selectGlow} opacity={0.95} />
    </Group>
  );
}

// ---------- 벽 그림자·바닥 접촉 ----------

function pathOf(polys: Point[][]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (const pts of polys) {
    if (pts.length < 2) continue;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

// ---------- 실제 그림자: 광원 방향으로 받는 면에 투영 ----------
// 책 → 벽·선반 윗면 층의 3D 점은 domain/cast-shadow bookCast(한 모델)가 만들고, 여기서는 투영·흐림·층 합성만 한다.
// 시점을 끄는 동안에는 투영만 다시 하고, 책이 움직일 때만 3D 계산을 다시 한다.
const NO_PATH = Skia.PathBuilder.Make().detach();
type Cast3 = BookCast;

function castPath(cam: Cam, c: Cast3, px: Affine): SkPath {
  'worklet';
  if (!c) return NO_PATH;
  const pts: Point[] = [];
  for (const q of c.pts) pts.push(toPx(cam, px, q));
  return pathOf([hull(pts)]);
}

// 그림자 한 권·한 층: 불투명하게 그려 층(CastLayer) 안에서 합쳐지게 한다
function CastShadow({ m, id, of, k, cam, px, color }: { m: Motion; id: string; of: (b: Book3, k: number) => Cast3; k: number; cam: CamSV; px: Affine; color: string }) {
  const c = useDerivedValue(() => {
    const b = bodyOf(m, id);
    return b ? of(b, k) : null;
  });
  const path = useDerivedValue(() => castPath(cam.value, c.value, px));
  const blur = useDerivedValue(() => (c.value ? c.value.blur / 2 : 0));
  const op = useDerivedValue(() => c.value?.w ?? 1);
  return (
    <Path path={path} color={color} opacity={op}>
      <BlurMask blur={blur} style="normal" />
    </Path>
  );
}

// 한 층의 그림자들을 한 장에 합친 뒤 층 진하기로 한 번만 얹는다(같은 광원의 그림자가 겹쳐도 계속 어두워지지 않는다)
function CastLayer({ m, ids, of, k, opacity, color = shadow.color, cam, px }: { m: Motion; ids: string[]; of: (b: Book3, k: number) => Cast3; k: number; opacity: number; color?: string; cam: CamSV; px: Affine }) {
  const paint = useMemo(() => {
    const p = Skia.Paint();
    p.setAlphaf(opacity);
    return p;
  }, [opacity]);
  return (
    <Group layer={paint}>
      {ids.map((id) => (
        <CastShadow key={id} m={m} id={id} of={of} k={k} cam={cam} px={px} color={color} />
      ))}
    </Group>
  );
}

// 책 사이 틈 어둠(벽 쪽): 앞줄에 선 책끼리 틈이 좁을수록 진하고 fadeAt 이상이면 없다. 틈 영역 안에만.
function gapShapes(m: Motion, ids: string[], cam: Cam, px: Affine) {
  'worklet';
  const g = shadow.ao.gap;
  const row: { lo: number; hi: number; top: number; z: number }[] = [];
  for (const id of ids) {
    const b = bodyOf(m, id);
    if (!b || Math.abs(lowest(b)) > 0.5) continue;
    const cs = corners(b);
    let lo = Infinity;
    let hi = -Infinity;
    let top = 0;
    let z = Infinity;
    for (const c of cs) {
      lo = Math.min(lo, c.x);
      hi = Math.max(hi, c.x);
      top = Math.max(top, c.y);
      z = Math.min(z, c.z);
    }
    if (z < 5) row.push({ lo, hi, top, z });
  }
  row.sort((a, b) => a.lo - b.lo);
  const out: { rect: Point[]; a: number }[] = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const d = row[i + 1].lo - row[i].hi;
    if (d <= 0.2 || d >= g.fadeAt) continue;
    const h = Math.min(row[i].top, row[i + 1].top);
    const P = (x: number, y: number) => toPx(cam, px, { x, y, z: 0 });
    out.push({ rect: [P(row[i].hi, h), P(row[i + 1].lo, h), P(row[i + 1].lo, 0), P(row[i].hi, 0)], a: g.max * (1 - d / g.fadeAt) });
  }
  return out;
}

function GapShade({ m, ids, cam, px, band }: { m: Motion; ids: string[]; cam: CamSV; px: Affine; band: number }) {
  // 진하기 단계(band)별로 한 경로씩: 틈마다 색이 달라서
  const path = useDerivedValue(() => {
    const polys: Point[][] = [];
    for (const g of gapShapes(m, ids, cam.value, px)) {
      const lvl = Math.min(3, Math.floor((g.a / shadow.ao.gap.max) * 4));
      if (lvl === band) polys.push(g.rect);
    }
    return pathOf(polys);
  });
  return <Path path={path} color={rgba(shadow.color, shadow.ao.gap.max * ((band + 0.5) / 4))} />;
}

// 기댄 책이 받치는 책에 닿는 곳: 닿는 점에 좁고 진한 어둠, 그 아래 벌어진 틈은 넓어지며 부드럽게 옅어진다.
// 쐐기 = [닿는 점, 받치는 책 쪽 바닥, 기댄 책 바닥 모서리]. 받치는 책의 옆면·틈 너머 벽이 받는 면이다.
function leanContactShapes(m: Motion, ids: string[], cam: Cam, px: Affine) {
  'worklet';
  const out: { id: string; tri: Point[]; top: Point; mid: Point }[] = [];
  for (const id of ids) {
    const b = bodyOf(m, id);
    if (!b || Math.abs(b.roll) < 1 || Math.abs(b.roll) > 45 || Math.abs(lowest(b)) > 0.5) continue;
    // 받치는 책에 실제로 닿아 있을 때만(허공으로 기운 책·기울이는 도중 떨어져 있는 책에는 접촉 어둠이 없다)
    let touching = false;
    for (const o of ids) {
      if (o === id) continue;
      const ob = bodyOf(m, o);
      if (ob && gap(b, ob) < 0.6) touching = true;
    }
    if (!touching) continue;
    const dir = b.roll > 0 ? 1 : -1;
    const cs = corners(b);
    let top = cs[0];
    let foot = cs[0];
    for (const c of cs) {
      if (c.x * dir > top.x * dir + 1e-6 || (Math.abs(c.x - top.x) < 1e-6 && c.z < top.z)) top = c;
      if (c.y < 0.5 && (c.x * dir > foot.x * dir + 1e-6 || foot.y >= 0.5)) foot = c;
    }
    const A = toPx(cam, px, { x: top.x, y: top.y, z: top.z });
    const B = toPx(cam, px, { x: top.x, y: 0, z: top.z });
    const C = toPx(cam, px, { x: foot.x, y: 0, z: top.z });
    out.push({ id, tri: [A, B, C], top: A, mid: { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 } });
  }
  return out;
}

function LeanContacts({ m, ids, cam, px, order }: { m: Motion; ids: string[]; cam: CamSV; px: Affine; order: Order; space: number }) {
  const w = useDerivedValue(() => leanContactShapes(m, ids, cam.value, px));
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <LeanContact key={i} w={w} i={i} s={px.s} order={order} />
      ))}
    </>
  );
}

function LeanContact({ w, i, s, order }: { w: Readonly<SharedValue<{ id: string; tri: Point[]; top: Point; mid: Point }[]>>; i: number; s: number; order: Order }) {
  // 기댄 책 바로 뒤 순서(받치는 책 옆면·틈 위에, 기댄 책 앞면 아래)
  const z = useDerivedValue(() => (w.value[i] ? zOf(order, w.value[i].id, -1) : -1e9));
  const tri = useDerivedValue(() => pathOf(w.value[i] ? [w.value[i].tri] : []));
  const a = useDerivedValue(() => vec(w.value[i]?.top.x ?? 0, w.value[i]?.top.y ?? 0));
  const b = useDerivedValue(() => vec(w.value[i]?.mid.x ?? 0, w.value[i]?.mid.y ?? 1));
  const dot = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const t = w.value[i]?.top;
    if (t) p.addOval(Skia.XYWHRect(t.x - 1.6 * s, t.y - 0.6 * s, 3.2 * s, 5 * s));
    return p.detach();
  });
  const L = shadow.ao.lean;
  return (
    <Group zIndex={z}>
      <Path path={tri}>
        <LinearGradient start={a} end={b} colors={[rgba(shadow.color, L.near), rgba(shadow.color, L.far)]} />
        <BlurMask blur={1.2 * s} style="normal" />
      </Path>
      <Path path={dot} color={rgba(shadow.color, L.touch)}>
        <BlurMask blur={1 * s} style="normal" />
      </Path>
    </Group>
  );
}

// ---------- 책 면이 받는 그림자: 다른 책 · 윗 선반 판 ----------
// 3D 단계(receivedShadow3)는 domain/received3(카메라와 무관, 순수), 투영은 received.ts recvProject.
// 이 책에 그림자를 드리울 수 있는 이웃: 빛이 왼쪽 위 앞에서 오므로 그림자는 가리개 오른쪽으로 떨어진다.
// 이 책의 가로 범위에서 왼쪽으로 REACH_L, 오른쪽으로 REACH_R 안에 걸친 책만 가리개 후보다(멀리 있는 책이 움직여도 이 책은 다시 계산하지 않는다).
export function occluderBodies(m: Motion, id: string, ids: string[]): { b: Book3 | null; occ: Book3[] } {
  'worklet';
  const b = bodyOf(m, id);
  if (!b) return { b: null, occ: [] };
  const xr = (q: Book3) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of corners(q)) {
      lo = Math.min(lo, c.x);
      hi = Math.max(hi, c.x);
    }
    return { lo, hi };
  };
  const me = xr(b);
  const occ: Book3[] = [];
  for (const o of ids) {
    if (o === id) continue;
    const ob = bodyOf(m, o);
    if (!ob) continue;
    const r = xr(ob);
    if (r.hi < me.lo - REACH_L || r.lo > me.hi + REACH_R) continue;
    occ.push(ob);
  }
  return { b, occ };
}

const EMPTY_PATH = Skia.PathBuilder.Make().detach();
const CLEAR4 = ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'];
const NO_PART: Part = { path: EMPTY_PATH, blur: 0, a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, colors: CLEAR4 };

function RecvPart({ r, k }: { r: Readonly<SharedValue<Recv>>; k: number }) {
  const part = useDerivedValue(() => r.value.parts[k] ?? NO_PART);
  const path = useDerivedValue(() => part.value.path);
  const blur = useDerivedValue(() => part.value.blur / 2);
  const a = useDerivedValue(() => vec(part.value.a.x, part.value.a.y));
  const b = useDerivedValue(() => vec(part.value.b.x, part.value.b.y));
  const colors = useDerivedValue(() => part.value.colors);
  return (
    <Path path={path}>
      <LinearGradient start={a} end={b} colors={colors} positions={RECV_STOPS} />
      <BlurMask blur={blur} style="normal" />
    </Path>
  );
}

// 개발용: 계산된 그림자 외곽(빨강)과 받는 면(초록)
function RecvDebug({ r }: { r: Readonly<SharedValue<Recv>> }) {
  const outline = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    for (const q of r.value.parts) p.addPath(q.path);
    return p.detach();
  });
  const clip = useDerivedValue(() => r.value.clip);
  return (
    <>
      <Path path={outline} style="stroke" strokeWidth={1} color="rgba(220,40,40,0.9)" />
      <Path path={clip} style="stroke" strokeWidth={1} color="rgba(30,160,60,0.9)" />
    </>
  );
}

function ReceivedShadow({ r3, cam, px, slot, debug }: { r3: Readonly<SharedValue<Recv3>>; cam: CamSV; px: Affine; slot: number; debug?: boolean }) {
  const r = useDerivedValue(() => recvProject(r3.value, cam.value, px, slot));
  const clip = useDerivedValue(() => r.value.clip);
  const paint = useMemo(() => {
    const p = Skia.Paint();
    p.setAlphaf(RECV_LAYER);
    return p;
  }, []);
  return (
    <>
      <Group clip={clip} layer={paint}>
        {Array.from({ length: RECV_PARTS }, (_, k) => (
          <RecvPart key={k} r={r} k={k} />
        ))}
      </Group>
      {debug ? <RecvDebug r={r} /> : null}
    </>
  );
}

// 한 책이 받는 그림자 전부(보이는 면마다, 다른 책·윗 선반 판을 합쳐서). 책 그룹 안, 면 다음·갈피 전에 그린다(BookNode의 under).
export function BookReceives({ m, id, ids, cam, px, space, plankAbove, debug }: { m: Motion; id: string; ids: string[]; cam: CamSV; px: Affine; space: number; plankAbove: boolean; debug?: boolean }) {
  const castPlank = SHOW.castPlank;
  // 이 책과 가리개 후보(드리울 수 있는 범위의 이웃)의 자세 서명이 바뀔 때만 다시 계산한다. 옮긴 책과 그 그림자를 받는 이웃만
  // 다시 계산되고, 줄의 다른 책은 끄는 동안에도 계산하지 않는다. (결과를 담는 값을 같은 계산 안에서 쓰면 움직이는 책이 있을 때
  // 계산이 자기 자신을 계속 다시 불러, 반응으로 나눈다)
  // 처음 값(마운트할 때 한 번): 반응이 UI에서 처음 돌기 전 한 프레임도 그림자가 비지 않게
  const init = useMemo(() => {
    const o = occluderBodies(m, id, ids);
    return receivedShadow3(o.b, o.occ, px.s, space, plankAbove, castPlank);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r3 = useSharedValue<Recv3>(init);
  useAnimatedReaction(
    () => {
      const { b, occ } = occluderBodies(m, id, ids);
      let sig = '';
      for (const q of b ? [b, ...occ] : []) sig += `${q.id}:${q.t.x.toFixed(2)},${q.t.y.toFixed(2)},${q.t.z.toFixed(2)},${q.roll.toFixed(2)},${q.yaw.toFixed(2)},${(q.spin ?? 0).toFixed(2)},${(q.pitch ?? 0).toFixed(2)};`;
      return sig;
    },
    (sig, prev) => {
      if (sig === prev) return;
      const { b, occ } = occluderBodies(m, id, ids);
      r3.value = receivedShadow3(b, occ, px.s, space, plankAbove, castPlank);
    },
  );
  return (
    <Group>
      {[0, 1, 2].map((slot) => (
        <ReceivedShadow key={slot} r3={r3} cam={cam} px={px} slot={slot} debug={debug} />
      ))}
    </Group>
  );
}

// 벽 단계(판보다 먼저): 책 → 벽 실제 그림자 + 책 사이 틈 어둠(주변광 차폐)
export const RowShadows = memo(function RowShadows({ m, ids, cam, px, space }: { m: Motion; ids: string[]; cam: CamSV; px: Affine; space: number }) {
  const s = px.s;
  // 제 줄 공간 밖에 걸친 책(다른 줄로 옮겨 가는 중)은 벽 그림자를 드리우지 않는다(그 줄의 벽은 이 캔버스가 아니다)
  const of = useMemo(() => (b: Book3, k: number) => {
    'worklet';
    return outsideRow(b, space) ? null : bookCast(b, s, k, true);
  }, [s, space]);
  // 선반 위 책이 벽에 드리우는 그림자는 판 윗면이 벽에 닿는 선 위에만: 그 아래 벽으로 가는 빛은 판 윗면을 지나야 해서 책이 가릴 수 없다
  const clip = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const wall = toPx(cam.value, px, { x: 0, y: 0, z: SHELF_DEPTH }).y;
    p.addRect(Skia.XYWHRect(-2000, wall - 4000, 6000, 4000));
    return p.detach();
  });
  return (
    <Group zIndex={Z_WALL + 1}>
      <Group clip={clip}>
        {SHOW.wall ? shadow.cast.book.layers.map((_, k) => <CastLayer key={k} m={m} ids={ids} of={of} k={k} opacity={shadow.cast.book.opacity[k]} color={shadow.cast.book.color} cam={cam} px={px} />) : null}
      </Group>
      {SHOW.gap ? [0, 1, 2, 3].map((b) => <GapShade key={b} m={m} ids={ids} cam={cam} px={px} band={b} />) : null}
    </Group>
  );
});

// 바닥 접촉: 선반에 닿는 바닥 꼭짓점(가장 낮은 점 근처)의 투영.
function footOf(b: Book3) {
  'worklet';
  const cs = corners(b);
  const lo = lowest(b);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let top = 0;
  for (const c of cs) {
    top = Math.max(top, c.y);
    if (c.y >= lo + 0.6) continue;
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x);
    z0 = Math.min(z0, c.z);
    z1 = Math.max(z1, c.z);
  }
  if (x1 - x0 < 2) {
    x0 -= 1;
    x1 += 1;
  }
  return { x0, x1, z0, z1, y: lo, top };
}

// 바닥 면(받치는 면에 닿는 모서리들)을 선반 위 실제 모양 그대로: 돌린 책이면 돌린 사각형. 모서리만 닿으면(기댄 책) 좁은 띠.
function footPoly(b: Book3): { pts: { x: number; z: number }[]; y: number } {
  'worklet';
  const cs = corners(b);
  const lo = lowest(b);
  const pts: { x: number; z: number }[] = [];
  for (const c of cs) if (c.y < lo + 0.6) pts.push({ x: c.x, z: c.z });
  if (pts.length < 3) {
    const f = footOf(b);
    return { pts: [{ x: f.x0, z: f.z0 }, { x: f.x1, z: f.z0 }, { x: f.x1, z: f.z1 }, { x: f.x0, z: f.z1 }], y: lo };
  }
  let cx = 0;
  let cz = 0;
  for (const q of pts) {
    cx += q.x / pts.length;
    cz += q.z / pts.length;
  }
  // 위에서 보아 앞(z 작은 쪽) 왼쪽부터 시계 반대 방향: 앞 → 오른쪽 → 뒤 → 왼쪽
  pts.sort((a, c) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(c.z - cz, c.x - cx));
  return { pts, y: lo };
}

// 앞 접촉 어둠(주변광 차폐): 책 앞 바닥 모서리에서 사용자 쪽으로 판 윗면 위에 퍼지는 층(3D, 판 앞 끝까지).
// 가까울수록 진하도록 깊이가 다른 층을 겹친다: 얕은 각(3°)에서는 얇은 선, 내려다볼수록(8°) 넓게 보인다(화면 좌표 띠가 아니다).
const CONTACT_LAYERS = [2.5, 9, 24];
const CONTACT_ALPHA = [0.14, 0.09, 0.05];
function contactShapes(b: Book3, cam: Cam, px: Affine) {
  'worklet';
  const f = footPoly(b);
  const P = (x: number, z: number) => toPx(cam, px, { x, y: f.y, z });
  const layers: Point[][][] = CONTACT_LAYERS.map(() => []);
  const n = f.pts.length;
  for (let i = 0; i < n; i++) {
    const a = f.pts[i];
    const e = f.pts[(i + 1) % n];
    // 시계 반대 순서의 바깥 법선(x-z 평면): (dz, -dx). 사용자 쪽(-z)을 향한 바닥 모서리만
    const nx = e.z - a.z;
    const nz = -(e.x - a.x);
    const l = Math.hypot(nx, nz) || 1;
    if (nz / l > -0.3) continue;
    CONTACT_LAYERS.forEach((d, k) => {
      const za = Math.max(-SHELF_FRONT, a.z - d);
      const ze = Math.max(-SHELF_FRONT, e.z - d);
      layers[k].push([P(a.x, a.z), P(e.x, e.z), P(e.x, ze), P(a.x, za)]);
    });
  }
  return { layers, foot: f.pts.map((q) => P(q.x, q.z)) };
}

const LIFT_FADE = 14; // 이 높이(DU)보다 들린 책은 선반 윗면에 그림자를 드리우지 않는다(그 사이는 옅어진다)

// 선반 윗면 위(그 줄 판 바로 다음, 책들보다 먼저): 책 → 선반 윗면 그림자, 바닥 자리, 앞 접촉 띠. 선반 윗면 안에만.
export const RowContacts = memo(function RowContacts({ m, ids, cam, px, order, shelfId }: { m: Motion; ids: string[]; cam: CamSV; px: Affine; order: Order; shelfId: string }) {
  const s = px.s;
  const z = useDerivedValue(() => zOf(order, `plank:${shelfId}`, 5));
  // 선반에서 떨어진(쌓인 위·들어 올린) 책은 접촉이 없다
  const shapes = useDerivedValue(() => {
    const layers: Point[][][] = CONTACT_LAYERS.map(() => []);
    const foot: Point[][] = [];
    for (const id of ids) {
      const b = bodyOf(m, id);
      if (!b || Math.abs(lowest(b)) > 0.5) continue;
      const c = contactShapes(b, cam.value, px);
      c.layers.forEach((ls, k) => {
        for (const q of ls) layers[k].push(q);
      });
      foot.push(c.foot);
    }
    return { layers: layers.map((ls) => pathOf(ls)), foot: pathOf(foot) };
  });
  const of = useMemo(() => (b: Book3, k: number) => {
    'worklet';
    // 들어 올린 책은 높이에 따라 옅어지고(빛 방향으로 밀려 흐려지는 것은 투영이 한다), 다른 줄에 가 있는 책·쌓인 위 책은 없다
    // (쌓인 위 책의 그림자는 아래 책이 받는다: 아래 책 윗면에 닿아 있으면 들린 높이가 아래 책 두께다)
    const h = lowest(b);
    if (h < -0.5 || h > LIFT_FADE) return null;
    const c = bookCast(b, s, k, false);
    return c && h > 0.5 ? { ...c, w: c.w * Math.exp(-(h - 0.5) / (LIFT_FADE / 3)) } : c;
  }, [s]);
  const band0 = useDerivedValue(() => shapes.value.layers[0]);
  const band1 = useDerivedValue(() => shapes.value.layers[1]);
  const band2 = useDerivedValue(() => shapes.value.layers[2]);
  const foot = useDerivedValue(() => shapes.value.foot);
  // 선반 윗면(투영된 실제 윗면 다각형) 안에만(받는 면 클리핑)
  const clip = useDerivedValue(() => {
    const f = shelfFaces(cam.value);
    return pathOf([f.top.poly.map((q) => ({ x: q.x * px.s + px.tx, y: q.y * px.s + px.ty }))]);
  });
  return (
    <Group zIndex={z} clip={clip}>
      {/* 실제 그림자: 책 → 선반 윗면 */}
      {SHOW.shelfCast ? shadow.cast.book.layers.map((_, k) => <CastLayer key={k} m={m} ids={ids} of={of} k={k} opacity={shadow.cast.book.opacity[k]} color={shadow.cast.book.color} cam={cam} px={px} />) : null}
      {/* 주변광 차폐: 바닥 자리 */}
      {SHOW.contact ? (
        <Path path={foot} color={rgba(shadow.color, shadow.ao.foot.opacity)}>
          <BlurMask blur={(shadow.ao.contact.blur / 4) * s} style="normal" />
        </Path>
      ) : null}
      {/* 앞 접촉 어둠: 선반 윗면 위 3D 층(책보다 먼저 그려 앞에 선 책이 가린다) */}
      {SHOW.contact
        ? [band0, band1, band2].map((p, k) => (
            <Path key={k} path={p} color={rgba(shadow.color, CONTACT_ALPHA[k])}>
              <BlurMask blur={(0.5 + k * 0.6) * s} style="normal" />
            </Path>
          ))
        : null}
    </Group>
  );
});

// 쌓인 책의 접촉(주변광 차폐): 위 책 바닥이 닿은 자리 둘레가 아래 책 윗면에서 좁게 어두워진다. 아래 책 윗면 안에만.
// 위 책이 드리우는 그림자(돌출 부분이 아래 책 앞면에 떨어지는 것 등)는 BookReceives의 실제 그림자가 맡는다.
export function StackShade({ m, id, lowerId, cam: camSV, px, order, space }: { m: Motion; id: string; lowerId: string; cam: CamSV; px: Affine; order: Order; space: number }) {
  // 위 책 바로 전(아래 책 윗면 위, 위 책 아래)
  const z = useDerivedValue(() => zOf(order, id, -5));
  const g = useDerivedValue(() => {
    const cam = camSV.value;
    const up = bodyOf(m, id);
    const lo = bodyOf(m, lowerId);
    if (!up || !lo || lowest(up) < 0.5 || outsideRow(up, space) || outsideRow(lo, space)) return { top: pathOf([]), foot: pathOf([]) };
    const P = (q: Vec3) => toPx(cam, px, q);
    const lc = corners(lo);
    // 아래 책 윗면(법선이 가장 위를 향한 면)
    let upF: FaceId = 'cover';
    let best = -Infinity;
    for (const fid of FACE_IDS) {
      const ny = rot(lo.roll, lo.yaw, faceNormal(fid), lo.spin ?? 0, lo.pitch ?? 0).y;
      if (ny > best) {
        best = ny;
        upF = fid;
      }
    }
    const f = footPoly(up);
    return { top: pathOf([faceCorners(upF).map((i) => P(lc[i]))]), foot: pathOf([f.pts.map((q) => P({ x: q.x, y: f.y, z: q.z }))]) };
  });
  const top = useDerivedValue(() => g.value.top);
  const foot = useDerivedValue(() => g.value.foot);
  return (
    <Group zIndex={z} clip={top}>
      <Path path={foot} style="stroke" strokeWidth={1.6 * px.s} strokeJoin="round" color={rgba(shadow.color, shadow.ao.stack.opacity)}>
        <BlurMask blur={(shadow.ao.stack.blur / 2) * px.s} style="normal" />
      </Path>
    </Group>
  );
}

// ---------- 측정용: 투영 계산만 따로 잰다(그리기·React 없이) ----------
// 지금 자세 그대로 카메라만 3°→8°로 n번 바꿔 가며, 매 프레임 시점 전환 때 도는 투영 단계와 같은 함수를 부른다.
// 3D 단계(받는 그림자·벽/선반 그림자의 3D 점)는 책이 움직일 때만 도는 것이라 따로 한 번 잰다.
export type BenchRow = { m: Motion; px: Affine; space: number; plankAbove: boolean };
export function benchProjection(rows: BenchRow[], s: number, n: number) {
  'worklet';
  const clock = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
  type Prep = { b: Book3; id: string; r3: Recv3; wall: Cast3[]; shelf: Cast3[]; px: Affine };
  const prep: Prep[] = [];
  const t0 = clock();
  for (const r of rows) {
    const ids = Object.keys(r.m.tracks.value);
    for (const id of ids) {
      const b = bodyOf(r.m, id);
      if (!b) continue;
      const wall: Cast3[] = [];
      const shelf: Cast3[] = [];
      for (let k = 0; k < shadow.cast.book.layers.length; k++) wall.push(bookCast(b, s, k, true));
      for (let k = 0; k < shadow.cast.book.layers.length; k++) shelf.push(lowest(b) > 0.5 ? null : bookCast(b, s, k, false));
      const oc = occluderBodies(r.m, id, ids);
      prep.push({ b, id, r3: receivedShadow3(oc.b, oc.occ, s, r.space, r.plankAbove), wall, shelf, px: r.px });
    }
  }
  const t3d = clock() - t0;
  let tGeom = 0;
  let tRecv = 0;
  let tCast = 0;
  for (let i = 0; i < n; i++) {
    const deg = 3 + (5 * i) / Math.max(1, n - 1);
    const cam = { kx: VIEW_KX, ky: Math.tan((deg * Math.PI) / 180) };
    let a = clock();
    for (const q of prep) {
      faceMatrix(q.b, 'spine', cam, q.px);
      faceMatrix(q.b, 'cover', cam, q.px);
      faceMatrix(q.b, 'back', cam, q.px);
      pageGeom(cam, q.b, 'head', q.px);
      pageGeom(cam, q.b, 'tail', q.px);
      pageGeom(cam, q.b, 'fore', q.px);
      silhouette(cam, q.b, q.px);
    }
    let b2 = clock();
    tGeom += b2 - a;
    a = b2;
    for (const q of prep) for (let slot = 0; slot < 3; slot++) recvProject(q.r3, cam, q.px, slot);
    b2 = clock();
    tRecv += b2 - a;
    a = b2;
    for (const q of prep) {
      for (const c of q.wall) castPath(cam, c, q.px);
      for (const c of q.shelf) castPath(cam, c, q.px);
    }
    tCast += clock() - a;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { books: prep.length, shadow3d: r2(t3d), faces: r2(tGeom / n), received: r2(tRecv / n), cast: r2(tCast / n) };
}

export { project };
