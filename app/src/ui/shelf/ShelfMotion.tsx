// 선반 한 줄의 움직임. 배치가 바뀌면 관련 책 전부의 경로를 공통 진행률 t 하나로 짜고(domain/transition),
// 매 프레임(UI 스레드) 같은 3D 자세에서 책 면(BookNode), 벽 그림자, 바닥 접촉을 함께 계산한다.
// 경로 계획의 입력은 "지금 화면에 보이는 자세"(움직이는 도중이면 그 보간값)라 도중에 다시 조작해도 튀지 않는다.
// React 상태는 배치가 바뀔 때만 건드리고, 프레임마다는 SharedValue만 바뀐다. 동작 줄이기 설정이면 즉시 적용.
import { BlurMask, Canvas, Group, LinearGradient, Path, Skia, vec, type SkPath } from '@shopify/react-native-skia';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { corners, fromPlaced, lowest, type Book3, type Cam } from '@/domain/book3';
import { project } from '@/domain/box';
import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import { castShape, hull, rgba } from '@/domain/shadow-shape';
import { PLANK_BOUNDS, type BookFrame, type Point } from '@/domain/shelf-scene';
import { bookAt, planTransition, type Track } from '@/domain/transition';
import type { Book } from '@/domain/types';
import { useBookShared, type Shared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import type { Affine } from '@/ui/book3d/face-geometry';
import { colors, shadow } from '@/ui/theme';

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
  segs: [{ kind: 0, t0: 0, t1: 1, r0: b.roll, r1: b.roll, y0: b.yaw, y1: b.yaw, a: { x: 0, y: 0, z: 0 }, w0: b.t, w1: b.t, al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0 }],
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

// ---------- 책(한 캔버스에 줄 전체) ----------

function RowBook({ m, frame, book, cam, px, shared }: { m: Motion; frame: BookFrame; book: Book; cam: Cam; px: Affine; shared: Shared }) {
  const rest = useMemo(() => fromPlaced(frame.box!), [frame]);
  const id = frame.bookId;
  const state = useDerivedValue(() => stateNow(m, id) ?? rest);
  return <BookNode book={book} dims={rest.dims} state={state} cam={cam} px={px} shared={shared} />;
}

export const RowBooks = memo(function RowBooks({ m, frames, books, hiddenId, cam, s, clear, height }: { m: Motion; frames: BookFrame[]; books: Record<string, Book>; hiddenId: string | null; cam: Cam; s: number; clear: number; height: number }) {
  const px = useMemo(() => ({ s, tx: SHELF.sideMargin * s, ty: (clear - FLOOR) * s }), [s, clear]);
  const shared = useBookShared();
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      <Group>
        {frames
          .filter((f) => f.box && f.bookId !== hiddenId)
          .map((f) => (
            <RowBook key={f.bookId} m={m} frame={f} book={books[f.bookId]} cam={cam} px={px} shared={shared} />
          ))}
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
  return hull(corners(b).map((c) => project(cam, c)));
}

function WallLayer({ m, ids, layer, cam, s, clear, floorY, fadeTop, colors: cols, pos }: { m: Motion; ids: string[]; layer: { dx: number; dy: number; blur: number; opacity: number }; cam: Cam; s: number; clear: number; floorY: number; fadeTop: number; colors: string[]; pos: number[] }) {
  const path = useDerivedValue(() => {
    const polys: Point[][] = [];
    for (const id of ids) {
      const b = stateNow(m, id);
      if (!b) continue;
      const sh = castShape(outlineOf(cam, b), layer.dx, layer.dy, layer.blur);
      polys.push(sh.map((q) => ({ x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - FLOOR) * s })));
    }
    return pathOf(polys);
  });
  return (
    <Group opacity={layer.opacity}>
      <Path path={path}>
        <LinearGradient start={vec(0, floorY)} end={vec(0, floorY - fadeTop * s)} colors={cols} positions={pos} />
        <BlurMask blur={layer.blur * s} style="normal" />
      </Path>
    </Group>
  );
}

export const RowShadows = memo(function RowShadows({ m, ids, cam, s, clear, height }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; height: number }) {
  const { layers, fade } = shadow.cast;
  const fadeTop = fade[fade.length - 1][0];
  const cols = fade.map(([, k]) => rgba(colors.shadow, k));
  const pos = fade.map(([hh]) => hh / fadeTop);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      {layers.map((l, i) => (
        <WallLayer key={i} m={m} ids={ids} layer={l} cam={cam} s={s} clear={clear} floorY={clear * s} fadeTop={fadeTop} colors={cols} pos={pos} />
      ))}
    </Canvas>
  );
});

// 바닥 접촉: 선반에 닿는 바닥 꼭짓점(가장 낮은 점 근처)의 투영. 발 그늘, 빛 반대쪽으로 번지는 그늘, 앞 모서리 접촉선.
function contactShapes(b: Book3, cam: Cam, s: number, clear: number) {
  'worklet';
  const cs = corners(b);
  const lo = lowest(b);
  const P = (x: number, z: number) => {
    const q = project(cam, { x, y: 0, z });
    return { x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - FLOOR) * s };
  };
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
  const reach = Math.min(10, 2 + top * 0.04);
  const e0 = P(x0 - 0.5, z0);
  const e1 = P(x1 + 1.5, z0);
  return {
    foot: [P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)],
    cast: [P(x0 + 1, z0), P(x1 + reach, z0), P(x1 + reach, z1), P(x0 + 1, z1)],
    band: [e0, e1, { x: e1.x, y: e1.y + 3 * s }, { x: e0.x, y: e0.y + 3 * s }],
    edge: [P(x0, z0), P(x1, z0)],
  };
}

export const RowContacts = memo(function RowContacts({ m, ids, cam, s, clear, height, front = false }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; height: number; front?: boolean }) {
  // 선반에서 떨어진(들린·쌓인 위) 책은 접촉이 없다
  const shapes = useDerivedValue(() => {
    const cast: Point[][] = [];
    const foot: Point[][] = [];
    const band: Point[][] = [];
    const edge = Skia.PathBuilder.Make();
    for (const id of ids) {
      const b = stateNow(m, id);
      if (!b || lowest(b) > 0.5) continue;
      const c = contactShapes(b, cam, s, clear);
      cast.push(c.cast);
      foot.push(c.foot);
      band.push(c.band);
      edge.moveTo(c.edge[0].x, c.edge[0].y);
      edge.lineTo(c.edge[1].x, c.edge[1].y);
    }
    return { cast: pathOf(cast), foot: pathOf(foot), band: pathOf(band), edge: edge.detach() };
  });
  const cast = useDerivedValue(() => shapes.value.cast);
  const foot = useDerivedValue(() => shapes.value.foot);
  const band = useDerivedValue(() => shapes.value.band);
  const edge = useDerivedValue(() => shapes.value.edge);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      {front ? (
        <>
          <Path path={band} color="rgba(96,68,44,0.22)">
            <BlurMask blur={0.9 * s} style="normal" />
          </Path>
          <Path path={edge} style="stroke" strokeWidth={0.9 * s} strokeCap="round" color="rgba(80,56,38,0.45)">
            <BlurMask blur={0.35 * s} style="normal" />
          </Path>
        </>
      ) : (
        <>
          <Path path={cast} color="rgba(116,90,64,0.2)">
            <BlurMask blur={2.2 * s} style="normal" />
          </Path>
          <Path path={foot} color="rgba(96,70,48,0.28)">
            <BlurMask blur={0.9 * s} style="normal" />
          </Path>
        </>
      )}
    </Canvas>
  );
});
