// 선반 한 줄의 그리기(UI 스레드). 줄의 움직임(scene.ts Motion)에서 매 프레임 같은 3D 자세를 읽어
// 책 면(BookNode), 받는 그림자, 벽·선반 윗면 그림자, 바닥 접촉, 선택 빛을 함께 그린다. React 상태는 배치가 바뀔 때만 건드린다.
// 그리는 순서(zIndex)는 장면 전체의 가림 순서(scene.ts sceneOrder: 모든 줄의 책과 선반 판)를 따른다.
// 한 줄의 좌표 변환은 px 하나(설계 단위 → 캔버스 px, 원점 = 그 줄 책 기준선 왼쪽 끝)뿐이다.
import { BlurMask, Group, LinearGradient, Path, Skia, vec, type SkPath, type SkRect } from '@shopify/react-native-skia';
import { memo, useLayoutEffect, useMemo } from 'react';
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { corners, faceCorners, faceNormal, FACE_IDS, fromPlaced, gap, lowest, rot, type Book3, type FaceId, type Vec3 } from '@/domain/book3';
import { project, toPx, type Affine, type Cam } from '@/domain/camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_X0, SHELF_X1, VIEW_KX } from '@/domain/geometry';
import { shelfFaces } from '@/domain/shelf-geom';
import { BOX_EDGES, bookCast, type BookCast } from '@/domain/cast-shadow';
import { hull, rgba } from '@/domain/shadow-shape';
import { outlineOf, type BookFrame, type Point } from '@/domain/shelf-scene';
import { NL_MAX, RECV_SLOTS, recvProject, type Recv, type Recv3 } from '@/ui/book3d/received';
import { REACH_L, REACH_R, receivedShadow3 } from '@/domain/received3';
import type { Book } from '@/domain/types';
import type { Shared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import { faceMatrix, pageGeom, silhouette } from '@/ui/book3d/face-geometry';
import { colors } from '@/ui/theme';
import { shadow } from '@/ui/lighting';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { TL, tl, tlOn, tlu } from '@/ui/perf';

import { scheduleOnUI } from 'react-native-worklets';

import { tryApplyPending } from './planner';
import { bodyOf, drawnOf, liveSV, OUT_SHADE_MAX, outsideDist, presentSV, shadeIn, shadeOf, TRANSIT_ROW, warmSV, type Motion, type Poses } from './scene';

export type CamSV = Readonly<SharedValue<Cam>>;
type Order = Readonly<SharedValue<Record<string, number>>>;

// 그리는 순서: 순위 × 10에 책 앞뒤로 붙는 표시를 끼운다. 벽은 모든 것보다 먼저.
export const Z_WALL = -1e7;
const zOf = (order: Order, key: string, off = 0) => {
  'worklet';
  return (order.value[key] ?? 0) * 10 + off;
};

// 줄의 그림자용 자세 모음(책 id → 자세, 그림자가 없으면 null). 어느 한 권이라도 자세가 바뀔 때만 새 값이 된다:
// 줄의 진행률이 도는 동안에도 바뀐 책이 없으면(멈춘 책은 같은 객체, 다른 줄로 멀리 가 있는 책은 null) 그림자 계산과
// 줄 캔버스 다시 그리기가 돌지 않는다. 그림자를 그리는 쪽(벽·선반 윗면·틈·접촉·기대기·받는 그림자)은 모두 이것만 읽는다.
export function useShadePoses(m: Motion, ids: string[], space: number, shelfId = ''): Readonly<SharedValue<Poses>> {
  const init = useMemo(() => {
    const out: Poses = {};
    for (const id of ids) out[id] = shadeIn(m, id, space);
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const poses = useSharedValue<Poses>(init);
  useAnimatedReaction(
    () => ids.map((id) => shadeIn(m, id, space)),
    (cur, prev) => {
      if (prev && prev.length === cur.length && cur.every((b, i) => b === prev[i])) return;
      // 측정 번들: 그림자가 아직 이 줄 가까이(줄 공간 밖 OUT_SHADE_MAX보다 안쪽)에 있는데 한 프레임에 없어진 경우를 적는다.
      // 자세 자체가 없어졌으면 drop(사라짐), 경로를 따라 한 프레임에 그림자 범위 밖까지 움직였으면 exit(프레임 간격이 길 때 생긴다)
      if (tlOn.value && prev && prev.length === cur.length)
        for (let i = 0; i < cur.length; i++) {
          const was = prev[i];
          if (!was || cur[i]) continue;
          const d = outsideDist(was, space);
          if (d >= OUT_SHADE_MAX - 4) continue;
          const now = shadeOf(m, ids[i]);
          if (now) tlu(`shade-exit ${ids[i]}@${shelfId} d=${d.toFixed(1)}>${outsideDist(now, space).toFixed(1)}`);
          else tlu(`shade-drop ${ids[i]}@${shelfId} d=${d.toFixed(1)}`);
        }
      const old = poses.value;
      let same = Object.keys(old).length === ids.length;
      const next: Poses = {};
      for (let i = 0; i < ids.length; i++) {
        next[ids[i]] = cur[i];
        if (old[ids[i]] !== cur[i]) same = false;
      }
      if (!same) poses.value = next;
    },
    [ids, space],
  );
  return poses;
}

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
// 미리 올려 둔 책: 이 줄 배치에는 없지만 캔버스에 올려 둔다(트랙이 생길 때까지 그리지 않는다). rest는 올릴 때 한 번 쓰는 자세
export type Ghost = { id: string; rest: Book3 };
// 캔버스 구조 열쇠: 올라간 책(치수)과 쌓기 관계만. 줄 안 순서는 넣지 않는다(순서는 zIndex가 정한다):
// 미리 올려 둔 책이 이 줄의 책이 되거나 줄 안에서 자리만 바뀌어도 캔버스를 다시 기록하지 않는다
export function structKeyOf(frames: BookFrame[], ghosts: Ghost[] = []) {
  const parts = frames.map((f) => `${f.bookId}:${dimsKey(fromPlaced(f.box).dims)}${f.stackIndex ? `:${f.stackIndex}@${f.itemKey}` : ''}`);
  for (const g of ghosts) if (!frames.some((f) => f.bookId === g.id)) parts.push(`${g.id}:${dimsKey(g.rest.dims)}`);
  return parts.sort().join('|');
}
export function makeStruct(frames: BookFrame[], arrive?: Record<string, Book3>, ghosts: Ghost[] = []): RowStruct {
  const dims: Record<string, Book3['dims']> = {};
  const rest: Record<string, Book3> = {};
  const ids: string[] = [];
  for (const f of frames) {
    const b = arrive?.[f.bookId] ?? fromPlaced(f.box);
    rest[f.bookId] = b;
    dims[f.bookId] = b.dims;
    ids.push(f.bookId);
  }
  for (const g of ghosts) {
    if (rest[g.id]) continue;
    rest[g.id] = g.rest;
    dims[g.id] = g.rest.dims;
    ids.push(g.id);
  }
  const stacks: [string, string][] = [];
  for (const f of frames) {
    if (f.stackIndex === 0) continue;
    const lower = frames.find((g) => g.itemKey === f.itemKey && g.stackIndex === f.stackIndex - 1);
    if (lower) stacks.push([f.bookId, lower.bookId]);
  }
  return { ids, dims, rest, stacks };
}

const SHOW_ALL: SkRect = Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5);
const SHOW_NONE: SkRect = Skia.XYWHRect(0, 0, 0, 0);

// rest: 트랙이 아직 없을 때의 자리 표시용 자세(마운트할 때 한 번).
// 그리지 않는 때: 이 줄 움직임에 이 책 트랙이 없을 때(다른 줄로 옮겨 가서 이 캔버스에서 내려가기 직전),
// 제 줄 공간 밖에 걸친 동안(다른 줄로 옮겨 가는 중). 그동안은 이동 캔버스가 그린다.
// 첫 그림을 낸 뒤 '올라감'을 알린다(그 전에는 이동 캔버스가 대신 그린다).
const RowBook = memo(
  function RowBook({ m, shelfId, id, dims, rest, book, cam, px, shared, recv, order, space }: { m: Motion; shelfId: string; id: string; dims: Book3['dims']; rest: Book3; book: Book; cam: CamSV; px: Affine; shared: Shared; recv?: { ids: string[]; space: number; plankAbove: boolean; debug?: boolean; poses: Readonly<SharedValue<Poses>> }; order: Order; space: number }) {
    const first = useMemo(() => rest, []); // eslint-disable-line react-hooks/exhaustive-deps
    // 이 줄이 그리는 자세(안 그리면 null). 안 그리는 동안은 멈춘 자리 표시 자세라 책 그림 계산이 돌지 않는다.
    // 막 다른 줄로 떠난 책도 이 줄 공간 안에 있는 동안은 그린다(이동 캔버스가 같은 자세로 위에 겹친다). 이동 캔버스가 그 책을
    // 미리 그려 두고 있었으면(warm) 이미 화면에 있으므로 이 줄은 바로 내린다(같은 책을 두 캔버스가 그리는 비용을 아낀다)
    // 이동 캔버스가 이 책을 미리 그려 두었거나(warm) 이동 캔버스의 이 책 그림이 이미 그릴 수 있으면(live) 떠난 책은 이동 캔버스가 맡는다
    // (같은 책을 두 캔버스가 함께 그리지 않는다). 그렇지 않을 때만 이 줄이 떠난 책을 줄 공간을 벗어날 때까지 그린다.
    const vis = useDerivedValue(() => drawnOf(m, id, space, warmSV.value !== id && !liveSV.value[id]?.[TRANSIT_ROW]));
    const state = useDerivedValue(() => vis.value ?? first);
    const clip = useDerivedValue<SkRect>(() => (vis.value ? SHOW_ALL : SHOW_NONE));
    // 이 줄 캔버스가 이 책을 실제로 그릴 수 있게 된 때(첫 그림을 낸 뒤 이 책의 화면 계산이 처음 돈 때) 알린다: 이동 캔버스는 이때부터
    // 이 줄에 넘겨준다(올라간 순간 바로 넘기면 아직 그리지 못하는 프레임이 생긴다)
    const announced = useSharedValue(false);
    useAnimatedReaction(
      () => vis.value,
      () => {
        if (announced.value) return;
        announced.value = true;
        liveSV.value = { ...liveSV.value, [id]: { ...(liveSV.value[id] ?? {}), [shelfId]: true } };
        if (tlOn.value) tlu(`live ${id}@${shelfId}`);
      },
    );
    // 캔버스 안 레이아웃 효과는 그 캔버스를 다시 기록해 첫 그림을 UI로 보낸 바로 뒤에 돈다: 이때부터 이 줄이 이 책을 그린다.
    // (useEffect는 캔버스 쪽 React가 다음 변경을 받을 때까지 미뤄질 수 있어, 다른 줄로 옮기는 경로가 그만큼 늦게 출발했다)
    useLayoutEffect(() => {
      if (TL.on) tl(`present ${id}@${shelfId}`);
      scheduleOnUI(() => {
        'worklet';
        if (tlOn.value) tlu(`present ${id}@${shelfId}`);
        presentSV.value = { ...presentSV.value, [id]: { ...(presentSV.value[id] ?? {}), [shelfId]: true } };
        // 이 책을 기다리며 미뤄 둔 경로가 있으면 이제 움직인다
        tryApplyPending();
      });
      return () => {
        scheduleOnUI(() => {
          'worklet';
          const cur = presentSV.value[id];
          if (cur?.[shelfId]) {
            const rest = { ...cur };
            delete rest[shelfId];
            presentSV.value = { ...presentSV.value, [id]: rest };
          }
          const lv = liveSV.value[id];
          if (lv?.[shelfId]) {
            const rest = { ...lv };
            delete rest[shelfId];
            liveSV.value = { ...liveSV.value, [id]: rest };
          }
        });
      };
    }, [id, shelfId]);
    const under = recv ? <BookReceives vis={vis} poses={recv.poses} id={id} ids={recv.ids} cam={cam} px={px} space={recv.space} plankAbove={recv.plankAbove} debug={recv.debug} /> : null;
    const z = useDerivedValue(() => zOf(order, id));
    return <BookNode book={book} dims={dims} state={state} cam={cam} px={px} shared={shared} under={under} order={z} clip={clip} />;
  },
  (a, b) =>
    a.m === b.m && a.shelfId === b.shelfId && a.id === b.id && a.book === b.book && dimsKey(a.dims) === dimsKey(b.dims) && a.cam === b.cam && a.px === b.px && a.shared === b.shared && a.space === b.space &&
    a.recv?.ids.join('|') === b.recv?.ids.join('|') && a.recv?.space === b.recv?.space && a.recv?.plankAbove === b.recv?.plankAbove && a.recv?.debug === b.recv?.debug && a.recv?.poses === b.recv?.poses && a.order === b.order,
);

// 한 줄의 책과 그 줄에 붙는 표시(선택 빛·놓일 범위·쌓기 접촉·기대기 접촉). 캔버스 안에 형제로 펼쳐 넣는다(가림 순서가 zIndex로 섞이게).
// shared는 캔버스 밖에서 읽어 넘긴다(캔버스 안에는 React 컨텍스트가 닿지 않는다).
export const RowBooks = memo(function RowBooks({ m, shelfId, st, books, glowId = null, dragId = null, cam, px, space, shared, order, poses, debug = false, plankAbove = false }: { m: Motion; shelfId: string; st: RowStruct; books: Record<string, Book>; glowId?: string | null; dragId?: string | null; cam: CamSV; px: Affine; space: number; shared: Shared; order: Order; poses: Readonly<SharedValue<Poses>>; debug?: boolean; plankAbove?: boolean }) {
  // 책 면이 받는 그림자의 가리개 후보(같은 줄의 다른 책 + 윗 선반 판)
  const ids = st.ids;
  const recv = useMemo(() => (SHOW.cast ? { ids, space, plankAbove, debug, poses } : undefined), [ids, space, plankAbove, debug, poses]);
  return (
    <>
      {ids.map((id) => (
        <RowBook key={id} m={m} shelfId={shelfId} id={id} dims={st.dims[id]} rest={st.rest[id]} book={books[id]} cam={cam} px={px} shared={shared} recv={recv} order={order} space={space} />
      ))}
      {/* 끄는 책이 놓일 가로 범위: 선반 앞턱에 얇게(끄는 동안만) */}
      {dragId && ids.includes(dragId) ? <LipRange m={m} id={dragId} shelfId={shelfId} cam={cam} px={px} order={order} space={space} /> : null}
      {glowId && ids.includes(glowId) ? <SelectGlow m={m} id={glowId} cam={cam} px={px} order={order} space={space} /> : null}
      {debug ? ids.map((id) => <DebugGeom key={`dbg${id}`} m={m} id={id} cam={cam} px={px} />) : null}
      {debug ? <DebugShelf cam={cam} px={px} /> : null}
      {SHOW.stack ? st.stacks.map(([up, lo]) => <StackShade key={`sh${up}`} m={m} id={up} lowerId={lo} cam={cam} px={px} order={order} space={space} />) : null}
      {SHOW.lean ? <LeanContacts poses={poses} ids={ids} cam={cam} px={px} order={order} /> : null}
    </>
  );
});

// 끄는 책이 놓일 가로 범위: 책 바닥의 좌우 끝을 선반 앞턱(판 앞 윗모서리) 바로 아래에 얇은 선으로.
// 3°처럼 앞 책에 가려 자리가 잘 안 보일 때도 어디에 놓이는지 읽히게. 끄는 동안만(상시 선택 막대가 아니다).
function LipRange({ m, id, shelfId, cam, px, order, space }: { m: Motion; id: string; shelfId: string; cam: CamSV; px: Affine; order: Order; space: number }) {
  // 선반 앞면 위의 선이라 판 바로 다음(판 위 그림자·접촉보다 위, 판 위에 선 책들보다 아래): 선반 앞으로 빼낸 책이 있으면 그 책이 가린다
  const z = useDerivedValue(() => zOf(order, `plank:${shelfId}`, 6));
  const body = useDerivedValue(() => drawnOf(m, id, space));
  const path = useDerivedValue(() => {
    const b = body.value;
    if (!b) return NO_PATH;
    const p = Skia.PathBuilder.Make();
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
  const body = useDerivedValue(() => drawnOf(m, id, space));
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
// 3D 계산(of)은 이 책 자세가 바뀔 때만(줄 자세 모음에서 이 책 값은 멈춘 동안 같은 객체), 투영은 시점이 바뀔 때도
function CastShadow({ poses, id, of, k, cam, px, color }: { poses: Readonly<SharedValue<Poses>>; id: string; of: (b: Book3, k: number) => Cast3; k: number; cam: CamSV; px: Affine; color: string }) {
  const b = useDerivedValue(() => poses.value[id] ?? null);
  const c = useDerivedValue(() => (b.value ? of(b.value, k) : null));
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
function CastLayer({ poses, ids, of, k, opacity, color = shadow.color, cam, px }: { poses: Readonly<SharedValue<Poses>>; ids: string[]; of: (b: Book3, k: number) => Cast3; k: number; opacity: number; color?: string; cam: CamSV; px: Affine }) {
  const paint = useMemo(() => {
    const p = Skia.Paint();
    p.setAlphaf(opacity);
    return p;
  }, [opacity]);
  return (
    <Group layer={paint}>
      {ids.map((id) => (
        <CastShadow key={id} poses={poses} id={id} of={of} k={k} cam={cam} px={px} color={color} />
      ))}
    </Group>
  );
}

// 책 사이 틈 어둠(벽 쪽): 앞줄에 선 책끼리 틈이 좁을수록 진하고 fadeAt 이상이면 없다. 틈 영역 안에만.
function gapShapes(poses: Poses, ids: string[], cam: Cam, px: Affine) {
  'worklet';
  const g = shadow.ao.gap;
  const row: { lo: number; hi: number; top: number; z: number }[] = [];
  for (const id of ids) {
    const b = poses[id];
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

function GapShade({ gaps, band }: { gaps: Readonly<SharedValue<{ rect: Point[]; a: number }[]>>; band: number }) {
  // 진하기 단계(band)별로 한 경로씩: 틈마다 색이 달라서
  const path = useDerivedValue(() => {
    const polys: Point[][] = [];
    for (const g of gaps.value) {
      const lvl = Math.min(3, Math.floor((g.a / shadow.ao.gap.max) * 4));
      if (lvl === band) polys.push(g.rect);
    }
    return pathOf(polys);
  });
  return <Path path={path} color={rgba(shadow.color, shadow.ao.gap.max * ((band + 0.5) / 4))} />;
}

// 기댄 책이 받치는 책에 닿는 곳: 닿는 점에 좁고 진한 어둠, 그 아래 벌어진 틈은 넓어지며 부드럽게 옅어진다.
// 쐐기 = [닿는 점, 받치는 책 쪽 바닥, 기댄 책 바닥 모서리]. 받치는 책의 옆면·틈 너머 벽이 받는 면이다.
function leanContactShapes(poses: Poses, ids: string[], cam: Cam, px: Affine) {
  'worklet';
  const out: { id: string; tri: Point[]; top: Point; mid: Point }[] = [];
  for (const id of ids) {
    const b = poses[id];
    if (!b || Math.abs(b.roll) < 1 || Math.abs(b.roll) > 45 || Math.abs(lowest(b)) > 0.5) continue;
    // 받치는 책에 실제로 닿아 있을 때만(허공으로 기운 책·기울이는 도중 떨어져 있는 책에는 접촉 어둠이 없다)
    let touching = false;
    for (const o of ids) {
      if (o === id) continue;
      const ob = poses[o];
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

function LeanContacts({ poses, ids, cam, px, order }: { poses: Readonly<SharedValue<Poses>>; ids: string[]; cam: CamSV; px: Affine; order: Order }) {
  const w = useDerivedValue(() => leanContactShapes(poses.value, ids, cam.value, px));
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
// (워클릿은 만들어질 때 쓰는 함수를 붙잡으므로 쓰이는 함수를 먼저 정의한다)
function xRangeOf(q: Book3) {
  'worklet';
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners(q)) {
    lo = Math.min(lo, c.x);
    hi = Math.max(hi, c.x);
  }
  return { lo, hi };
}

// 자세 b(이 줄 좌표)의 책에 그림자를 드리울 수 있는 책(자세 모음에서, 막 떠난 책의 남은 경로 포함)
export function occludersIn(poses: Poses, b: Book3, id: string, ids: string[]): Book3[] {
  'worklet';
  const me = xRangeOf(b);
  const occ: Book3[] = [];
  for (const o of ids) {
    if (o === id) continue;
    const ob = poses[o];
    if (!ob) continue;
    const r = xRangeOf(ob);
    if (r.hi < me.lo - REACH_L || r.lo > me.hi + REACH_R) continue;
    occ.push(ob);
  }
  return occ;
}

// 줄 움직임에서 바로(이동 캔버스·측정용)
export function occludersOf(m: Motion, b: Book3, id: string, ids: string[]): Book3[] {
  'worklet';
  const poses: Poses = {};
  for (const o of ids) poses[o] = shadeOf(m, o);
  return occludersIn(poses, b, id, ids);
}

export function occluderBodies(m: Motion, id: string, ids: string[]): { b: Book3 | null; occ: Book3[] } {
  'worklet';
  const b = bodyOf(m, id);
  if (!b) return { b: null, occ: [] };
  return { b, occ: occludersOf(m, b, id, ids) };
}

// 받는 그림자 한 층: 그 층에 드는 가리개들의 다각형을 한 경로로(합집합). 진하기 a = 가리개 모델 값 × 받는 면이 빛을 받는 정도
// (nl / NL_MAX, 그래서 층 진하기에 NL_MAX를 곱해 둔다). 책 색·그림을 살린 채 어둡게: 그림자 색 t로 곱하기(multiply)한 것과 같은 결과를
// 불투명 색 f = 1 - a(1 - t)의 modulate(r = s·d) 합성으로 낸다. 곱하기는 GPU에서 그릴 때마다 대상 영역을 복사해야 하는 합성이라
// 비싸고(측정 번들 단계별 측정), modulate는 보통의 하드웨어 합성이다. 흐림 가장자리(덮임 c)에서도 둘 다 d(1 - c·a(1 - t))로 같다.
const RECV_T = (() => {
  const n = parseInt(shadow.recv.book.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
})();
function mulColor(a: number) {
  'worklet';
  const f = (c: number) => Math.round(255 * (1 - Math.max(0, Math.min(1, a)) * (1 - c / 255)));
  return `rgb(${f(RECV_T.r)}, ${f(RECV_T.g)}, ${f(RECV_T.b)})`;
}
function RecvLayerPath({ r, kind, k }: { r: Readonly<SharedValue<Recv>>; kind: 'book' | 'plank'; k: number }) {
  const path = useDerivedValue(() => r.value[kind][k].path);
  const blur = useDerivedValue(() => r.value[kind][k].blur / 2);
  const a = shadow.cast[kind].opacity[k] * NL_MAX;
  const color = useDerivedValue(() => mulColor(a * r.value.k));
  return (
    <Path path={path} color={color} blendMode="modulate">
      <BlurMask blur={blur} style="normal" />
    </Path>
  );
}

// 개발용: 계산된 그림자 외곽(빨강)과 받는 면(초록)
function RecvDebug({ r }: { r: Readonly<SharedValue<Recv>> }) {
  const outline = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    for (const l of [...r.value.book, ...r.value.plank]) p.addPath(l.path);
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

export function ReceivedShadow({ r3, cam, px, slot, debug }: { r3: Readonly<SharedValue<Recv3>>; cam: CamSV; px: Affine; slot: number; debug?: boolean }) {
  const r = useDerivedValue(() => recvProject(r3.value, cam.value, px, slot));
  const clip = useDerivedValue(() => r.value.clip);
  return (
    <>
      <Group clip={clip}>
        {shadow.cast.plank.layers.map((_, k) => (
          <RecvLayerPath key={`p${k}`} r={r} kind="plank" k={k} />
        ))}
        {shadow.cast.book.layers.map((_, k) => (
          <RecvLayerPath key={`b${k}`} r={r} kind="book" k={k} />
        ))}
      </Group>
      {debug ? <RecvDebug r={r} /> : null}
    </>
  );
}

// 한 책이 받는 그림자 전부(보이는 면마다, 다른 책·윗 선반 판을 합쳐서). 책 그룹 안, 면 다음·갈피 전에 그린다(BookNode의 under).
// vis: 이 줄이 그리는 이 책의 자세(안 그리면 null), poses: 줄의 그림자용 자세 모음.
export function BookReceives({ vis, poses, id, ids, cam, px, space, plankAbove, debug }: { vis: Readonly<SharedValue<Book3 | null>>; poses: Readonly<SharedValue<Poses>>; id: string; ids: string[]; cam: CamSV; px: Affine; space: number; plankAbove: boolean; debug?: boolean }) {
  const castPlank = SHOW.castPlank;
  // 이 책 자세와 가리개 후보(드리울 수 있는 범위의 이웃)가 하나라도 바뀔 때만 다시 계산한다(멈춘 책은 같은 객체라 비교가 싸다).
  // 옮긴 책과 그 그림자를 받는 이웃만 다시 계산되고, 줄의 다른 책은 끄는 동안에도 계산하지 않는다. 그리지 않는 동안(vis 없음)은 비운다.
  // 파생 값으로 계산해 그리는 쪽과 같은 프레임에 나온다: 반응으로 따로 두면 그리는 쪽 계산이 먼저 돌아(반응이 쓰는 값은 순서에 들어가지
  // 않는다) 이동 캔버스에서 이 줄로 넘겨받는 프레임에 받는 그림자가 비어 책 면이 한 프레임 밝아졌다.
  // 지난 계산의 열쇠·결과는 따로 담아 두고 같으면 그대로 돌려준다(담는 값을 바꾸면 이 계산이 다음 프레임에 한 번 더 돌지만 같은 결과로 멈춘다).
  const init = useMemo(() => {
    const b = vis.value;
    if (!b) return { key: [] as Book3[], r: null as Recv3 };
    const occ = occludersIn(poses.value, b, id, ids);
    return { key: [b, ...occ], r: receivedShadow3(b, occ, px.s, space, plankAbove, castPlank) };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const memo = useSharedValue<{ key: Book3[]; r: Recv3 }>(init);
  const r3 = useDerivedValue<Recv3>(() => {
    const b = vis.value;
    const last = memo.value;
    if (!b) return null;
    const occ = occludersIn(poses.value, b, id, ids);
    if (last.key.length === occ.length + 1 && last.key[0] === b && occ.every((q, i) => q === last.key[i + 1])) return last.r;
    const r = receivedShadow3(b, occ, px.s, space, plankAbove, castPlank);
    memo.value = { key: [b, ...occ], r };
    return r;
  });
  return (
    <Group>
      {Array.from({ length: RECV_SLOTS }, (_, slot) => (
        <ReceivedShadow key={slot} r3={r3} cam={cam} px={px} slot={slot} debug={debug} />
      ))}
    </Group>
  );
}

// 벽 단계(판보다 먼저): 책 → 벽 실제 그림자 + 책 사이 틈 어둠(주변광 차폐)
export const RowShadows = memo(function RowShadows({ poses, ids, cam, px, space }: { poses: Readonly<SharedValue<Poses>>; ids: string[]; cam: CamSV; px: Affine; space: number }) {
  const s = px.s;
  // 책 사이 틈: 줄 자세 모음이나 시점이 바뀔 때 한 번 계산해 진하기 단계별 경로가 나눠 쓴다
  const gaps = useDerivedValue(() => (SHOW.gap ? gapShapes(poses.value, ids, cam.value, px) : []));
  // 제 줄 공간 밖으로 나간 책(다른 줄로 옮겨 가는 중)은 벗어난 거리만큼 벽 그림자를 옅게 한다(줄 안으로 들어오는 순간 한꺼번에 생기지 않게)
  const of = useMemo(() => (b: Book3, k: number) => {
    'worklet';
    const out = outsideDist(b, space);
    if (out > OUT_SHADE_MAX) return null;
    const c = bookCast(b, s, k, true);
    return c && out > 0 ? { ...c, w: c.w * Math.exp(-out / 10) } : c;
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
        {SHOW.wall ? shadow.cast.book.layers.map((_, k) => <CastLayer key={k} poses={poses} ids={ids} of={of} k={k} opacity={shadow.cast.book.opacity[k]} color={shadow.recv.wall} cam={cam} px={px} />) : null}
      </Group>
      {SHOW.gap ? [0, 1, 2, 3].map((b) => <GapShade key={b} gaps={gaps} band={b} />) : null}
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
export const RowContacts = memo(function RowContacts({ poses, ids, cam, px, order, shelfId }: { poses: Readonly<SharedValue<Poses>>; ids: string[]; cam: CamSV; px: Affine; order: Order; shelfId: string }) {
  const s = px.s;
  const z = useDerivedValue(() => zOf(order, `plank:${shelfId}`, 5));
  // 선반에서 떨어진(쌓인 위·들어 올린) 책은 접촉이 없다
  const shapes = useDerivedValue(() => {
    const layers: Point[][][] = CONTACT_LAYERS.map(() => []);
    const foot: Point[][] = [];
    const ps = poses.value;
    for (const id of ids) {
      const b = ps[id];
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
      {SHOW.shelfCast ? shadow.cast.book.layers.map((_, k) => <CastLayer key={k} poses={poses} ids={ids} of={of} k={k} opacity={shadow.cast.book.opacity[k]} color={shadow.recv.wall} cam={cam} px={px} />) : null}
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
  // 두 책이 그리는 자세(멈춘 동안 같은 객체): 둘 중 하나가 움직이거나 시점이 바뀔 때만 다시 계산
  const upB = useDerivedValue(() => drawnOf(m, id, space));
  const loB = useDerivedValue(() => drawnOf(m, lowerId, space));
  const g = useDerivedValue(() => {
    const cam = camSV.value;
    const up = upB.value;
    const lo = loB.value;
    if (!up || !lo || lowest(up) < 0.5) return { top: pathOf([]), foot: pathOf([]) };
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
