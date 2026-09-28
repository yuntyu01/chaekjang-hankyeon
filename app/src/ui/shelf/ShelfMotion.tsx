// 선반 한 줄의 움직임. 배치가 바뀌면 관련 책 전부의 경로를 공통 진행률 t 하나로 짜고(domain/transition),
// 매 프레임(UI 스레드) 같은 3D 자세에서 책 면(BookNode), 벽 그림자, 바닥 접촉을 함께 계산한다.
// 경로 계획의 입력은 "지금 화면에 보이는 자세"(움직이는 도중이면 그 보간값)라 도중에 다시 조작해도 튀지 않는다.
// React 상태는 배치가 바뀔 때만 건드리고, 프레임마다는 SharedValue만 바뀐다. 동작 줄이기 설정이면 즉시 적용.
import { BlurMask, Canvas, Group, LinearGradient, Path, Skia, vec, type SkPath } from '@shopify/react-native-skia';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { corners, depthKey, drawOrder, faceCorners, faceNormal, FACE_IDS, facing, fromPlaced, lowest, rot, viewCam, type Book3, type Cam, type FaceId, type Vec3 } from '@/domain/book3';
import { project } from '@/domain/box';
import { DESIGN_WIDTH, SHELF, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1, VIEW_KY as CAMERA_KY } from '@/domain/geometry';
import { shelfFaces } from '@/domain/shelf-geom';
import { onFloor, onWall, rayLength, shadowOnPlane, travelOf } from '@/domain/cast-shadow';
import { hull, rgba } from '@/domain/shadow-shape';
import { PLANK_BOUNDS, type BookFrame, type Point } from '@/domain/shelf-scene';
import { bookAt, planTransition, type Track } from '@/domain/transition';
import type { Book } from '@/domain/types';
import { useBookShared, type Shared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import { mainFace } from '@/ui/book3d/face-geometry';
import type { Affine } from '@/ui/book3d/face-geometry';
import { colors, light, shadow } from '@/ui/theme';
import { SHOW } from '@/ui/shelf/shadow-debug';

const FLOOR = SHELF.clearHeight;
export const MOTION_MS = 230; // 기울이기·밀림
export const POSE_MS = 420; // 자세 바꾸기(표지로·눕히기)
const LIFT_DU = 7;

type Tracks = Record<string, Track>;
export type Motion = {
  tracks: SharedValue<Tracks>;
  t: SharedValue<number>;
  liftId: SharedValue<string | null>;
  lift: SharedValue<number>;
};

export const holdTrack = (b: Book3): Track => ({
  id: b.id,
  dims: b.dims,
  moving: false,
  segs: [{ kind: 0, t0: 0, t1: 1, r0: b.roll, r1: b.roll, y0: b.yaw, y1: b.yaw, sp0: b.spin ?? 0, sp1: b.spin ?? 0, a: { x: 0, y: 0, z: 0 }, w0: b.t, w1: b.t, al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0 }],
});

// 진행률 t에서 이 책의 자세(들림 포함). 경로가 없으면 null.
export function stateNow(m: Motion, id: string): Book3 | null {
  'worklet';
  const tr = m.tracks.value[id];
  if (!tr) return null;
  const b = bookAt(tr, m.t.value);
  if (m.liftId.value === id && m.lift.value > 0) return { ...b, t: { x: b.t.x, y: b.t.y + LIFT_DU * m.lift.value, z: b.t.z } };
  return b;
}

// 지금 보이는 자세(JS 스레드, 조작할 때 읽는다)
export function currentStates(m: Motion): Record<string, Book3> {
  const out: Record<string, Book3> = {};
  const t = m.t.value;
  for (const [id, tr] of Object.entries(m.tracks.value)) out[id] = bookAt(tr, t);
  return out;
}

const registry = new Map<string, Motion>();
export const motionOf = (shelfId: string) => registry.get(shelfId);

// 끄는 동안 미리보기: React 상태를 거치지 않고 이 선반의 경로만 바로 바꾼다.
// 놓아서 확정되면 같은 모습에서 이어받고, 확정되지 않으면 원래 프레임으로 다시 부른다.
const previewers = new Map<string, (frames: BookFrame[]) => void>();
export const previewShelf = (shelfId: string, frames: BookFrame[]) => previewers.get(shelfId)?.(frames);

export function useShelfMotion(shelfId: string, frames: BookFrame[], reduceMotion: boolean, selectedId: string | null): Motion {
  const [init] = useState<Tracks>(() => Object.fromEntries(frames.filter((f) => f.box).map((f) => [f.bookId, holdTrack(fromPlaced(f.box!))])));
  const tracks = useSharedValue<Tracks>(init);
  const t = useSharedValue(1);
  const liftId = useSharedValue<string | null>(null);
  const lift = useSharedValue(0);
  const current = useRef<Tracks>(init);
  const first = useRef(true);
  const m = useMemo(() => ({ tracks, t, liftId, lift }), [tracks, t, liftId, lift]);
  registry.set(shelfId, m);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // 지금 보이는 모습(진행 중이면 그 중간)에서 새 배치로
    const now = t.value;
    const prev = Object.values(current.current).map((tr) => bookAt(tr, now));
    const next = frames.filter((f) => f.box).map((f) => fromPlaced(f.box!));
    const plan = reduceMotion ? null : planTransition(prev, next, PLANK_BOUNDS);
    const rec: Tracks = plan ? Object.fromEntries(plan.tracks.map((tr) => [tr.id, tr])) : Object.fromEntries(next.map((b) => [b.id, holdTrack(b)]));
    current.current = rec;
    const animate = !!plan && plan.strategy !== 'still';
    const posing = !!plan && /al|pull/.test(plan.strategy);
    const dur = posing ? POSE_MS : MOTION_MS;
    scheduleOnUI(() => {
      'worklet';
      tracks.value = rec;
      t.value = animate ? 0 : 1;
      if (animate) t.value = withTiming(1, { duration: dur, easing: Easing.inOut(Easing.cubic) });
    });
  }, [frames, reduceMotion, tracks, t]);

  useEffect(() => {
    previewers.set(shelfId, (fr) => {
      const rec: Tracks = Object.fromEntries(fr.filter((f) => f.box).map((f) => [f.bookId, holdTrack(fromPlaced(f.box!))]));
      current.current = rec;
      scheduleOnUI(() => {
        'worklet';
        tracks.value = rec;
        t.value = 1;
      });
    });
    return () => {
      previewers.delete(shelfId);
    };
  }, [shelfId, tracks, t]);

  useLayoutEffect(() => {
    const id = selectedId;
    const dur = reduceMotion ? 0 : 160;
    scheduleOnUI(() => {
      'worklet';
      if (id) {
        liftId.value = id;
        lift.value = withTiming(1, { duration: dur });
      } else lift.value = withTiming(0, { duration: dur });
    });
  }, [selectedId, reduceMotion, liftId, lift]);

  return m;
}

// ---------- 개발용 형상 보기: 상자 모서리 12개, 바닥 지지 영역(선반 위 투영). 일반 화면에는 나오지 않는다 ----------
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];
function DebugGeom({ m, id, cam, px }: { m: Motion; id: string; cam: Cam; px: Affine }) {
  const edges = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const b = stateNow(m, id);
    if (!b) return p.detach();
    const c = corners(b).map((q) => project(cam, q));
    for (const [i, j] of EDGES) {
      p.moveTo(c[i].x * px.s + px.tx, c[i].y * px.s + px.ty);
      p.lineTo(c[j].x * px.s + px.tx, c[j].y * px.s + px.ty);
    }
    return p.detach();
  });
  const support = useDerivedValue(() => {
    const b = stateNow(m, id);
    if (!b) return pathOf([]);
    const cs = corners(b);
    const lo = lowest(b);
    const base = cs.filter((q) => q.y < lo + 0.6).map((q) => project(cam, q)).map((q) => ({ x: q.x * px.s + px.tx, y: q.y * px.s + px.ty }));
    return pathOf([hull(base)]);
  });
  return (
    <Group zIndex={1e6}>
      <Path path={edges} style="stroke" strokeWidth={1} color="rgba(30,90,200,0.8)" />
      <Path path={support} color="rgba(40,170,90,0.35)" />
    </Group>
  );
}

// 계산상의 선반(shelf-geom): 윗면·앞면·옆면 외곽과 책 기준선(z=0). 그려진 판과 겹쳐 맞는지 본다.
function DebugShelf({ cam, px }: { cam: Cam; px: Affine }) {
  const path = useMemo(() => {
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
    const a = P(project(cam, { x: SHELF_X0, y: 0, z: 0 }));
    const b = P(project(cam, { x: SHELF_X1, y: 0, z: 0 }));
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
    return p.detach();
  }, [cam, px]);
  return <Path path={path} style="stroke" strokeWidth={1.2} color="rgba(200,40,150,0.85)" />;
}

function shelfFacesPx(cam: Cam, s: number, clear: number) {
  const f = shelfFaces(cam);
  const px = (q: Point) => ({ x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - FLOOR) * s });
  return { f, px };
}

// ---------- 책(한 캔버스에 줄 전체) ----------

// 선반을 다시 계산하면 프레임 객체는 새로 생기지만 상자가 같으면 그대로 둔다(면 워크릿을 다시 만들지 않게)
const boxKey = (f: BookFrame) => JSON.stringify(f.box);
const RowBook = memo(
  function RowBook({ m, frame, book, cam, px, shared, recv, ranks }: { m: Motion; frame: BookFrame; book: Book; cam: Cam; px: Affine; shared: Shared; recv?: { ids: string[]; clear: number; plankAbove: boolean }; ranks?: Readonly<SharedValue<Record<string, number>>> }) {
  const key = boxKey(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rest = useMemo(() => fromPlaced(frame.box!), [key]);
  const id = frame.bookId;
  const state = useDerivedValue(() => stateNow(m, id) ?? rest);
  const under = recv ? <BookReceives m={m} id={id} ids={recv.ids} cam={cam} px={px} clear={recv.clear} plankAbove={recv.plankAbove} /> : null;
  const order = useDerivedValue(() => (ranks ? (ranks.value[id] ?? 0) * 10 : 0));
  return <BookNode book={book} dims={rest.dims} state={state} cam={cam} px={px} shared={shared} under={under} order={ranks ? order : undefined} />;
  },
  (a, b) =>
    a.m === b.m && a.book === b.book && a.cam === b.cam && a.px === b.px && a.shared === b.shared && boxKey(a.frame) === boxKey(b.frame) &&
    a.recv?.ids.join('|') === b.recv?.ids.join('|') && a.recv?.clear === b.recv?.clear && a.recv?.plankAbove === b.recv?.plankAbove && a.ranks === b.ranks,
);

export const RowBooks = memo(function RowBooks({ m, frames, books, hiddenId, cam, s, clear, height, debug = false, plankAbove = false }: { m: Motion; frames: BookFrame[]; books: Record<string, Book>; hiddenId: string | null; cam: Cam; s: number; clear: number; height: number; debug?: boolean; plankAbove?: boolean }) {
  const px = useMemo(() => ({ s, tx: SHELF.sideMargin * s, ty: (clear - FLOOR) * s }), [s, clear]);
  const shared = useBookShared();
  // 책 면이 받는 그림자의 가리개 후보(끌고 있는 책 제외)
  const idKey = frames.filter((f) => f.box && f.bookId !== hiddenId).map((f) => f.bookId).join('|');
  const recv = useMemo(() => (SHOW.cast ? { ids: idKey ? idKey.split('|') : [], clear, plankAbove } : undefined), [idKey, clear, plankAbove]);
  // 가림 순서: 지금 프레임의 3D 상자들로 화면에서 겹치는 쌍의 앞뒤를 정해 위상 정렬(움직이는 동안에도 매 프레임)
  const allKey = frames.filter((f) => f.box).map((f) => f.bookId).join('|');
  const all = useMemo(() => (allKey ? allKey.split('|') : []), [allKey]);
  const ranks = useDerivedValue(() => {
    const bs: Book3[] = [];
    const ids: string[] = [];
    for (const id of all) {
      const b = stateNow(m, id);
      if (b) {
        bs.push(b);
        ids.push(id);
      }
    }
    const r = drawOrder(bs, cam, depthKey);
    const out: Record<string, number> = {};
    ids.forEach((id, i) => (out[id] = r[i]));
    return out;
  });
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      <Group>
        {frames
          .filter((f) => f.box)
          .map((f) =>
            f.bookId === hiddenId ? (
              // 끌고 있는 책이 놓일 자리: 옅은 실루엣(손가락에 가려도 최종 위치가 보이게)
              <Group key={f.bookId} opacity={0.32} zIndex={-1e6}>
                <RowBook m={m} frame={f} book={books[f.bookId]} cam={cam} px={px} shared={shared} />
              </Group>
            ) : (
              <RowBook key={f.bookId} m={m} frame={f} book={books[f.bookId]} cam={cam} px={px} shared={shared} recv={recv} ranks={ranks} />
            ),
          )}
        {debug ? frames.filter((f) => f.box).map((f) => <DebugGeom key={`dbg${f.bookId}`} m={m} id={f.bookId} cam={cam} px={px} />) : null}
        {debug ? <DebugShelf cam={cam} px={px} /> : null}
        {frames
          .filter((f) => f.box && f.bookId !== hiddenId && f.stackIndex > 0)
          .map((f) => {
            const lower = frames.find((g) => g.itemKey === f.itemKey && g.stackIndex === f.stackIndex - 1);
            return SHOW.stack && lower ? <StackShade key={`sh${f.bookId}`} m={m} id={f.bookId} lowerId={lower.bookId} cam={cam} px={px} ranks={ranks} /> : null;
          })}
        {SHOW.lean ? <LeanContacts m={m} ids={frames.filter((f) => f.box && f.bookId !== hiddenId).map((f) => f.bookId)} cam={cam} px={px} /> : null}
      </Group>
    </Canvas>
  );
});

// ---------- 벽 그림자(선반 판 아래에 그린다)·바닥 접촉 ----------

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

function outlineOf(cam: Cam, b: Book3): Point[] {
  'worklet';
  const c0 = viewCam(cam, b);
  return hull(corners(b).map((c) => project(c0, c)));
}

// ---------- 실제 그림자: 광원 방향으로 받는 면에 투영 ----------
const LIGHT = travelOf(light.dir); // 빛이 나아가는 방향(면 밝기와 같은 광원)
type Cast = { path: SkPath; color: string; blur: number };
const NO_CAST: Cast = { path: Skia.PathBuilder.Make().detach(), color: 'rgba(0,0,0,0)', blur: 0 };

// 책 상자에서 빛 길이 f(v)(받는 면까지 빛이 가는 거리)가 L 이하인 부분의 꼭짓점: 모서리 + 12개 변이 f = L을 지나는 점.
// 이 부분이 받는 면에 만드는 그림자가 "가까운 층"이다(가리는 물체에 가까워 선명하고 진하다).
function nearPart(cs: Vec3[], f: number[], L: number): Vec3[] {
  'worklet';
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) if (f[i] <= L) out.push(cs[i]);
  for (const [i, j] of EDGES) {
    if ((f[i] - L) * (f[j] - L) >= 0) continue;
    const t = (L - f[i]) / (f[j] - f[i]);
    out.push({ x: cs[i].x + (cs[j].x - cs[i].x) * t, y: cs[i].y + (cs[j].y - cs[i].y) * t, z: cs[i].z + (cs[j].z - cs[i].z) * t });
  }
  return out;
}

type Layered = { layers: number[]; opacity: number; near: number; perDU: number; maxBlur: number };

// k번째 층: 빛 길이 layers[k] 이하 부분을 받는 면에 떨어뜨린 볼록 외곽
function layerCast(cam: Cam, b: Book3, s: number, clear: number, k: number, wall: boolean): Cast {
  'worklet';
  const w: Layered = wall ? shadow.cast.bookWall : shadow.cast.bookShelf;
  const cs = corners(b);
  const f = cs.map((c) => (wall ? Math.max(0, (SHELF_DEPTH - c.z) / LIGHT.z) : Math.max(0, c.y / -LIGHT.y)));
  // 층은 책에서 가장 가까운 면(벽이면 책 뒷면, 선반이면 바닥)부터 잰다: 책과 벽 사이가 떨어져 있어도 가장 가까운 층이 비지 않게
  let f0 = Infinity;
  for (const v of f) f0 = Math.min(f0, v);
  const L = f0 + w.layers[k];
  const part = nearPart(cs, f, L);
  if (part.length < 3) return NO_CAST;
  let far = 0;
  const pts: Point[] = [];
  for (const c of part) {
    const q = wall ? onWall(c, LIGHT, SHELF_DEPTH) : onFloor(c, LIGHT, 0);
    far = Math.max(far, rayLength(c, q));
    const p = project(cam, q);
    pts.push({ x: (SHELF.sideMargin + p.x) * s, y: (clear + p.y - FLOOR) * s });
  }
  return { path: pathOf([hull(pts)]), color: rgba(shadow.color, w.opacity), blur: Math.min(w.maxBlur, w.near + w.perDU * far) * s };
}

// 그림자 한 권·한 층: 불투명하게 그려 층(CastLayer) 안에서 합쳐지게 한다
function CastShadow({ m, id, of, k }: { m: Motion; id: string; of: (b: Book3, k: number) => Cast; k: number }) {
  const c = useDerivedValue(() => {
    const b = stateNow(m, id);
    return b ? of(b, k) : NO_CAST;
  });
  const path = useDerivedValue(() => c.value.path);
  const blur = useDerivedValue(() => c.value.blur / 2);
  return (
    <Path path={path} color={shadow.color}>
      <BlurMask blur={blur} style="normal" />
    </Path>
  );
}

// 한 층의 그림자들을 한 장에 합친 뒤 층 진하기로 한 번만 얹는다(같은 광원의 그림자가 겹쳐도 계속 어두워지지 않는다)
function CastLayer({ m, ids, of, k, opacity }: { m: Motion; ids: string[]; of: (b: Book3, k: number) => Cast; k: number; opacity: number }) {
  const paint = useMemo(() => {
    const p = Skia.Paint();
    p.setAlphaf(opacity);
    return p;
  }, [opacity]);
  return (
    <Group layer={paint}>
      {ids.map((id) => (
        <CastShadow key={id} m={m} id={id} of={of} k={k} />
      ))}
    </Group>
  );
}

// 책 사이 틈 어둠(벽 쪽): 앞줄에 선 책끼리 틈이 좁을수록 진하고 fadeAt 이상이면 없다. 틈 영역 안에만.
function gapShapes(m: Motion, ids: string[], cam: Cam, s: number, clear: number) {
  'worklet';
  const g = shadow.ao.gap;
  const row: { lo: number; hi: number; top: number; z: number }[] = [];
  for (const id of ids) {
    const b = stateNow(m, id);
    if (!b || lowest(b) > 0.5) continue;
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
    const P = (x: number, y: number) => {
      const q = project(cam, { x, y, z: 0 });
      return { x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - FLOOR) * s };
    };
    out.push({ rect: [P(row[i].hi, h), P(row[i + 1].lo, h), P(row[i + 1].lo, 0), P(row[i].hi, 0)], a: g.max * (1 - d / g.fadeAt) });
  }
  return out;
}

function GapShade({ m, ids, cam, s, clear, band }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; band: number }) {
  // 진하기 단계(band)별로 한 경로씩: 틈마다 색이 달라서
  const path = useDerivedValue(() => {
    const polys: Point[][] = [];
    for (const g of gapShapes(m, ids, cam, s, clear)) {
      const lvl = Math.min(3, Math.floor((g.a / shadow.ao.gap.max) * 4));
      if (lvl === band) polys.push(g.rect);
    }
    return pathOf(polys);
  });
  return <Path path={path} color={rgba(shadow.color, shadow.ao.gap.max * ((band + 0.5) / 4))} />;
}

// 기댄 책이 받치는 책에 닿는 곳(책 위에 그린다): 닿는 점에 좁고 진한 어둠, 그 아래 벌어진 틈은 넓어지며 부드럽게 옅어진다.
// 쐐기 = [닿는 점, 받치는 책 쪽 바닥, 기댄 책 바닥 모서리]. 받치는 책의 옆면·틈 너머 벽이 받는 면이다.
function leanContactShapes(m: Motion, ids: string[], cam: Cam, px: Affine) {
  'worklet';
  const out: { tri: Point[]; top: Point; mid: Point }[] = [];
  for (const id of ids) {
    const b = stateNow(m, id);
    if (!b || Math.abs(b.roll) < 1 || Math.abs(b.roll) > 45 || lowest(b) > 0.5) continue;
    const dir = b.roll > 0 ? 1 : -1;
    const cs = corners(b);
    let top = cs[0];
    let foot = cs[0];
    for (const c of cs) {
      if (c.x * dir > top.x * dir + 1e-6 || (Math.abs(c.x - top.x) < 1e-6 && c.z < top.z)) top = c;
      if (c.y < 0.5 && (c.x * dir > foot.x * dir + 1e-6 || foot.y >= 0.5)) foot = c;
    }
    const cb = viewCam(cam, b);
    const P = (x: number, y: number, z: number) => {
      const q = project(cb, { x, y, z });
      return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty };
    };
    const A = P(top.x, top.y, top.z);
    const B = P(top.x, 0, top.z);
    const C = P(foot.x, 0, top.z);
    out.push({ tri: [A, B, C], top: A, mid: { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 } });
  }
  return out;
}

function LeanContacts({ m, ids, cam, px }: { m: Motion; ids: string[]; cam: Cam; px: Affine }) {
  const w = useDerivedValue(() => leanContactShapes(m, ids, cam, px));
  return (
    <Group zIndex={1e5}>
      {[0, 1, 2, 3].map((i) => (
        <LeanContact key={i} w={w} i={i} s={px.s} />
      ))}
    </Group>
  );
}

function LeanContact({ w, i, s }: { w: Readonly<SharedValue<{ tri: Point[]; top: Point; mid: Point }[]>>; i: number; s: number }) {
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
    <Group>
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
// 받는 면(책 앞면·윗면 중 빛을 받는 면)의 평면으로, 가리는 물체의 꼭짓점을 빛 방향으로 떨어뜨린다.
// 면보다 빛 쪽(앞)에 있는 부분만 그림자를 만든다(면 뒤쪽 꼭짓점은 버리고 면을 지나는 변은 교점으로 자른다).
// 결과는 받는 면 다각형 안으로만 자른다. 가리는 물체가 옮겨 가면 그림자도 옮겨 가거나 사라진다.
// 이 줄 위 선반 판(윗 줄의 판)의 상자: 판 앞 아래 모서리가 이 줄 맨 위(화면 y = 0)에 오도록
function plankAboveBox(clear: number): Vec3[] {
  'worklet';
  const y0 = clear + SHELF_FRONT * CAMERA_KY;
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) out.push({ x: i & 1 ? SHELF_X1 : SHELF_X0, y: i & 2 ? y0 + SHELF_THICK : y0, z: i & 4 ? SHELF_DEPTH : -SHELF_FRONT });
  return out;
}

// 한 면이 받는 그림자: 가리개마다 따로(각자 가까운 곳이 진한 그라데이션), 최대 RECV_PARTS개(가까운 순).
// 한 층(RECV_LAYER)에 불투명도 비율로 그려 겹친 곳도 가장 진한 그림자 이상으로 어두워지지 않게 한다.
type Part = { path: SkPath; blur: number; a: Point; b: Point; colors: string[] };
type Recv = { clip: SkPath; parts: Part[] };
const EMPTY_PATH = Skia.PathBuilder.Make().detach();
const RECV_STOPS = [0, 0.2, 0.45, 1];
const NO_PART: Part = { path: EMPTY_PATH, blur: 0, a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, colors: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'] };
const RECV_PARTS = 3;
const NO_RECV: Recv = { clip: EMPTY_PATH, parts: [NO_PART, NO_PART, NO_PART] };
const RECV_LAYER = Math.max(shadow.cast.onBook.opacity, shadow.cast.onBookPlank.opacity);

// slot: 이 책의 보이는 면 중 k번째. 가리개 = 같은 줄의 다른 책 + 윗 선반 판.
function receivedShadow(m: Motion, id: string, ids: string[], cam: Cam, px: Affine, clear: number, plankAbove: boolean, slot: number): Recv {
  'worklet';
  const b = stateNow(m, id);
  if (!b) return NO_RECV;
  const cb = viewCam(cam, b);
  // 보이는 면(아래를 향한 면 제외)을 앞을 향한 순서로
  const faces: FaceId[] = [];
  const score: number[] = [];
  for (const fid of FACE_IDS) {
    const fv = facing(cb, b, fid);
    if (fv <= 0.002) continue;
    if (rot(b.roll, b.yaw, faceNormal(fid), b.spin ?? 0).y < -0.5) continue;
    let k = 0;
    while (k < faces.length && score[k] >= fv) k++;
    faces.splice(k, 0, fid);
    score.splice(k, 0, fv);
  }
  const f = faces[slot];
  if (!f) return NO_RECV;
  const n = rot(b.roll, b.yaw, faceNormal(f), b.spin ?? 0);
  const cs = corners(b);
  const fc = faceCorners(f).map((i) => cs[i]);
  const P = (q: Vec3) => {
    const p = project(cb, q);
    return { x: p.x * px.s + px.tx, y: p.y * px.s + px.ty };
  };
  const occs: Vec3[][] = [];
  for (const o of ids) {
    if (o === id) continue;
    const ob = stateNow(m, o);
    if (ob) occs.push(corners(ob));
  }
  const nb = occs.length;
  if (plankAbove) occs.push(plankAboveBox(clear));
  const found: { d: number; part: Part }[] = [];
  for (let k = 0; k < occs.length; k++) {
    const r = shadowOnPlane(occs[k], fc[0], n, LIGHT);
    if (r.pts.length < 3 || !r.near || !r.far) continue;
    const w = k >= nb ? shadow.cast.onBookPlank : shadow.cast.onBook;
    const rel = w.opacity / RECV_LAYER;
    const colors = RECV_STOPS.map((u) => rgba(shadow.color, rel * Math.exp(-(r.dist + (r.tFar - r.dist) * u) / w.fade)));
    found.push({
      d: r.dist,
      part: { path: pathOf([hull(r.pts.map(P))]), blur: Math.min(w.maxBlur, w.near + w.perDU * r.dist) * px.s, a: P(r.near), b: P(r.far), colors },
    });
  }
  if (!found.length) return NO_RECV;
  found.sort((x, y) => x.d - y.d);
  const parts: Part[] = [];
  for (let k = 0; k < RECV_PARTS; k++) parts.push(found[k] ? found[k].part : NO_PART);
  return { clip: pathOf([fc.map(P)]), parts };
}

function RecvPart({ r, k }: { r: Readonly<SharedValue<Recv>>; k: number }) {
  const path = useDerivedValue(() => r.value.parts[k].path);
  const blur = useDerivedValue(() => r.value.parts[k].blur / 2);
  const a = useDerivedValue(() => vec(r.value.parts[k].a.x, r.value.parts[k].a.y));
  const b = useDerivedValue(() => vec(r.value.parts[k].b.x, r.value.parts[k].b.y));
  const colors = useDerivedValue(() => r.value.parts[k].colors);
  return (
    <Path path={path}>
      <LinearGradient start={a} end={b} colors={colors} positions={RECV_STOPS} />
      <BlurMask blur={blur} style="normal" />
    </Path>
  );
}

function ReceivedShadow({ m, id, ids, cam, px, clear, plankAbove, slot }: { m: Motion; id: string; ids: string[]; cam: Cam; px: Affine; clear: number; plankAbove: boolean; slot: number }) {
  const r = useDerivedValue(() => receivedShadow(m, id, ids, cam, px, clear, plankAbove, slot));
  const clip = useDerivedValue(() => r.value.clip);
  const paint = useMemo(() => {
    const p = Skia.Paint();
    p.setAlphaf(RECV_LAYER);
    return p;
  }, []);
  return (
    <Group clip={clip} layer={paint}>
      {Array.from({ length: RECV_PARTS }, (_, k) => (
        <RecvPart key={k} r={r} k={k} />
      ))}
    </Group>
  );
}

// 한 책이 받는 그림자 전부(보이는 면마다, 다른 책·윗 선반 판을 합쳐서). 책 그룹 안, 면 다음·갈피 전에 그린다(BookNode의 under).
export function BookReceives({ m, id, ids, cam, px, clear, plankAbove }: { m: Motion; id: string; ids: string[]; cam: Cam; px: Affine; clear: number; plankAbove: boolean }) {
  return (
    <Group>
      {[0, 1, 2].map((slot) => (
        <ReceivedShadow key={slot} m={m} id={id} ids={ids} cam={cam} px={px} clear={clear} plankAbove={plankAbove} slot={slot} />
      ))}
    </Group>
  );
}

// 벽 단계(판보다 먼저): 책 → 벽 실제 그림자 + 책 사이 틈 어둠(주변광 차폐)
export const RowShadows = memo(function RowShadows({ m, ids, cam, s, clear, height }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; height: number }) {
  const of = useMemo(() => (b: Book3, k: number) => {
    'worklet';
    return layerCast(cam, b, s, clear, k, true);
  }, [cam, s, clear]);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      {SHOW.wall ? shadow.cast.bookWall.layers.map((_, k) => <CastLayer key={k} m={m} ids={ids} of={of} k={k} opacity={shadow.cast.bookWall.opacity} />) : null}
      {SHOW.gap ? [0, 1, 2, 3].map((b) => <GapShade key={b} m={m} ids={ids} cam={cam} s={s} clear={clear} band={b} />) : null}
    </Canvas>
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

function contactShapes(b: Book3, cam0: Cam, s: number, clear: number) {
  'worklet';
  const cam = viewCam(cam0, b);
  const f = footPoly(b);
  const P = (x: number, z: number, dy = 0, dx = 0) => {
    const q = project(cam, { x, y: f.y, z });
    return { x: (SHELF.sideMargin + q.x) * s + dx * s, y: (clear + q.y - FLOOR) * s + dy * s };
  };
  const c = shadow.ao.contact;
  // 닿는 곳: 앞을 향한 바닥 모서리(바깥 법선이 사용자 쪽)마다 바로 앞 좁고 진한 띠
  const band: Point[][] = [];
  const n = f.pts.length;
  for (let i = 0; i < n; i++) {
    const a = f.pts[i];
    const e = f.pts[(i + 1) % n];
    // 시계 반대 순서의 바깥 법선(x-z 평면): (dz, -dx)
    const nx = e.z - a.z;
    const nz = -(e.x - a.x);
    const l = Math.hypot(nx, nz) || 1;
    if (nz / l > -0.3) continue;
    band.push([P(a.x - 0.3, a.z), P(e.x + 0.6, e.z), P(e.x + 0.6, e.z, c.height * 0.5), P(a.x - 0.3, a.z, c.height * 0.5)]);
  }
  return { band, foot: f.pts.map((q) => P(q.x, q.z)) };
}

export const RowContacts = memo(function RowContacts({ m, ids, cam, s, clear, height, front = false }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; height: number; front?: boolean }) {
  // 선반에서 떨어진(들린·쌓인 위) 책은 접촉이 없다
  const shapes = useDerivedValue(() => {
    const band: Point[][] = [];
    const foot: Point[][] = [];
    for (const id of ids) {
      const b = stateNow(m, id);
      if (!b || lowest(b) > 0.5) continue;
      const c = contactShapes(b, cam, s, clear);
      for (const q of c.band) band.push(q);
      foot.push(c.foot);
    }
    return { band: pathOf(band), foot: pathOf(foot) };
  });
  const of = useMemo(() => (b: Book3, k: number) => {
    'worklet';
    // 선반에서 떨어진 책(들린 책)은 윗면 그림자를 그리지 않는다(쌓인 위 책은 아래 책이 받는다)
    return lowest(b) > 0.5 ? NO_CAST : layerCast(cam, b, s, clear, k, false);
  }, [cam, s, clear]);
  const band = useDerivedValue(() => shapes.value.band);
  const foot = useDerivedValue(() => shapes.value.foot);
  // 선반 윗면(투영된 실제 윗면 다각형) 안에만(받는 면 클리핑)
  const clip = useMemo(() => {
    const { f, px } = shelfFacesPx(cam, s, clear);
    const pts = f.top.poly.map(px);
    const p = Skia.PathBuilder.Make();
    p.moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) p.lineTo(q.x, q.y);
    p.close();
    return p.detach();
  }, [cam, s, clear]);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      <Group clip={clip}>
        {!SHOW.contact && front ? null : front ? (
          <Path path={band} color={rgba(shadow.color, shadow.ao.contact.opacity)}>
            <BlurMask blur={(shadow.ao.contact.blur / 2) * s} style="normal" />
          </Path>
        ) : (
          <>
            {/* 실제 그림자: 책 → 선반 윗면 */}
            {SHOW.shelfCast ? shadow.cast.bookShelf.layers.map((_, k) => <CastLayer key={k} m={m} ids={ids} of={of} k={k} opacity={shadow.cast.bookShelf.opacity} />) : null}
            {/* 주변광 차폐: 바닥 자리 */}
            <Path path={foot} opacity={SHOW.contact ? 1 : 0} color={rgba(shadow.color, shadow.ao.foot.opacity)}>
              <BlurMask blur={(shadow.ao.contact.blur / 4) * s} style="normal" />
            </Path>
          </>
        )}
      </Group>
    </Canvas>
  );
});

// 쌓인 책의 접촉(주변광 차폐): 위 책 바닥이 닿은 자리 둘레가 아래 책 윗면에서 좁게 어두워진다. 아래 책 윗면 안에만.
// 위 책이 드리우는 그림자(돌출 부분이 아래 책 앞면에 떨어지는 것 등)는 BookReceives의 실제 그림자가 맡는다.
export function StackShade({ m, id, lowerId, cam, px, ranks }: { m: Motion; id: string; lowerId: string; cam: Cam; px: Affine; ranks: Readonly<SharedValue<Record<string, number>>> }) {
  // 위 책 바로 전(아래 책 윗면 위, 위 책 아래)
  const z = useDerivedValue(() => (ranks.value[id] ?? 0) * 10 - 5);
  const g = useDerivedValue(() => {
    const up = stateNow(m, id);
    const lo = stateNow(m, lowerId);
    if (!up || !lo || lowest(up) < 0.5) return { top: pathOf([]), foot: pathOf([]) };
    const cl = viewCam(cam, lo);
    const P = (q: Vec3) => {
      const p = project(cl, q);
      return { x: p.x * px.s + px.tx, y: p.y * px.s + px.ty };
    };
    const lc = corners(lo);
    // 아래 책 윗면(법선이 가장 위를 향한 면)
    let upF: FaceId = 'cover';
    let best = -Infinity;
    for (const fid of FACE_IDS) {
      const ny = rot(lo.roll, lo.yaw, faceNormal(fid), lo.spin ?? 0).y;
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
