// 선반 한 줄의 움직임. 배치가 바뀌면 관련 책 전부의 경로를 공통 진행률 t 하나로 짜고(domain/transition),
// 매 프레임(UI 스레드) 같은 상자에서 옆면·윗면, 앞면(글자 포함), 벽 그림자, 바닥 접촉을 함께 계산한다.
// 들림(선택한 책)도 같은 상자에 더한다. 동작 줄이기 설정이면 즉시 적용.
import { BlurMask, Canvas, Group, LinearGradient, Path, Skia, useImage, vec, type SkPath } from '@shopify/react-native-skia';
import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { BRUSH_DETAIL } from '@/domain/body-art.generated';
import { frontPoly, project, silhouette, type Camera, type Placed } from '@/domain/box';
import { CAMERA, DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import { castShape, rgba } from '@/domain/shadow-shape';
import { PLANK_BOUNDS, type BookFrame, type Point } from '@/domain/shelf-scene';
import { boxAt, planTransition, type TransitionEntry } from '@/domain/transition';
import type { Book, Pose } from '@/domain/types';
import { BOX_HEAD_BOW } from '@/ui/book/BookBody';
import { colors, shadow } from '@/ui/theme';

import { FaceShape } from '@/ui/box/BookFaces';
import { computeFace, EMPTY_FACE, faceAt, kindsOf, materialOf, seedOf, type FaceKind } from '@/ui/box/face-geometry';

const FLOOR = SHELF.clearHeight;
export const MOTION_MS = 230; // 기울이기·밀림
const LIFT_DU = 7;

type Plan = Record<string, TransitionEntry>;
export type Motion = {
  plan: SharedValue<Plan>;
  t: SharedValue<number>;
  liftId: SharedValue<string | null>;
  lift: SharedValue<number>;
};

const stillOf = (frames: BookFrame[]): Plan =>
  Object.fromEntries(frames.filter((f) => f.box).map((f) => [f.bookId, { id: f.bookId, from: f.box!, to: f.box!, move: [0, 1], angle: [[0, f.box!.angle], [1, f.box!.angle]] } as TransitionEntry]));

// 진행률 t에서 이 책의 상자(들림 포함). 경로가 아직 없으면 null.
export function boxNow(m: Motion, id: string): Placed | null {
  'worklet';
  const e = m.plan.value[id];
  if (!e) return null;
  const b = boxAt(e, m.t.value);
  if (m.liftId.value === id && m.lift.value > 0) return { ...b, y: b.y + LIFT_DU * m.lift.value };
  return b;
}

export function useShelfMotion(frames: BookFrame[], reduceMotion: boolean, selectedId: string | null): Motion {
  const [init] = useState(() => stillOf(frames));
  const plan = useSharedValue<Plan>(init);
  const t = useSharedValue(1);
  const liftId = useSharedValue<string | null>(null);
  const lift = useSharedValue(0);
  const current = useRef<Plan>(init);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // 지금 보이는 모양(진행 중이면 그 중간)에서 새 배치로
    const now = t.value;
    const prev = Object.values(current.current).map((e) => boxAt(e, now));
    const next = frames.filter((f) => f.box).map((f) => f.box!);
    const p = planTransition(prev, next, PLANK_BOUNDS);
    const rec: Plan = Object.fromEntries(p.entries.map((e) => [e.id, e]));
    current.current = rec;
    const animate = !reduceMotion && p.strategy !== 'snap';
    scheduleOnUI(() => {
      'worklet';
      plan.value = rec;
      t.value = animate ? 0 : 1;
      if (animate) t.value = withTiming(1, { duration: MOTION_MS, easing: Easing.out(Easing.cubic) });
    });
  }, [frames, reduceMotion, plan, t]);

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

  return { plan, t, liftId, lift };
}

// ---------- 옆면·윗면(줄 전체 캔버스, 앞면들 아래) ----------

const toneOf = (book: Book, pose: Pose) => (pose === 'front' ? book.cover?.edge : undefined) ?? book.body?.face ?? book.themeColor;

function Face({ m, id, book, pose, kind, cam, s, clear }: { m: Motion; id: string; book: Book; pose: Pose; kind: FaceKind; cam: Camera; s: number; clear: number }) {
  const grain = useImage(BRUSH_DETAIL);
  const mat = materialOf(pose, kind);
  const boards = mat.mat === 'pages' ? (mat.boards ?? null) : null;
  const bow = pose === 'spine' ? BOX_HEAD_BOW * s : 0;
  const seed = seedOf(id, kind);
  const px = { s, tx: SHELF.sideMargin * s, ty: (clear - FLOOR) * s };
  const geom = useDerivedValue(() => {
    const b = boxNow(m, id);
    return b ? computeFace(faceAt(cam, b, kind), kind, px, bow, boards, seed) : EMPTY_FACE;
  });
  return <FaceShape geom={geom} kind={kind} pose={pose} tone={toneOf(book, pose)} s={s} grain={grain} />;
}

export const RowFaces = memo(function RowFaces({
  m,
  frames,
  books,
  hiddenId,
  cam,
  s,
  clear,
  height,
}: {
  m: Motion;
  frames: BookFrame[];
  books: Record<string, Book>;
  hiddenId: string | null;
  cam: Camera;
  s: number;
  clear: number;
  height: number;
}) {
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      {frames
        .filter((f) => f.box && f.bookId !== hiddenId)
        .map((f) => (
          <Group key={f.bookId}>
            {kindsOf(cam, [f.box!, { ...f.box!, angle: 0 }]).map((k) => (
              <Face key={k} m={m} id={f.bookId} book={books[f.bookId]} pose={f.pose} kind={k} cam={cam} s={s} clear={clear} />
            ))}
          </Group>
        ))}
    </Canvas>
  );
});

// ---------- 앞면(기존 몸체 + 글자). 상자의 앞면 사각형에 놓고 바닥 모서리를 축으로 돌린다 ----------

export function BookFront({ m, frame, s, clear, children }: { m: Motion; frame: BookFrame; s: number; clear: number; children: ReactNode }) {
  const id = frame.bookId;
  const w = frame.width * s;
  const h = frame.height * s;
  const style = useAnimatedStyle(() => {
    const b = boxNow(m, id);
    if (!b) return { opacity: 0 };
    const left = (SHELF.sideMargin + b.x + b.z * CAMERA.kx) * s;
    const top = (clear - b.y - b.size.h - b.z * CAMERA.ky) * s;
    // RN은 가운데를 축으로 돌리므로, 기대는 쪽 바닥 모서리가 제자리에 있도록 옮긴다(화면 y 아래, 시계 방향 +)
    const th = (b.angle * Math.PI) / 180;
    const dx = b.angle > 0 ? w / 2 : -w / 2;
    const dy = h / 2;
    const rx = dx * Math.cos(th) - dy * Math.sin(th);
    const ry = dx * Math.sin(th) + dy * Math.cos(th);
    return {
      opacity: 1,
      left,
      top,
      transform: [{ translateX: dx - rx }, { translateY: dy - ry }, { rotate: `${b.angle}deg` }],
    };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: w, height: h }, style]}>{children}</Animated.View>;
}

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

function WallLayer({ m, ids, layer, cam, s, clear, floorY, fadeTop, colors: cols, pos }: { m: Motion; ids: string[]; layer: { dx: number; dy: number; blur: number; opacity: number }; cam: Camera; s: number; clear: number; floorY: number; fadeTop: number; colors: string[]; pos: number[] }) {
  const path = useDerivedValue(() => {
    const polys: Point[][] = [];
    for (const id of ids) {
      const b = boxNow(m, id);
      if (!b) continue;
      const sh = castShape(silhouette(cam, b), layer.dx, layer.dy, layer.blur);
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

export const RowShadows = memo(function RowShadows({ m, ids, cam, s, clear, height }: { m: Motion; ids: string[]; cam: Camera; s: number; clear: number; height: number }) {
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

// 바닥 접촉: 상자가 선반에 닿는 바닥면(앞면 윤곽에서 바닥 높이의 점 × 깊이)을 투영해 그린다.
// back: 책 밑·뒤로 번지는 그늘(책보다 먼저), front: 바닥 앞 그늘과 접촉선(책 위에)
function contactShapes(b: Placed, cam: Camera, s: number, clear: number) {
  'worklet';
  const poly = frontPoly(b);
  let x0 = 1e9;
  let x1 = -1e9;
  let top = 0;
  for (const q of poly) {
    if (q.y < b.y + 0.6) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
    }
    top = Math.max(top, q.y);
  }
  if (x1 - x0 < 2) {
    x0 -= 1;
    x1 += 1;
  }
  const P = (x: number, z: number) => {
    const q = project(cam, { x, y: 0, z });
    return { x: (SHELF.sideMargin + q.x) * s, y: (clear + q.y - FLOOR) * s };
  };
  const reach = Math.min(10, 2 + top * 0.04);
  const e0 = P(x0 - 0.5, b.z);
  const e1 = P(x1 + 1.5, b.z);
  return {
    foot: [P(x0, b.z), P(x1, b.z), P(x1, b.z + b.size.d), P(x0, b.z + b.size.d)],
    cast: [P(x0 + 1, b.z), P(x1 + reach, b.z), P(x1 + reach, b.z + b.size.d), P(x0 + 1, b.z + b.size.d)],
    band: [e0, e1, { x: e1.x, y: e1.y + 3 * s }, { x: e0.x, y: e0.y + 3 * s }],
    edge: [P(x0, b.z), P(x1, b.z)],
  };
}

export const RowContacts = memo(function RowContacts({ m, ids, cam, s, clear, height, front = false }: { m: Motion; ids: string[]; cam: Camera; s: number; clear: number; height: number; front?: boolean }) {
  // 선반에서 떨어진(들린·쌓인 위) 책은 접촉이 없다. 들리는 만큼 옅어진다.
  const shapes = useDerivedValue(() => {
    const cast: Point[][] = [];
    const foot: Point[][] = [];
    const band: Point[][] = [];
    const edge = Skia.PathBuilder.Make();
    for (const id of ids) {
      const b = boxNow(m, id);
      if (!b || b.y > 0.5) continue;
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
          {/* 바닥 바로 앞 선반 위의 짧은 그늘(시안: 책이 판에 눌려 앉은 느낌) */}
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
