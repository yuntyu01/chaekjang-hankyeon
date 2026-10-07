// 선반 한 줄의 그리기(UI 스레드). 줄의 움직임(scene.ts Motion)에서 매 프레임 같은 3D 자세를 읽어
// 책 면(BookNode), 책 면이 받는 창빛 그림자, 벽·선반 윗면의 창빛 그림자, 선택 빛을 함께 그린다. React 상태는 배치가 바뀔 때만 건드린다.
// 하늘 가림(책 사이 틈·바닥 접촉·기댄 책·쌓인 책 둘레의 어둠)은 따로 그리지 않는다: 줄의 책 상자 목록(useRowBoxes)을 책 면·판·벽
// 셰이더(ui/SceneLight)가 같이 읽어 화소마다 계산한다.
// 그리는 순서(zIndex)는 장면 전체의 가림 순서(scene.ts sceneOrder: 모든 줄의 책과 선반 판)를 따른다.
// 한 줄의 좌표 변환은 px 하나(설계 단위 → 캔버스 px, 원점 = 그 줄 책 기준선 왼쪽 끝)뿐이다.
import { AlphaType, BlendMode, BlurMask, BlurStyle, ColorType, FilterMode, Group, ImageShader, MipmapMode, Path, Rect, Skia, TileMode, vec, type SkImage, type SkPath, type SkRect } from '@shopify/react-native-skia';
import { memo, useLayoutEffect, useMemo } from 'react';
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { corners, fromPlaced, lowest, type Book3 } from '@/domain/book3';
import { camAt, project, toPx, VIEW_PITCH_MAX, VIEW_PITCH_MIN, type Affine, type Cam } from '@/domain/camera';
import { bookViewCam } from '@/domain/book-view';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { shelfFaces } from '@/domain/shelf-geom';
import { BOX_EDGES, bookCast, type BookCast } from '@/domain/cast-shadow';
import { albedoOf, BOX_MAX, boxOf, FAR, irradiance, keyBlocked, keyIrradiance, NEGLIGIBLE, packBoxes, shadowAlpha, withCovers, type Box, type BoxBuf, type Env } from '@/domain/light-model';
import { hull } from '@/domain/shadow-shape';
import { outlineOf, type BookFrame, type Point } from '@/domain/shelf-scene';
import { RECV_SLOTS, recvProject, type Recv, type Recv3 } from '@/ui/book3d/received';
import { REACH_L, REACH_R, receivedShadow3 } from '@/domain/received3';
import type { Book } from '@/domain/types';
import type { Shared } from '@/ui/book3d/art';
import { bookTone } from '@/domain/binding-material';
import { BookNode } from '@/ui/book3d/BookNode';
import { faceMatrix, pageGeom, silhouette } from '@/ui/book3d/face-geometry';
import { colors } from '@/ui/theme';
import { physShadow } from '@/ui/lighting';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { WALL_X0, WALL_X1 } from '@/ui/shelf/ShelfPlank';
import { TL, tl, tlOn, tlu } from '@/ui/perf';
import { keepLatest, type Atlas } from '@/ui/SceneLight';

import { scheduleOnUI } from 'react-native-worklets';

import { tryApplyPending } from './planner';
import { bodyOf, drawnOf, liveSV, makeMotion, OUT_SHADE_MAX, outsideDist, presentSV, shadeIn, shadeOf, TRANSIT_ROW, warmSV, type Motion, type Poses } from './scene';

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
  // Initialize on the UI thread through the reaction below. Reading tracks in
  // React render produced a warning over the shelf whenever a row remounted.
  const poses = useSharedValue<Poses>({});
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

// 줄이 멈췄는가: 경로 진행이 끝났고, 남는 경로(다른 줄로 떠난 책)도 다 갔거나 아직 출발 전(그 자리에 멈춰 있다)
export function settledOf(m: Motion) {
  'worklet';
  if (m.t.value < 1) return false;
  const aw = m.away.value;
  for (const id in aw) {
    const e = aw[id];
    if (e.t0 !== Infinity && e.dur > 0 && m.awayT.value < e.t0 + e.dur * e.k) return false;
  }
  return true;
}

// 하늘 가림을 구울 자세: 줄이 멈췄을 때만 그림자용 자세를 따라간다(움직이는 동안은 마지막으로 멈췄던 자세).
// 하늘 가림 굽기는 줄 전체를 다시 계산해 무거워서 책이 멈춘 뒤 한 번만 한다(움직이는 동안 책 면 그림은 책에 붙어 같이 간다)
export function useRestPoses(poses: Readonly<SharedValue<Poses>>, m: Motion): Readonly<SharedValue<Poses>> {
  const rest = useSharedValue<Poses>({});
  useAnimatedReaction(
    () => (settledOf(m) ? poses.value : null),
    (p) => {
      if (p && p !== rest.value) rest.value = p;
    },
    [m],
  );
  return rest;
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
  function RowBook({ m, shelfId, id, dims, rest, book, cam, px, shared, recv, order, space, env, atlas, boxes }: { m: Motion; shelfId: string; id: string; dims: Book3['dims']; rest: Book3; book: Book; cam: CamSV; px: Affine; shared: Shared; recv?: { ids: string[]; debug?: boolean; poses: Readonly<SharedValue<Poses>> }; order: Order; space: number; env: Readonly<SharedValue<Env | null>>; atlas: Readonly<SharedValue<Atlas>>; boxes: Readonly<SharedValue<BoxBuf>> }) {
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
    const artCam = useDerivedValue(() => bookViewCam(cam.value, state.value));
    const under = recv ? <BookReceives vis={vis} poses={recv.poses} id={id} ids={recv.ids} cam={artCam} px={px} debug={recv.debug} /> : null;
    const z = useDerivedValue(() => zOf(order, id));
    // 줄의 책 상자 목록에서 이 책(빛을 받을 때 자기 상자는 뺀다)
    const self = useDerivedValue(() => boxes.value.ids.indexOf(id));
    return <BookNode book={book} dims={dims} state={state} cam={cam} px={px} shared={shared} under={under} order={z} clip={clip} env={env} atlas={atlas} boxes={boxes} self={self} />;
  },
  (a, b) =>
    a.m === b.m && a.shelfId === b.shelfId && a.id === b.id && a.book === b.book && dimsKey(a.dims) === dimsKey(b.dims) && a.cam === b.cam && a.px === b.px && a.shared === b.shared && a.space === b.space &&
    a.recv?.ids.join('|') === b.recv?.ids.join('|') && a.recv?.debug === b.recv?.debug && a.recv?.poses === b.recv?.poses && a.order === b.order && a.env === b.env && a.atlas === b.atlas && a.boxes === b.boxes,
);

// 한 줄의 책과 그 줄에 붙는 표시(선택 빛·놓일 범위). 캔버스 안에 형제로 펼쳐 넣는다(가림 순서가 zIndex로 섞이게).
// shared는 캔버스 밖에서 읽어 넘긴다(캔버스 안에는 React 컨텍스트가 닿지 않는다). env·boxes: 이 줄의 둘레와 책 상자 목록(빛 계산)
export const RowBooks = memo(function RowBooks({ m, shelfId, st, books, glowId = null, dragId = null, cam, px, space, shared, order, poses, env, atlas, boxes, debug = false }: { m: Motion; shelfId: string; st: RowStruct; books: Record<string, Book>; glowId?: string | null; dragId?: string | null; cam: CamSV; px: Affine; space: number; shared: Shared; order: Order; poses: Readonly<SharedValue<Poses>>; env: Readonly<SharedValue<Env | null>>; atlas: Readonly<SharedValue<Atlas>>; boxes: Readonly<SharedValue<BoxBuf>>; debug?: boolean }) {
  const ids = st.ids;
  // 책 면이 받는 창빛 그림자의 가리개 후보: 같은 줄의 다른 책
  const recv = useMemo(() => (SHOW.cast ? { ids, debug, poses } : undefined), [ids, debug, poses]);
  return (
    <>
      {ids.map((id) => (
        <RowBook key={id} m={m} shelfId={shelfId} id={id} dims={st.dims[id]} rest={st.rest[id]} book={books[id]} cam={cam} px={px} shared={shared} recv={recv} order={order} space={space} env={env} atlas={atlas} boxes={boxes} />
      ))}
      {/* 끄는 책이 놓일 가로 범위: 선반 앞턱에 얇게(끄는 동안만) */}
      {dragId && ids.includes(dragId) ? <LipRange m={m} id={dragId} shelfId={shelfId} cam={cam} px={px} order={order} space={space} /> : null}
      {glowId && ids.includes(glowId) ? <SelectGlow m={m} id={glowId} cam={cam} px={px} order={order} space={space} /> : null}
      {debug ? ids.map((id) => <DebugGeom key={`dbg${id}`} m={m} id={id} cam={cam} px={px} />) : null}
      {debug ? <DebugShelf cam={cam} px={px} /> : null}
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

// ---------- 줄의 빛 계산 입력 ----------

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
const NO_PATH = Skia.PathBuilder.Make().detach();

// 이웃 줄(위·아래): 그 줄의 그림자용 자세 모음과 책 id, 그 줄 좌표 → 이 줄 좌표 세로 이동 dy, 어느 쪽인지(side: 위 +1, 아래 −1)
export type NeighborRow = { poses: Readonly<SharedValue<Poses>>; ids: string[]; dy: number; side: number };
// 이웃 줄이 없을 때 쓰는 빈 움직임(훅 수를 줄마다 같게)
export const EMPTY_MOTION = makeMotion([]);

// 줄의 책 상자 목록(하늘 가림의 가리개): 그림자용 자세 모음에서, 이 줄 공간(판 윗면 ~ 위 판 아랫면)에 걸친 책.
// 공간 밖(다른 줄로 옮겨 가는 중 판 너머에 있는 책)은 판이 가려 이 줄 안을 가리지 않는다. 반사율은 책 몸체 재질 색에서.
// 나란히 선 책·쌓인 책은 서로 마주 보는 면을 가린다(덮개, light-model withCovers).
// neighbors: 이웃 줄 책(벽을 칠할 때만): 판 끝 너머 벽 띠에서 판 위·아래 틈으로 보인다. 셰이더 상자 수(BOX_MAX)를 넘으면 판 끝에서 먼 것부터 뺀다
export function useRowBoxes(poses: Readonly<SharedValue<Poses>>, ids: string[], books: Record<string, Book>, env: Env, neighbors: NeighborRow[] = []): Readonly<SharedValue<BoxBuf>> {
  const albedos = useMemo(() => Object.fromEntries([ids, ...neighbors.map((nb) => nb.ids)].flat().map((id) => [id, books[id] ? albedoOf(bookTone(books[id])) : 0])), [ids, neighbors, books]);
  return useDerivedValue(() => {
    const own: Box[] = [];
    const used: string[] = [];
    const ps = poses.value;
    for (const id of ids) {
      const b = ps[id];
      if (!b) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of corners(b)) {
        lo = Math.min(lo, c.y);
        hi = Math.max(hi, c.y);
      }
      if (hi < env.floor || lo > env.ceil) continue;
      own.push(boxOf(b, albedos[id]));
      used.push(id);
    }
    const list = withCovers(own);
    const others: { box: Box; id: string; d: number }[] = [];
    for (const nb of neighbors) {
      const group: Box[] = [];
      const gids: string[] = [];
      const nps = nb.poses.value;
      for (const id of nb.ids) {
        const b = nps[id];
        if (!b) continue;
        group.push(boxOf({ ...b, t: { x: b.t.x, y: b.t.y + nb.dy, z: b.t.z } }, albedos[id], nb.side));
        gids.push(id);
      }
      withCovers(group).forEach((box, i) => {
        const r = Math.hypot(box.hx, box.hz);
        others.push({ box, id: gids[i], d: Math.min(box.c.x - r - SHELF_X0, SHELF_X1 - box.c.x - r) });
      });
    }
    others.sort((a, b) => a.d - b.d);
    for (const o of others) {
      if (list.length >= BOX_MAX) break;
      list.push(o.box);
      used.push(o.id);
    }
    return packBoxes(list, used);
  });
}

// ---------- 창빛 그림자: 책 → 벽·선반 윗면 ----------
// 책 → 벽·선반 윗면 층의 3D 점은 domain/cast-shadow bookCast가 만들고, 여기서는 투영·흐림·합성만 한다.
// 시점을 끄는 동안에는 투영만 다시 하고, 책이 움직일 때만 3D 계산을 다시 한다.
function castPath(cam: Cam, c: BookCast, px: Affine): SkPath {
  'worklet';
  if (!c) return NO_PATH;
  const pts: Point[] = [];
  for (const q of c.pts) pts.push(toPx(cam, px, q));
  return pathOf([hull(pts)]);
}

// 그림자 한 권·한 구간: 불투명하게 그려(얇은 가리개는 w만큼) 층(CastLayer) 안에서 합집합이 되게 한다.
// 3D 계산(of)은 이 책 자세가 바뀔 때만(줄 자세 모음에서 이 책 값은 멈춘 동안 같은 객체), 투영은 시점이 바뀔 때도
function CastShadow({ poses, id, of, k, cam, px }: { poses: Readonly<SharedValue<Poses>>; id: string; of: (b: Book3, k: number) => BookCast; k: number; cam: CamSV; px: Affine }) {
  const b = useDerivedValue(() => poses.value[id] ?? null);
  const c = useDerivedValue(() => (b.value ? of(b.value, k) : null));
  const path = useDerivedValue(() => castPath(cam.value, c.value, px));
  const sigma = useDerivedValue(() => Math.max(0.01, c.value ? c.value.sigma : 0));
  const op = useDerivedValue(() => c.value?.w ?? 0);
  return (
    <Path path={path} color="black" opacity={op}>
      <BlurMask blur={sigma} style="normal" />
    </Path>
  );
}

// 받는 면 하나의 창빛 그림자 층: 모든 책·모든 빛 길이 구간을 한 레이어에 합집합으로 그리고(겹쳐도 두 번 어두워지지 않는다),
// 받는 면의 진하기(검정 불투명도 shadowAlpha(d))를 dstIn으로 한 번 얹는다. ink: 진하기를 칠하는 요소(색 또는 세로 그러데이션)
const BAND_KS = physShadow.bands.map((_, k) => k);
function CastLayer({ poses, ids, of, cam, px, ink }: { poses: Readonly<SharedValue<Poses>>; ids: string[]; of: (b: Book3, k: number) => BookCast; cam: CamSV; px: Affine; ink: React.ReactNode }) {
  return (
    <Group layer>
      {ids.map((id) => BAND_KS.map((k) => <CastShadow key={`${id}:${k}`} poses={poses} id={id} of={of} k={k} cam={cam} px={px} />))}
      {ink}
    </Group>
  );
}

// 창빛이 가려질 때의 진하기 = 그 면이 받는 창빛 몫 / 받는 빛: 벽(앞을 향함), 선반 윗면(위를 향함)
const WALL_N = { x: 0, y: 0, z: -1 };
const UP_N = { x: 0, y: 1, z: 0 };
const D_WALL = keyIrradiance(WALL_N) / irradiance(WALL_N);
const D_FLOOR = keyIrradiance(UP_N) / irradiance(UP_N);
// 벽: 위 판이 이미 가린 창빛은 책이 다시 가릴 수 없다 → 진하기 = D_WALL·(1 − 위 판이 가린 몫). 위 판 그늘이 있는 높이만 단계(해상도)로
const WALL_STOPS = 9;
function wallInk(space: number, top: boolean) {
  if (top) return { pos: [0, 1], colors: ['black', 'black'].map(() => `rgba(0,0,0,${shadowAlpha(D_WALL)})`), y0: 0, y1: 1 };
  // 위 판 그늘이 닿는 높이: 광원 원반 아래 끝이 판 앞 모서리에 걸리는 앙각까지
  const zf = SHELF_DEPTH + SHELF_FRONT;
  let reach = 1;
  while (reach < space && keyBlocked(reach, zf) > 0) reach *= 1.2;
  const y0 = Math.max(0, space - reach);
  const pos = Array.from({ length: WALL_STOPS }, (_, i) => i / (WALL_STOPS - 1));
  return { pos, colors: pos.map((t) => `rgba(0,0,0,${shadowAlpha(D_WALL * (1 - keyBlocked(space - (y0 + (space - y0) * t), zf))).toFixed(4)})`), y0, y1: space };
}
const FLOOR_SHADOW = shadowAlpha(D_FLOOR) >= NEGLIGIBLE;

// 벽 단계(판보다 먼저): 책 → 벽 창빛 그림자. 벽 자체(색·하늘 가림·위 판 그늘)는 ShelfPlank ShelfWall이 칠한다.
// 그림자는 벽 평면 위의 모양이라 시점과 상관없다: 벽 좌표 그림(배율 = 캔버스 배율)에 책 자세가 바뀔 때만 그리고, 그리는 프레임에는
// 그 그림을 벽의 화면 자리(확대·이동)에 놓기만 한다. 그림 범위: 판 윗면이 벽에 닿는 선(y = 0, 그 아래 벽으로 가는 빛은 판 윗면을 지나야 해서
// 책이 가릴 수 없다) ~ y1(위 판 윗면이 벽에 닿는 선, 맨 윗줄은 벽 끝). 가로는 화면에 보이는 벽 범위
const NO_IMAGE = Skia.Image.MakeImage({ width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(new Uint8Array(4)), 4)!;
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
function wallShadows(key: string, poses: Poses, ids: string[], s: number, W: number, H: number, y1: number, ink: { pos: number[]; colors: string[]; y0: number; y1: number }): SkImage {
  'worklet';
  // UI 스레드에서만(파생 값은 마운트 직후 UI에서 다시 돈다)
  if (!(globalThis as { _WORKLET?: boolean })._WORKLET) return NO_IMAGE;
  const surf = Skia.Surface.MakeOffscreen(W, H);
  if (!surf) return NO_IMAGE;
  const canvas = surf.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('black'));
  for (const id of ids) {
    const b = poses[id];
    if (!b) continue;
    for (const k of BAND_KS) {
      const c = bookCast(b, s, k, true);
      if (!c || c.w <= 0) continue;
      const pts = hull(c.pts.map((q) => ({ x: (q.x - WALL_X0) * s, y: (y1 - q.y) * s })));
      if (pts.length < 3) continue;
      paint.setAlphaf(c.w);
      paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(0.01, c.sigma), true));
      canvas.drawPath(pathOf([pts]), paint);
    }
  }
  // 진하기(높이에 따른 세로 그러데이션)를 dstIn으로
  const ip = Skia.Paint();
  ip.setBlendMode(BlendMode.DstIn);
  ip.setShader(Skia.Shader.MakeLinearGradient(vec(0, (y1 - ink.y0) * s), vec(0, (y1 - ink.y1) * s), ink.colors.map((c) => Skia.Color(c)), ink.pos, TileMode.Clamp));
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), ip);
  surf.flush();
  const img = keepLatest(key, surf.makeImageSnapshot());
  surf.dispose();
  return img;
}

export const RowShadows = memo(function RowShadows({ shelfId, poses, ids, cam, px, space, top, y1 }: { shelfId: string; poses: Readonly<SharedValue<Poses>>; ids: string[]; cam: CamSV; px: Affine; space: number; top: boolean; y1: number }) {
  const s = px.s;
  const W = Math.ceil((WALL_X1 - WALL_X0) * s);
  const H = Math.ceil(y1 * s);
  const ink = useMemo(() => wallInk(space, top), [space, top]);
  const key = `wall-shadow:${shelfId}`;
  const image = useDerivedValue(() => wallShadows(key, poses.value, ids, s, W, H, y1, ink));
  // 그림 px → 캔버스 px: 벽 평면은 화면에 평행해 확대·이동뿐
  const m = useDerivedValue(() => {
    const o = toPx(cam.value, px, { x: WALL_X0, y: y1, z: SHELF_DEPTH });
    const e = toPx(cam.value, px, { x: WALL_X0 + 1 / s, y: y1 - 1 / s, z: SHELF_DEPTH });
    return [e.x - o.x, 0, o.x, 0, e.y - o.y, o.y, 0, 0, 1];
  });
  if (!SHOW.wall) return null;
  return (
    <Group zIndex={Z_WALL + 1} matrix={m}>
      <Rect x={0} y={0} width={W} height={H}>
        <ImageShader image={image} sampling={LINEAR} />
      </Rect>
    </Group>
  );
});

// 선반 윗면 위(그 줄 판 바로 다음, 책들보다 먼저): 책 → 선반 윗면 창빛 그림자. 선반 윗면 안에만.
// 거의 수평인 창빛에서는 위를 향한 면의 창빛 몫이 작아 화면에 보이지 않으면(FLOOR_SHADOW) 그리지 않는다
export const RowContacts = memo(function RowContacts({ poses, ids, cam, px, order, shelfId }: { poses: Readonly<SharedValue<Poses>>; ids: string[]; cam: CamSV; px: Affine; order: Order; shelfId: string }) {
  const s = px.s;
  const z = useDerivedValue(() => zOf(order, `plank:${shelfId}`, 5));
  // 판 아래(다른 줄)에 있는 책은 이 판에 그림자를 드리우지 않는다
  const of = useMemo(() => (b: Book3, k: number) => {
    'worklet';
    return lowest(b) < -0.5 ? null : bookCast(b, s, k, false);
  }, [s]);
  // 선반 윗면(투영된 실제 윗면 다각형) 안에만(받는 면 클리핑)
  const clip = useDerivedValue(() => {
    const f = shelfFaces(cam.value);
    return pathOf([f.top.poly.map((q) => ({ x: q.x * px.s + px.tx, y: q.y * px.s + px.ty }))]);
  });
  if (!SHOW.shelfCast || !FLOOR_SHADOW) return null;
  return (
    <Group zIndex={z} clip={clip}>
      <CastLayer poses={poses} ids={ids} of={of} cam={cam} px={px} ink={<Rect x={-FAR} y={-FAR} width={2 * FAR} height={2 * FAR} color={`rgba(0,0,0,${shadowAlpha(D_FLOOR)})`} blendMode="dstIn" />} />
    </Group>
  );
});

// ---------- 책 면이 받는 창빛 그림자: 다른 책 ----------
// 3D 단계(receivedShadow3)는 domain/received3(카메라와 무관, 순수), 투영은 received.ts recvProject.
// 이 책에 그림자를 드리울 수 있는 이웃: 이 책의 가로 범위에서 왼쪽으로 REACH_L, 오른쪽으로 REACH_R 안에 걸친 책만(빛 방향에서 유도).
// 멀리 있는 책이 움직여도 이 책은 다시 계산하지 않는다. (워클릿은 만들어질 때 쓰는 함수를 붙잡으므로 쓰이는 함수를 먼저 정의한다)
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

// 받는 그림자 한 구간: 그 구간에 드는 가리개들의 다각형(한 경로), 얇은 가리개는 w만큼
function RecvBand({ r, k }: { r: Readonly<SharedValue<Recv>>; k: number }) {
  const path = useDerivedValue(() => r.value.bands[k].path);
  const sigma = useDerivedValue(() => Math.max(0.01, r.value.bands[k].sigma));
  const op = useDerivedValue(() => r.value.bands[k].w);
  return (
    <Path path={path} color="black" opacity={op}>
      <BlurMask blur={sigma} style="normal" />
    </Path>
  );
}

// 개발용: 계산된 그림자 외곽(빨강)과 받는 면(초록)
function RecvDebug({ r }: { r: Readonly<SharedValue<Recv>> }) {
  const outline = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    for (const l of r.value.bands) p.addPath(l.path);
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

// 받는 면 하나(slot)의 그림자: 받는 면 안에서 구간들을 한 레이어에 합집합으로, 그 면의 진하기를 dstIn으로 한 번
export function ReceivedShadow({ r3, cam, px, slot, debug }: { r3: Readonly<SharedValue<Recv3>>; cam: CamSV; px: Affine; slot: number; debug?: boolean }) {
  const r = useDerivedValue(() => recvProject(r3.value, cam.value, px, slot));
  const clip = useDerivedValue(() => r.value.clip);
  const ink = useDerivedValue(() => `rgba(0,0,0,${shadowAlpha(r.value.d)})`);
  return (
    <>
      <Group clip={clip}>
        <Group layer>
          {BAND_KS.map((k) => (
            <RecvBand key={k} r={r} k={k} />
          ))}
          <Rect x={-FAR} y={-FAR} width={2 * FAR} height={2 * FAR} color={ink} blendMode="dstIn" />
        </Group>
      </Group>
      {debug ? <RecvDebug r={r} /> : null}
    </>
  );
}

// 한 책이 받는 그림자 전부(보이는 면마다). 책 그룹 안, 면 다음·갈피 전에 그린다(BookNode의 under).
// vis: 이 줄이 그리는 이 책의 자세(안 그리면 null), poses: 줄의 그림자용 자세 모음.
export function BookReceives({ vis, poses, id, ids, cam, px, debug }: { vis: Readonly<SharedValue<Book3 | null>>; poses: Readonly<SharedValue<Poses>>; id: string; ids: string[]; cam: CamSV; px: Affine; debug?: boolean }) {
  // 이 책 자세와 가리개 후보(드리울 수 있는 범위의 이웃)가 하나라도 바뀔 때만 다시 계산한다(멈춘 책은 같은 객체라 비교가 싸다).
  // 옮긴 책과 그 그림자를 받는 이웃만 다시 계산되고, 줄의 다른 책은 끄는 동안에도 계산하지 않는다. 그리지 않는 동안(vis 없음)은 비운다.
  // 파생 값으로 계산해 그리는 쪽과 같은 프레임에 나온다: 반응으로 따로 두면 그리는 쪽 계산이 먼저 돌아(반응이 쓰는 값은 순서에 들어가지
  // 않는다) 이동 캔버스에서 이 줄로 넘겨받는 프레임에 받는 그림자가 비어 책 면이 한 프레임 밝아졌다.
  // 지난 계산의 열쇠·결과는 따로 담아 두고 같으면 그대로 돌려준다(담는 값을 바꾸면 이 계산이 다음 프레임에 한 번 더 돌지만 같은 결과로 멈춘다).
  const init = useMemo(() => {
    const b = vis.value;
    if (!b) return { key: [] as Book3[], r: null as Recv3 };
    const occ = occludersIn(poses.value, b, id, ids);
    return { key: [b, ...occ], r: receivedShadow3(b, occ, px.s) };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const memo = useSharedValue<{ key: Book3[]; r: Recv3 }>(init);
  const r3 = useDerivedValue<Recv3>(() => {
    const b = vis.value;
    const last = memo.value;
    if (!b) return null;
    const occ = occludersIn(poses.value, b, id, ids);
    if (last.key.length === occ.length + 1 && last.key[0] === b && occ.every((q, i) => q === last.key[i + 1])) return last.r;
    const r = receivedShadow3(b, occ, px.s);
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

// ---------- 측정용: 투영 계산만 따로 잰다(그리기·React 없이) ----------
// 지금 자세 그대로 카메라만 기본→8°로 n번 바꿔 가며, 매 프레임 시점 전환 때 도는 투영 단계와 같은 함수를 부른다.
// 3D 단계(받는 그림자·벽/선반 그림자의 3D 점)는 책이 움직일 때만 도는 것이라 따로 한 번 잰다.
export type BenchRow = { m: Motion; px: Affine; space: number };
export function benchProjection(rows: BenchRow[], s: number, n: number) {
  'worklet';
  const clock = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
  type Prep = { b: Book3; id: string; r3: Recv3; wall: BookCast[]; shelf: BookCast[]; px: Affine };
  const prep: Prep[] = [];
  const t0 = clock();
  for (const r of rows) {
    const ids = Object.keys(r.m.tracks.value);
    for (const id of ids) {
      const b = bodyOf(r.m, id);
      if (!b) continue;
      const wall: BookCast[] = [];
      const shelf: BookCast[] = [];
      for (let k = 0; k < physShadow.bands.length; k++) wall.push(bookCast(b, s, k, true));
      for (let k = 0; k < physShadow.bands.length; k++) shelf.push(lowest(b) < -0.5 ? null : bookCast(b, s, k, false));
      const oc = occluderBodies(r.m, id, ids);
      prep.push({ b, id, r3: receivedShadow3(oc.b, oc.occ, s), wall, shelf, px: r.px });
    }
  }
  const t3d = clock() - t0;
  let tGeom = 0;
  let tRecv = 0;
  let tCast = 0;
  for (let i = 0; i < n; i++) {
    const deg = VIEW_PITCH_MIN + ((VIEW_PITCH_MAX - VIEW_PITCH_MIN) * i) / Math.max(1, n - 1);
    const cam = camAt(deg);
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
    for (const q of prep) for (let slot = 0; slot < RECV_SLOTS; slot++) recvProject(q.r3, cam, q.px, slot);
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
