// 선반 한 줄의 움직임. 배치가 바뀌면 관련 책 전부의 경로를 공통 진행률 t 하나로 짜고(domain/transition),
// 매 프레임(UI 스레드) 같은 3D 자세에서 책 면(BookNode), 벽 그림자, 바닥 접촉을 함께 계산한다.
// 경로 계획의 입력은 "지금 화면에 보이는 자세"(움직이는 도중이면 그 보간값)라 도중에 다시 조작해도 튀지 않는다.
// React 상태는 배치가 바뀔 때만 건드리고, 프레임마다는 SharedValue만 바뀐다. 동작 줄이기 설정이면 즉시 적용.
import { BlurMask, Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
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
import { BookNode, depthKey } from '@/ui/book3d/BookNode';
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
          .filter((f) => f.box)
          .map((f) =>
            f.bookId === hiddenId ? (
              // 끌고 있는 책이 놓일 자리: 옅은 실루엣(손가락에 가려도 최종 위치가 보이게)
              <Group key={f.bookId} opacity={0.32} zIndex={-1e6}>
                <RowBook m={m} frame={f} book={books[f.bookId]} cam={cam} px={px} shared={shared} />
              </Group>
            ) : (
              <RowBook key={f.bookId} m={m} frame={f} book={books[f.bookId]} cam={cam} px={px} shared={shared} />
            ),
          )}
        {frames
          .filter((f) => f.box && f.bookId !== hiddenId && f.stackIndex > 0)
          .map((f) => (
            <StackShade key={`sh${f.bookId}`} m={m} id={f.bookId} cam={cam} px={px} />
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

// 벽 그림자 한 층: 책마다 투영 외곽을 빛 반대쪽(오른쪽 아래)으로, 벽에서 먼 책일수록 더 멀리 옮긴 모양
function wallShadowOf(cam: Cam, b: Book3, s: number, clear: number) {
  'worklet';
  const w = shadow.bookWall;
  const cs = corners(b);
  let back = -Infinity;
  for (const c of cs) back = Math.max(back, c.z);
  const k = w.near + w.perDU * Math.max(0, shadow.wallZ - back);
  const sh = castShape(outlineOf(cam, b), w.dx * k, w.dy * k, w.blur / 2);
  return sh.map((q) => ({ x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - FLOOR) * s }));
}

// 책 사이 틈 어둠(벽 쪽): 앞줄에 선 책끼리 틈이 좁을수록 진하고 fadeAt 이상이면 없다. 틈 영역 안에만.
function gapShapes(m: Motion, ids: string[], cam: Cam, s: number, clear: number) {
  'worklet';
  const g = shadow.gap;
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
      const lvl = Math.min(3, Math.floor((g.a / shadow.gap.max) * 4));
      if (lvl === band) polys.push(g.rect);
    }
    return pathOf(polys);
  });
  return <Path path={path} color={rgba(shadow.color, shadow.gap.max * ((band + 0.5) / 4))} />;
}

export const RowShadows = memo(function RowShadows({ m, ids, cam, s, clear, height }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; height: number }) {
  const w = shadow.bookWall;
  const path = useDerivedValue(() => {
    const polys: Point[][] = [];
    for (const id of ids) {
      const b = stateNow(m, id);
      if (b) polys.push(wallShadowOf(cam, b, s, clear));
    }
    return pathOf(polys);
  });
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      <Path path={path} color={rgba(shadow.color, w.opacity)}>
        <BlurMask blur={(w.blur / 2) * s} style="normal" />
      </Path>
      {[0, 1, 2, 3].map((b) => (
        <GapShade key={b} m={m} ids={ids} cam={cam} s={s} clear={clear} band={b} />
      ))}
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

function contactShapes(b: Book3, cam: Cam, s: number, clear: number) {
  'worklet';
  const f = footOf(b);
  const P = (x: number, z: number, dy = 0, dx = 0) => {
    const q = project(cam, { x, y: f.y, z });
    return { x: (SHELF.sideMargin + q.x) * s + dx * s, y: (clear + q.y - FLOOR) * s + dy * s };
  };
  const c = shadow.contact;
  const d = shadow.bookShelf;
  return {
    // 책이 선반 윗면에 드리우는 그림자: 바닥 면을 빛 반대쪽(오른쪽 아래)으로
    cast: [P(f.x0, f.z0, d.dy, d.dy / 2), P(f.x1, f.z0, d.dy, d.dy / 2), P(f.x1, f.z1, 0, d.dy / 2), P(f.x0, f.z1)],
    // 닿는 곳: 바닥 앞 모서리 바로 앞 좁고 진한 띠
    band: [P(f.x0 - 0.3, f.z0), P(f.x1 + 0.6, f.z0), P(f.x1 + 0.6, f.z0, c.height * 0.5), P(f.x0 - 0.3, f.z0, c.height * 0.5)],
    foot: [P(f.x0, f.z0), P(f.x1, f.z0), P(f.x1, f.z1), P(f.x0, f.z1)],
  };
}

export const RowContacts = memo(function RowContacts({ m, ids, cam, s, clear, height, front = false, shelfTop }: { m: Motion; ids: string[]; cam: Cam; s: number; clear: number; height: number; front?: boolean; shelfTop: number }) {
  // 선반에서 떨어진(들린·쌓인 위) 책은 접촉이 없다
  const shapes = useDerivedValue(() => {
    const cast: Point[][] = [];
    const band: Point[][] = [];
    const foot: Point[][] = [];
    for (const id of ids) {
      const b = stateNow(m, id);
      if (!b || lowest(b) > 0.5) continue;
      const c = contactShapes(b, cam, s, clear);
      cast.push(c.cast);
      band.push(c.band);
      foot.push(c.foot);
    }
    return { cast: pathOf(cast), band: pathOf(band), foot: pathOf(foot) };
  });
  const cast = useDerivedValue(() => shapes.value.cast);
  const band = useDerivedValue(() => shapes.value.band);
  const foot = useDerivedValue(() => shapes.value.foot);
  // 선반 윗면 안에만(받는 면 클리핑)
  const clip = Skia.XYWHRect(0, shelfTop * s, DESIGN_WIDTH * s, (clear + SHELF.lip) * s - shelfTop * s);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      <Group clip={clip}>
        {front ? (
          <Path path={band} color={rgba(shadow.color, shadow.contact.opacity)}>
            <BlurMask blur={(shadow.contact.blur / 2) * s} style="normal" />
          </Path>
        ) : (
          <>
            <Path path={cast} color={rgba(shadow.color, shadow.bookShelf.opacity)}>
              <BlurMask blur={(shadow.bookShelf.blur / 2) * s} style="normal" />
            </Path>
            <Path path={foot} color={rgba(shadow.color, shadow.contact.opacity)}>
              <BlurMask blur={(shadow.contact.blur / 4) * s} style="normal" />
            </Path>
          </>
        )}
      </Group>
    </Canvas>
  );
});

// 쌓인 책: 위 책이 아래 책 윗면에 드리우는 접촉·그림자(책 사이 앞뒤 순서에 끼워 그린다)
export function StackShade({ m, id, cam, px }: { m: Motion; id: string; cam: Cam; px: Affine }) {
  const z = useDerivedValue(() => {
    const b = stateNow(m, id);
    return b ? depthKey(b) - 0.0005 : 0;
  });
  const path = useDerivedValue(() => {
    const b = stateNow(m, id);
    if (!b || lowest(b) < 0.5) return pathOf([]);
    const f = footOf(b);
    const P = (x: number, zz: number, dy = 0) => {
      const q = project(cam, { x, y: f.y, z: zz });
      return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty + dy * px.s };
    };
    return pathOf([[P(f.x0, f.z0), P(f.x1 + 2, f.z0, 2), P(f.x1 + 2, f.z1, 1), P(f.x0, f.z1)]]);
  });
  return (
    <Group zIndex={z}>
      <Path path={path} color={rgba(shadow.color, shadow.stack.opacity)}>
        <BlurMask blur={(shadow.stack.blur / 2) * px.s} style="normal" />
      </Path>
    </Group>
  );
}
