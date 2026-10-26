// 선반 한 줄의 그리기(UI 스레드). 줄의 움직임(scene.ts Motion)에서 매 프레임 같은 3D 자세를 읽어
// 책 면(BookNode), 책 면이 받는 창빛 그림자, 벽·선반 윗면의 창빛 그림자, 선택 빛을 함께 그린다. React 상태는 배치가 바뀔 때만 건드린다.
// 하늘 가림(책 사이 틈·바닥 접촉·기댄 책·쌓인 책 둘레의 어둠)은 따로 그리지 않는다: 줄의 책 상자 목록(useRowBoxes)을 책 면·판·벽
// 셰이더(ui/SceneLight)가 같이 읽어 화소마다 계산한다.
// 그리는 순서(zIndex)는 장면 전체의 가림 순서(scene.ts sceneOrder: 모든 줄의 책과 선반 판)를 따른다.
// 한 줄의 좌표 변환은 px 하나(설계 단위 → 캔버스 px, 원점 = 그 줄 책 기준선 왼쪽 끝)뿐이다.
import { BlurMask, BlurStyle, Group, Path, Skia, type SkImage, type SkPath, type SkRect } from '@shopify/react-native-skia';
import { memo, useLayoutEffect, useMemo } from 'react';
import { useAnimatedReaction, useDerivedValue, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';

import { corners, fromPlaced, lowest, type Book3, type Vec3 } from '@/domain/book3';
import { camAt, project, toPx, VIEW_PITCH_MAX, VIEW_PITCH_MIN, type Affine, type Cam } from '@/domain/camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { shelfFaces } from '@/domain/shelf-geom';
import { BOX_EDGES, bookCast, castsIn, underCeil, type BookCast } from '@/domain/cast-shadow';
import { bookAlbedo, boxOf, packBoxes, withCovers, type Box, type BoxBuf, type C3, type Env } from '@/domain/light-model';
import { bookAt } from '@/domain/transition';
import { hull } from '@/domain/shadow-shape';
import { outlineOf, type BookFrame, type Point } from '@/domain/shelf-scene';
import type { Recv3 } from '@/domain/received3';
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
import { RENDER, TL, tl, tlOn, tlu } from '@/ui/perf';
import { bookKeyImage, keepLatest, NO_ATLAS, NO_IMAGE, type Atlas, type BookKey, type PlaneKey } from '@/ui/SceneLight';

import { scheduleOnUI } from 'react-native-worklets';

import { tryApplyPending } from './planner';
import { bodyOf, drawnOf, liveSV, presentSV, shadeIn, shadeOf, TRANSIT_ROW, warmSV, type Motion, type Poses } from './scene';

export type CamSV = Readonly<SharedValue<Cam>>;
type Order = Readonly<SharedValue<Record<string, number>>>;

// 그리는 순서: 순위 × 10에 책 앞뒤로 붙는 표시를 끼운다. 벽은 모든 것보다 먼저.
export const Z_WALL = -1e7;
const zOf = (order: Order, key: string, off = 0) => {
  'worklet';
  return (order.value[key] ?? 0) * 10 + off;
};

// 줄의 그림자용 자세 모음(책 id → 자세, 그림자가 없으면 null). 어느 한 권이라도 자세가 바뀔 때만 새 값이 된다:
// 줄의 진행률이 도는 동안에도 바뀐 책이 없으면(멈춘 책은 같은 객체, 다른 줄로 가며 판에 다 가린 책은 null) 그림자 계산과
// 줄 캔버스 다시 그리기가 돌지 않는다. 그림자를 그리는 쪽(벽·선반 윗면·틈·접촉·기대기·받는 그림자)은 모두 이것만 읽는다.
// ceil: 위 판 아랫면(위에 줄이 없으면 Infinity)
export function useShadePoses(m: Motion, ids: string[], space: number, shelfId = '', ceil = space): Readonly<SharedValue<Poses>> {
  // Initialize on the UI thread through the reaction below. Reading tracks in
  // React render produced a warning over the shelf whenever a row remounted.
  const poses = useSharedValue<Poses>({});
  useAnimatedReaction(
    () => ids.map((id) => shadeIn(m, id, space, ceil)),
    (cur, prev) => {
      if (prev && prev.length === cur.length && cur.every((b, i) => b === prev[i])) return;
      // 측정 번들: 그림자를 드리우던 책의 자세가 한 프레임에 없어진 경우(판에 가려 빠진 것이 아니라 자세 자체가 사라짐)를 적는다
      if (tlOn.value && prev && prev.length === cur.length)
        for (let i = 0; i < cur.length; i++) {
          const was = prev[i];
          if (!was || cur[i] || !castsIn(was, ceil)) continue;
          if (!shadeOf(m, ids[i])) tlu(`shade-drop ${ids[i]}@${shelfId}`);
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
    [ids, space, ceil],
  );
  return poses;
}

// 두 자세가 같은가(경로를 다시 짜도 도착 자세가 같으면 다시 굽지 않게)
function samePose(a: Book3, b: Book3) {
  'worklet';
  const e = 1e-3;
  return (
    Math.abs(a.t.x - b.t.x) < e && Math.abs(a.t.y - b.t.y) < e && Math.abs(a.t.z - b.t.z) < e && Math.abs(a.roll - b.roll) < e && Math.abs(a.yaw - b.yaw) < e &&
    Math.abs((a.spin ?? 0) - (b.spin ?? 0)) < e && Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) < e && Math.abs(a.dims.T - b.dims.T) < e && Math.abs(a.dims.H - b.dims.H) < e && Math.abs(a.dims.W - b.dims.W) < e
  );
}

// 하늘 가림을 구울 자세: 이 줄 경로의 도착 자세(멈춘 책은 그 자세). 경로가 다시 짜일 때만 바뀐다(진행률이 도는 동안은 그대로).
// 다른 줄로 떠난 책(이 줄 트랙이 없다)은 빠진다. 도착 자세가 같은 책은 앞 객체를 다시 쓴다(아무것도 안 바뀌면 굽기가 다시 돌지 않게)
export function useTargetPoses(m: Motion, ids: string[]): Readonly<SharedValue<Poses>> {
  const out = useSharedValue<Poses>({});
  useAnimatedReaction(
    () => m.tracks.value,
    (tracks) => {
      const old = out.value;
      const next: Poses = {};
      let changed = Object.keys(old).length !== ids.length;
      for (const id of ids) {
        const tr = tracks[id];
        let b: Book3 | null = tr ? (!tr.moving && tr.rest ? tr.rest : bookAt(tr, 1)) : null;
        const o = old[id] ?? null;
        if (b && o && b !== o && samePose(b, o)) b = o;
        if (b !== o) changed = true;
        next[id] = b;
      }
      if (changed) out.value = next;
    },
    [ids],
  );
  return out;
}

// 하늘 가림 굽기(아틀라스)를 책이 움직이기 시작할 때 도착 자세로 하고, 앞 굽기에서 FADE_MS 동안 서서히 바꾼다(셰이더가 섞는다):
// 책이 떠난 자리의 어둠은 책이 떠나는 동안 옅어지고, 도착할 자리는 책이 오는 동안 어두워진다.
// 굽기는 줄 전체를 다시 계산해 무거우므로 BAKE_GAP_MS보다 자주 굽지 않는다(끄는 동안 미리보기가 바뀔 때마다 경로가 다시 짜인다): 그 사이 바뀐
// 도착 자세는 간격이 지나면 마지막 것으로 한 번 굽는다. build: 자세 모음·상자 목록 → 굽기(워클릿, 구울 것이 없으면 NO_ATLAS)
export const FADE_MS = 200;
const BAKE_GAP_MS = 200;
export function useFadingAtlas(poses: Readonly<SharedValue<Poses>>, boxes: Readonly<SharedValue<BoxBuf>>, build: (ps: Poses, bx: BoxBuf) => Atlas): Readonly<SharedValue<Atlas>> {
  const baked = useSharedValue<Atlas>(NO_ATLAS);
  const prev = useSharedValue<Atlas | null>(null);
  const fade = useSharedValue(1);
  const wake = useSharedValue(0);
  const last = useSharedValue({ at: -1e9, ps: null as Poses | null, bx: null as BoxBuf | null, waiting: false });
  useAnimatedReaction(
    () => ({ ps: poses.value, bx: boxes.value, w: wake.value }),
    (cur) => {
      const l = last.value;
      if (cur.ps === l.ps && cur.bx === l.bx) return;
      const now = globalThis.performance ? globalThis.performance.now() : Date.now();
      if (now - l.at < BAKE_GAP_MS) {
        if (!l.waiting) {
          last.value = { ...l, waiting: true };
          wake.value = withDelay(Math.max(1, BAKE_GAP_MS - (now - l.at)), withTiming(wake.value + 1, { duration: 0 }));
        }
        return;
      }
      last.value = { at: now, ps: cur.ps, bx: cur.bx, waiting: false };
      const old = baked.value;
      const next = build(cur.ps, cur.bx);
      baked.value = next;
      // 처음 굽기(앞 굽기가 없다)는 바로 보인다
      prev.value = old.image && next.image ? old : null;
      fade.value = 0;
      fade.value = withTiming(1, { duration: FADE_MS });
    },
  );
  return useDerivedValue<Atlas>(() => {
    const a = baked.value;
    const p = prev.value;
    const f = fade.value;
    return p && f < 1 ? { image: a.image, at: a.at, prev: p, mix: f } : a;
  });
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
  function RowBook({ m, shelfId, id, dims, rest, book, cam, px, shared, recv, order, space, env, atlas, boxes }: { m: Motion; shelfId: string; id: string; dims: Book3['dims']; rest: Book3; book: Book; cam: CamSV; px: Affine; shared: Shared; recv?: { ids: string[]; debug?: boolean; poses: Readonly<SharedValue<Poses>>; ceil: number }; order: Order; space: number; env: Readonly<SharedValue<Env | null>>; atlas: Readonly<SharedValue<Atlas>>; boxes: Readonly<SharedValue<BoxBuf>> }) {
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
    const keyShadow = useBookKey(vis, recv, id, `book-key:${shelfId}:${id}`, px);
    const z = useDerivedValue(() => zOf(order, id));
    // 줄의 책 상자 목록에서 이 책(빛을 받을 때 자기 상자는 뺀다)
    const self = useDerivedValue(() => boxes.value.ids.indexOf(id));
    return <BookNode book={book} dims={dims} state={state} cam={cam} px={px} shared={shared} keyShadow={keyShadow} order={z} clip={clip} env={env} atlas={atlas} boxes={boxes} self={self} />;
  },
  (a, b) =>
    a.m === b.m && a.shelfId === b.shelfId && a.id === b.id && a.book === b.book && dimsKey(a.dims) === dimsKey(b.dims) && a.cam === b.cam && a.px === b.px && a.shared === b.shared && a.space === b.space &&
    a.recv?.ids.join('|') === b.recv?.ids.join('|') && a.recv?.debug === b.recv?.debug && a.recv?.poses === b.recv?.poses && a.recv?.ceil === b.recv?.ceil && a.order === b.order && a.env === b.env && a.atlas === b.atlas && a.boxes === b.boxes,
);

// 한 줄의 책과 그 줄에 붙는 표시(선택 빛·놓일 범위). 캔버스 안에 형제로 펼쳐 넣는다(가림 순서가 zIndex로 섞이게).
// shared는 캔버스 밖에서 읽어 넘긴다(캔버스 안에는 React 컨텍스트가 닿지 않는다). env·boxes: 이 줄의 둘레와 책 상자 목록(빛 계산)
export const RowBooks = memo(function RowBooks({ m, shelfId, st, books, glowId = null, dragId = null, cam, px, space, ceil = space, shared, order, poses, env, atlas, boxes, debug = false }: { m: Motion; shelfId: string; st: RowStruct; books: Record<string, Book>; glowId?: string | null; dragId?: string | null; cam: CamSV; px: Affine; space: number; ceil?: number; shared: Shared; order: Order; poses: Readonly<SharedValue<Poses>>; env: Readonly<SharedValue<Env | null>>; atlas: Readonly<SharedValue<Atlas>>; boxes: Readonly<SharedValue<BoxBuf>>; debug?: boolean }) {
  const ids = st.ids;
  // 책 면이 받는 창빛 그림자의 가리개 후보: 같은 줄의 다른 책(위 판 ceil이 막는 부분은 뺀다)
  const recv = useMemo(() => (SHOW.cast ? { ids, debug, poses, ceil } : undefined), [ids, debug, poses, ceil]);
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
// 낮은 시점(기본 4°)처럼 앞 책에 가려 자리가 잘 안 보일 때도 어디에 놓이는지 읽히게. 끄는 동안만(상시 선택 막대가 아니다).
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

// 고른 한 권(정보 상자·꾸미기): 보이는 윤곽 바깥으로 흰 얇은 선과 좁은 그림자 번짐(책 면·글자는 덮지 않는다, 책은 들어 올리지 않는다).
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
      <Path path={path} color={colors.selectShade}>
        <BlurMask blur={3.2 * px.s} style="outer" />
      </Path>
      <Path path={path} style="stroke" strokeWidth={3 * px.s} strokeJoin="round" color={colors.selectGlow} />
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

// 줄의 책 상자 목록(하늘 가림의 가리개): 그림자용 자세 모음에서, 이 줄 공간(판 윗면 ~ 위 판 아랫면)에 걸친 책.
// 공간 밖(다른 줄로 옮겨 가는 중 판 너머에 있는 책)은 판이 가려 이 줄 안을 가리지 않는다. 반사율은 책 몸체 재질 색에서.
// 나란히 선 책·쌓인 책은 서로 마주 보는 면을 가린다(덮개, light-model withCovers). 다른 줄 책은 판이 다 가린다
export function useRowBoxes(poses: Readonly<SharedValue<Poses>>, ids: string[], books: Record<string, Book>, env: Env): Readonly<SharedValue<BoxBuf>> {
  const albedos = useMemo(() => Object.fromEntries(ids.map((id) => [id, books[id] ? bookAlbedo(bookTone(books[id]), books[id].art.material) : ([0, 0, 0] as C3)])), [ids, books]);
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
    return packBoxes(withCovers(own), used);
  });
}

// ---------- 창빛 그림자: 책 → 벽·선반 윗면 ----------
// 책 → 벽·선반 윗면 그림자의 3D 점은 domain/cast-shadow bookCast가 만들고(빛 길이 구간마다), 여기서는 평면 좌표 그림으로 흐려 칠한다.
// castPath: 측정(benchProjection)에서 투영 비용을 잴 때
function castPath(cam: Cam, c: BookCast, px: Affine): SkPath {
  'worklet';
  if (!c) return NO_PATH;
  const pts: Point[] = [];
  for (const q of c.pts) pts.push(toPx(cam, px, q));
  return pathOf([hull(pts)]);
}
const BAND_KS = physShadow.bands.map((_, k) => k);

// 벽·판 윗면이 받는 창빛 그림자(이 줄 책들이 창빛 원반을 가리는 몫, 알파)를 평면 좌표 그림으로: 벽·판 셰이더가 빛 계산 안에서
// 창빛 몫에 곱한다(SceneLight PlaneKey). 그림자는 평면 위 모양이라 시점과 상관없다: 책 자세가 바뀔 때만 다시 그린다.
// 벽 그림 범위: 판 윗면이 벽에 닿는 선(y = 0, 그 아래 벽으로 가는 빛은 판 윗면을 지나야 해서 책이 가릴 수 없다) ~ y1, 가로는 화면에 보이는 벽.
// 판 윗면 그림 범위: 판 전체(가로 판 길이, 앞 끝 ~ 벽). 판에 가린 부분(판 윗면 아래, 위 판 ceil이 막는 빛줄기)은 bookCast가 뺀다
function planeShadows(key: string, poses: Poses, ids: string[], s: number, W: number, H: number, wall: boolean, toImg: (q: Vec3) => Point, ceil: number): SkImage {
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
      const c = bookCast(b, s, k, wall, ceil);
      if (!c || c.w <= 0) continue;
      const pts = hull(c.pts.map(toImg));
      if (pts.length < 3) continue;
      paint.setAlphaf(c.w);
      paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(0.01, c.sigma), true));
      canvas.drawPath(pathOf([pts]), paint);
    }
  }
  surf.flush();
  const img = keepLatest(key, surf.makeImageSnapshot());
  surf.dispose();
  return img;
}
export function useWallKey(shelfId: string, poses: Readonly<SharedValue<Poses>>, ids: string[], px: Affine, y1: number, ceil = Infinity): Readonly<SharedValue<PlaneKey>> {
  const s = px.s;
  const W = Math.ceil((WALL_X1 - WALL_X0) * s);
  const H = Math.ceil(y1 * s);
  const key = `wall-shadow:${shelfId}`;
  const on = SHOW.wall && RENDER.books;
  return useDerivedValue(() => ({
    image: on ? planeShadows(key, poses.value, ids, s, W, H, true, (q) => ({ x: (q.x - WALL_X0) * s, y: (y1 - q.y) * s }), ceil) : NO_IMAGE,
    kU: [s, 0, 0],
    kV: [0, -s, 0],
    kO: [-WALL_X0 * s, y1 * s],
  }));
}
export function useFloorKey(shelfId: string, poses: Readonly<SharedValue<Poses>>, ids: string[], px: Affine, ceil = Infinity): Readonly<SharedValue<PlaneKey>> {
  const s = px.s;
  const W = Math.ceil((SHELF_X1 - SHELF_X0) * s);
  const H = Math.ceil((SHELF_DEPTH + SHELF_FRONT) * s);
  const key = `floor-shadow:${shelfId}`;
  const on = SHOW.shelfCast && RENDER.books;
  return useDerivedValue(() => ({
    image: on ? planeShadows(key, poses.value, ids, s, W, H, false, (q) => ({ x: (q.x - SHELF_X0) * s, y: (q.z + SHELF_FRONT) * s }), ceil) : NO_IMAGE,
    kU: [s, 0, 0],
    kV: [0, 0, s],
    kO: [-SHELF_X0 * s, SHELF_FRONT * s],
  }));
}

// ---------- 책 면이 받는 창빛 그림자: 다른 책 ----------
// 3D 단계(receivedShadow3)는 domain/received3(카메라와 무관, 순수), 면 좌표 그림은 SceneLight bookKeyImage.
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

// 자세 b(이 줄 좌표)의 책에 그림자를 드리울 수 있는 책(자세 모음에서, 막 떠난 책의 남은 경로 포함).
// ceil: 위 판 아랫면(위에 줄이 없으면 Infinity). 판 앞을 지나는 책은 위 판이 막는 부분을 뺀 상자로(cast-shadow underCeil)
export function occludersIn(poses: Poses, b: Book3, id: string, ids: string[], ceil = Infinity): Book3[] {
  'worklet';
  const me = xRangeOf(b);
  const occ: Book3[] = [];
  for (const o of ids) {
    if (o === id) continue;
    const p = poses[o];
    const ob = p ? underCeil(p, ceil) : null;
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

// 한 책이 받는 창빛 그림자(다른 책이 창빛 원반을 가리는 몫)를 면 좌표 그림으로(SceneLight bookKeyImage). 책 셰이더가 빛 계산 안에서 쓴다.
// 카메라와 무관해 시점을 끄는 동안에는 다시 그리지 않는다. vis: 이 줄이 그리는 이 책의 자세(안 그리면 null), recv: 줄의 그림자용 자세 모음과 책들(없으면 그림자 없음).
// 이 책 자세와 가리개 후보(드리울 수 있는 범위의 이웃)가 하나라도 바뀔 때만 다시 계산한다(멈춘 책은 같은 객체라 비교가 싸다).
// 파생 값으로 계산해 그리는 쪽과 같은 프레임에 나온다(반응으로 따로 두면 이동 캔버스에서 넘겨받는 프레임에 그림자가 비어 책 면이 한 프레임 밝아졌다)
export function useBookKey(vis: Readonly<SharedValue<Book3 | null>>, recv: { ids: string[]; poses: Readonly<SharedValue<Poses>>; ceil?: number } | undefined, id: string, key: string, px: Affine): Readonly<SharedValue<BookKey>> {
  const poses = recv?.poses;
  const ids = recv?.ids ?? [];
  const ceil = recv?.ceil ?? Infinity;
  const memo = useSharedValue<{ key: Book3[]; r: Recv3 }>({ key: [], r: null });
  const r3 = useDerivedValue<Recv3>(() => {
    const b = vis.value;
    if (!b || !poses) return null;
    const last = memo.value;
    const occ = occludersIn(poses.value, b, id, ids, ceil);
    if (last.key.length === occ.length + 1 && last.key[0] === b && occ.every((q, i) => q === last.key[i + 1])) return last.r;
    const r = receivedShadow3(b, occ, px.s);
    memo.value = { key: [b, ...occ], r };
    return r;
  });
  return useDerivedValue(() => bookKeyImage(key, r3.value, px.s));
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
    for (const q of prep) {
      for (const c of q.wall) castPath(cam, c, q.px);
      for (const c of q.shelf) castPath(cam, c, q.px);
    }
    tCast += clock() - a;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { books: prep.length, shadow3d: r2(t3d), faces: r2(tGeom / n), cast: r2(tCast / n) };
}

export { project };
