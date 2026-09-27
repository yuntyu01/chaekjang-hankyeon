// 상자 모델로 그리는 선반 한 칸(파일럿). 벽 그림자 → 선반 → 접촉 그림자 → 옆면·윗면(상자 투영) → 앞면 → 선반 앞턱.
// 앞면은 기존 책 몸체(둥근 책등·표지·종이 결·모티프)를 그대로 쓰고, 옆면·윗면만 상자에서 계산해 화면 좌표로 그린다.
// 기울어도 깊이 방향은 카메라 고정이라 옆면은 화면에서 따로 그려야 맞다.
import { BlurMask, Canvas, Group, LinearGradient, Path, Skia, useImage, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { frontPoly, project, silhouette, visibleFaces, type Camera, type Face, type Placed } from '@/domain/box';
import { BRUSH_DETAIL } from '@/domain/body-art.generated';
import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import type { BookFrame, Point } from '@/domain/shelf-scene';
import type { Book, Pose } from '@/domain/types';
import { BOX_HEAD_BOW, edgeFactor, Grain, mix, PAGE, PAGE_LINE, scaleColor } from '@/ui/book/BookBody';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { ShelfFront, ShelfImage } from '@/ui/shelf/ShelfPlank';
import { ShelfShadows } from '@/ui/shelf/ShelfShadows';

export type BoxEntry = { book: Book; placed: Placed };

const FLOOR = SHELF.clearHeight;

// 면 재료: 표지 판(board) 또는 종이 단면(pages). k = 밝기(빛은 왼쪽 위: 윗면 밝고 오른쪽 옆면 어둡다).
// boards: 종이 단면에서 표지 판이 보이는 방향(u = 앞 모서리 방향 양끝, v = 깊이 방향 앞뒤 끝).
function materialOf(pose: Pose, kind: Face['kind']): { mat: 'board' | 'pages'; k: number; boards?: 'u' | 'v' } {
  if (pose === 'spine') return kind === 'top' ? { mat: 'pages', k: 0.97, boards: 'u' } : { mat: 'board', k: kind === 'right' ? 0.8 : 0.9 };
  if (pose === 'front') return kind === 'left' ? { mat: 'board', k: 0.9 } : { mat: 'pages', k: kind === 'top' ? 0.97 : 0.86, boards: 'v' };
  return kind === 'top' ? { mat: 'board', k: 1.02 } : { mat: 'pages', k: kind === 'right' ? 0.88 : 0.9, boards: 'u' };
}

const toneOf = (book: Book, pose: Pose) => (pose === 'front' ? book.cover?.edge : undefined) ?? book.body?.face ?? book.themeColor;

type Px = (p: Point) => Point;

// 모서리마다 반지름을 준 둥근 다각형(각 꼭짓점을 양옆 변에서 r만큼 잘라 곡선으로 잇는다). r은 변 길이의 절반을 넘지 않는다.
export function roundedPath(pts: Point[], radii: number[]) {
  const path = Skia.Path.Make();
  const n = pts.length;
  const cut = (i: number, j: number, r: number) => {
    const a = pts[i];
    const b = pts[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(r, len / 2) / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  for (let i = 0; i < n; i++) {
    const r = radii[i] ?? 0;
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    const p0 = r > 0 ? cut(i, prev, r) : pts[i];
    const p1 = r > 0 ? cut(i, next, r) : pts[i];
    if (i === 0) path.moveTo(p0.x, p0.y);
    else path.lineTo(p0.x, p0.y);
    if (r > 0) path.quadTo(pts[i].x, pts[i].y, p1.x, p1.y);
  }
  path.close();
  return path;
}

// 손으로 그은 선의 흔들림(0 근처 부드러운 잡음). t는 선을 따라간 거리(px), s = 1DU px.
function wobbleAt(t: number, s: number, seed: number) {
  return 0.65 * Math.sin((t / (24 * s)) * Math.PI * 2 + seed) + 0.35 * Math.sin((t / (10 * s)) * Math.PI * 2 + seed * 2.3);
}

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: Point) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

// 부드러운 면 윤곽: 모서리마다 둥글기(radii), 변마다 손그림 흔들림(wob)과 볼록함(bulge: 변 가운데를 이 벡터만큼 민다).
// outer: 바깥 실루엣에 해당하는 변(연한 선을 그을 곳). 다른 면과 이어지는 변은 곧게 두고 선을 긋지 않는다.
export function softFace(pts: Point[], opt: { radii: number[]; wob: boolean[]; outer: boolean[]; bulge?: (Point | null)[]; s: number; seed: number }) {
  const { radii, wob, outer, bulge, s, seed } = opt;
  const n = pts.length;
  const amp = 0.32 * s;
  const cutAt = (i: number, j: number) => {
    const a = pts[i];
    const b = pts[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(radii[i] ?? 0, len / 2) / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const p0 = pts.map((_, i) => cutAt(i, (i + n - 1) % n));
  const p1 = pts.map((_, i) => cutAt(i, (i + 1) % n));
  const corner = pts.map((c, i) => {
    if (!(radii[i] > 0)) return [c];
    const out: Point[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const u = 1 - t;
      out.push({ x: u * u * p0[i].x + 2 * u * t * c.x + t * t * p1[i].x, y: u * u * p0[i].y + 2 * u * t * c.y + t * t * p1[i].y });
    }
    return out;
  });
  const edge = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const from = p1[i];
    const to = p0[(i + 1) % n];
    const L = Math.hypot(to.x - from.x, to.y - from.y);
    const full = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d = unit(sub(to, from));
    const nrm = { x: -d.y, y: d.x };
    const out: Point[] = [];
    const steps = Math.max(1, Math.floor(L / (1.5 * s)));
    for (let k = 1; k < steps; k++) {
      const t = (k / steps) * L;
      const q = { x: from.x + d.x * t, y: from.y + d.y * t };
      const u = Math.hypot(q.x - a.x, q.y - a.y) / full;
      let off = 0;
      if (wob[i]) off = amp * wobbleAt(t + i * 37 * s, s, seed) * Math.sin((Math.PI * k) / steps);
      const bv = bulge?.[i];
      const bs = Math.sin(Math.PI * u);
      out.push({ x: q.x + nrm.x * off + (bv ? bv.x * bs : 0), y: q.y + nrm.y * off + (bv ? bv.y * bs : 0) });
    }
    return out;
  });
  const all: Point[] = [];
  for (let i = 0; i < n; i++) all.push(...corner[i], ...edge[i]);
  // 바깥 변 이어 긋기
  const runs: Point[][] = [];
  const start = outer.findIndex((o) => !o);
  if (start < 0) runs.push([...all, all[0]]);
  else {
    let run: Point[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (!outer[i]) continue;
      const prevOuter = outer[(i + n - 1) % n];
      if (prevOuter) run.push(...corner[i]);
      else run = [p1[i]];
      run.push(...edge[i]);
      const nx = (i + 1) % n;
      if (!outer[nx]) {
        run.push(p0[nx]);
        runs.push(run);
        run = [];
      }
    }
  }
  return { all, runs };
}

// 면 네 꼭짓점의 둥글기·흔들림·바깥 변. visibleFaces 순서:
// top = [A 앞 오른쪽 위(옆면과 공유), B 앞 왼쪽 위, Bb 뒤 왼쪽, Ab 뒤 오른쪽(옆면과 공유)], 변 0 = 앞, 1 = 왼쪽, 2 = 뒤, 3 = 옆면과 공유
// right = [A 앞 오른쪽 아래, B 앞 오른쪽 위(윗면과 공유), Bb 뒤 위, Ab 뒤 아래], 변 0 = 앞, 1 = 윗면과 공유, 2 = 뒤, 3 = 바닥
function faceStyle(kind: Face['kind'], s: number) {
  switch (kind) {
    case 'top':
      return { radii: [0, 1.6 * s, 1.8 * s, 1.8 * s], wob: [false, true, true, false], outer: [false, true, true, false] };
    case 'right':
      return { radii: [1.2 * s, 0, 1.8 * s, 1.6 * s], wob: [false, false, true, false], outer: [false, false, true, true] };
    default:
      return { radii: [0, 0, 2 * s, 2 * s], wob: [false, true, true, true], outer: [false, true, true, true] };
  }
}

export function FaceShape({ face, book, pose, s, px, grain }: { face: Face; book: Book; pose: Pose; s: number; px: Px; grain: ReturnType<typeof useImage> }) {
  const tone = toneOf(book, pose);
  const m = materialOf(pose, face.kind);
  let [A, B, Bb, Ab] = face.poly.map(px);
  // 세운 책의 볼록한 머리(앞면과 같은 곡선): 윗면은 양끝이 bow만큼 내려오고 가운데가 솟는다. 옆면 위 모서리도 같이 내려온다.
  const bow = pose === 'spine' ? BOX_HEAD_BOW * s : 0;
  let bulge: (Point | null)[] | undefined;
  if (bow && face.kind === 'top') {
    const d = unit(sub(B, A));
    let nIn = { x: -d.y, y: d.x };
    const depthDir = sub(Ab, A);
    if (nIn.x * depthDir.x + nIn.y * depthDir.y > 0) nIn = { x: -nIn.x, y: -nIn.y }; // 앞면 쪽
    const sh = (p: Point) => ({ x: p.x + nIn.x * bow, y: p.y + nIn.y * bow });
    [A, B, Bb, Ab] = [sh(A), sh(B), sh(Bb), sh(Ab)];
    const up = { x: -nIn.x * bow, y: -nIn.y * bow };
    bulge = [up, null, { x: up.x, y: up.y }, null];
  } else if (bow && face.kind === 'right') {
    const dn = unit(sub(A, B));
    B = { x: B.x + dn.x * bow, y: B.y + dn.y * bow };
    Bb = { x: Bb.x + dn.x * bow, y: Bb.y + dn.y * bow };
  }
  const st = faceStyle(face.kind, s);
  const seed = [...book.id].reduce((h, c) => h + c.charCodeAt(0), 0) * 0.37 + face.kind.length;
  const soft = softFace([A, B, Bb, Ab], { ...st, bulge, s, seed });
  const path = Skia.Path.Polygon(soft.all, true);
  // 평행사변형 위의 점: u = 앞 모서리 A→B, v = 깊이 A→Ab (볼록한 머리면 u 가운데가 솟는다)
  const P = (u: number, v: number) => {
    const bs = bulge?.[0] ? Math.sin(Math.PI * u) : 0;
    const up = bulge?.[0] ?? { x: 0, y: 0 };
    return { x: A.x + (B.x - A.x) * u + (Ab.x - A.x) * v + up.x * bs, y: A.y + (B.y - A.y) * u + (Ab.y - A.y) * v + up.y * bs };
  };
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const depth = Math.hypot(Ab.x - A.x, Ab.y - A.y) || 1;
  const bu = Math.min(0.3, (1.0 * s) / len); // 표지 판 두께(앞 모서리 방향)
  const bv = Math.min(0.3, (0.8 * s) / depth);
  const inner =
    m.mat === 'pages'
      ? m.boards === 'u'
        ? [P(bu, 0), P(1 - bu, 0), P(1 - bu, 1), P(bu, 1)]
        : [P(0.04, bv), P(0.96, bv), P(0.96, 1 - bv), P(0.04, 1 - bv)]
      : null;
  const lines =
    m.mat === 'pages'
      ? (m.boards === 'u' ? [0.4, 0.62] : [0.45]).map((t) =>
          m.boards === 'u' ? [P(t, 0.05), P(t, 0.95)] : [P(0.06, t), P(0.94, t)],
        )
      : [];
  const board = scaleColor(tone, m.k);
  const lit = face.kind === 'top' || face.kind === 'left';
  return (
    <>
      {/* 표지 판 색(종이면이면 판이 테두리로 조금 보인다). 선 대신 색 차이로만 구분 */}
      <Path path={path} color={m.mat === 'board' ? board : scaleColor(tone, Math.min(1, m.k))} />
      {inner ? (
        <Path path={Skia.Path.Polygon(inner, true)}>
          <LinearGradient start={vec(A.x, A.y)} end={vec(Ab.x, Ab.y)} colors={[mix(scaleColor(PAGE, m.k), tone, 0.08), mix(scaleColor(PAGE, m.k * 0.93), tone, 0.12)]} />
        </Path>
      ) : null}
      {lines.map(([p, q], i) => (
        <Path key={i} path={Skia.Path.Polygon([p, q], false)} style="stroke" strokeWidth={0.5} color={PAGE_LINE} opacity={0.5} />
      ))}
      <Group clip={path}>
        <Grain w={DESIGN_WIDTH * s} h={400 * s} s={s} image={grain} />
      </Group>
      {/* 둥근 모서리로 이어지는 명암: 앞면 끝과 같은 밝기에서 시작해 면 색으로 풀린다(꺾인 선이 보이지 않게) */}
      <Path path={path}>
        <LinearGradient
          start={vec(A.x, A.y)}
          end={vec(A.x + (Ab.x - A.x) * 0.45, A.y + (Ab.y - A.y) * 0.45)}
          colors={lit ? ['rgba(255,250,240,0.2)', 'rgba(255,250,240,0)'] : ['rgba(255,250,240,0.1)', 'rgba(255,250,240,0)']}
        />
      </Path>
      {/* 뒤로 갈수록 조금 어둡다(빛에서 멀어짐) */}
      <Path path={path}>
        <LinearGradient start={vec(A.x, A.y)} end={vec(Ab.x, Ab.y)} colors={['rgba(50,35,25,0)', 'rgba(50,35,25,0.08)']} />
      </Path>
      {/* 빛을 받는 둥근 모서리의 부드러운 광택(그늘 쪽 모서리에는 없다) */}
      {lit ? (
        <Path path={Skia.Path.Polygon(Array.from({ length: 13 }, (_, k) => P(k / 12, 0)), false)} style="stroke" strokeWidth={1.6 * s} strokeCap="round">
          <LinearGradient start={vec(A.x, A.y)} end={vec(B.x, B.y)} colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.2)']} />
          <BlurMask blur={0.9 * s} style="normal" />
        </Path>
      ) : null}
      {/* 바깥 실루엣 변만 연한 같은 색 선(면 사이에는 긋지 않는다) */}
      {soft.runs.map((r, k) => (
        <Path key={`o${k}`} path={Skia.Path.Polygon(r, false)} style="stroke" strokeWidth={0.8 * s} strokeJoin="round" strokeCap="round" color={scaleColor(tone, edgeFactor(tone))} opacity={0.7} />
      ))}
    </>
  );
}

// 옆면·윗면 한 캔버스(선반 줄 전체). 뒤에 있는 상자부터, 같은 깊이면 아래·왼쪽부터 그린다.
const DepthFaces = memo(function DepthFaces({ entries, cam, s, clear, height }: { entries: BoxEntry[]; cam: Camera; s: number; clear: number; height: number }) {
  const grain = useImage(BRUSH_DETAIL);
  const px: Px = (p) => ({ x: (SHELF.sideMargin + p.x) * s, y: (clear + p.y - FLOOR) * s });
  const ordered = [...entries].sort((a, b) => b.placed.z - a.placed.z || a.placed.y - b.placed.y || a.placed.x - b.placed.x);
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      {ordered.map(({ book, placed }) => (
        <Group key={placed.bookId}>
          {visibleFaces(cam, placed)
            .sides.sort((a, b) => (a.kind === 'top' ? 1 : 0) - (b.kind === 'top' ? 1 : 0))
            .map((f) => (
              <FaceShape key={f.kind} face={f} book={book} pose={placed.pose} s={s} px={px} grain={grain} />
            ))}
        </Group>
      ))}
    </Canvas>
  );
});

// 바닥 접촉: 상자가 선반에 닿는 바닥면(앞면 윤곽에서 바닥 높이의 점 × 깊이)을 투영해 그린다.
// 1) 닿는 곳 바로 밑의 진하고 좁은 접촉 그늘, 2) 빛(왼쪽 위) 반대쪽으로 선반 윗면에 짧게 번지는 그늘.
// front = false: 책 밑·뒤로 번지는 그늘(책보다 먼저), true: 바닥 앞 그늘과 접촉선(책 위에)
export const Contacts = memo(function Contacts({ boxes, cam, s, clear, height, front = false }: { boxes: Placed[]; cam: Camera; s: number; clear: number; height: number; front?: boolean }) {
  const px: Px = (p) => ({ x: (SHELF.sideMargin + p.x) * s, y: (clear + p.y - FLOOR) * s });
  const shapes = boxes
    .filter((p) => p.y < 0.5)
    .map((p) => {
      const feet = frontPoly(p).filter((q) => q.y < p.y + 0.6);
      let x0 = Math.min(...feet.map((q) => q.x));
      let x1 = Math.max(...feet.map((q) => q.x));
      if (x1 - x0 < 2) {
        x0 -= 1;
        x1 += 1;
      }
      const P = (x: number, z: number) => px(project(cam, { x, y: 0, z }));
      const foot = [P(x0, p.z), P(x1, p.z), P(x1, p.z + p.size.d), P(x0, p.z + p.size.d)];
      const hh = Math.max(...frontPoly(p).map((q) => q.y)); // 높이만큼 오른쪽으로 조금 더 번진다
      const reach = Math.min(10, 2 + hh * 0.04);
      const cast = [P(x0 + 1, p.z), P(x1 + reach, p.z), P(x1 + reach, p.z + p.size.d), P(x0 + 1, p.z + p.size.d)];
      const e0 = P(x0 - 0.5, p.z);
      const e1 = P(x1 + 1.5, p.z);
      const band = [e0, e1, { x: e1.x, y: e1.y + 3 * s }, { x: e0.x, y: e0.y + 3 * s }];
      return { key: p.bookId, foot, cast, band, edge: [P(x0, p.z), P(x1, p.z)] };
    });
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height }]} pointerEvents="none">
      {shapes.map((c) => (
        <Group key={c.key}>
          {front ? null : (
          <>
          <Path path={Skia.Path.Polygon(c.cast, true)} color="rgba(116,90,64,0.2)">
            <BlurMask blur={2.2 * s} style="normal" />
          </Path>
          <Path path={Skia.Path.Polygon(c.foot, true)} color="rgba(96,70,48,0.28)">
            <BlurMask blur={0.9 * s} style="normal" />
          </Path>
          </>
          )}
          {front ? (
          <>
          {/* 바닥 바로 앞 선반 위의 짧은 그늘(시안: 책이 판에 눌려 앉은 느낌) */}
          <Path path={Skia.Path.Polygon(c.band, true)}>
            <LinearGradient start={vec(0, c.band[0].y)} end={vec(0, c.band[3].y)} colors={['rgba(96,68,44,0.38)', 'rgba(96,68,44,0)']} />
            <BlurMask blur={0.5 * s} style="normal" />
          </Path>
          <Path path={Skia.Path.Polygon(c.edge, false)} style="stroke" strokeWidth={0.9 * s} strokeCap="round" color="rgba(80,56,38,0.45)">
            <BlurMask blur={0.35 * s} style="normal" />
          </Path>
          </>
          ) : null}
        </Group>
      ))}
    </Canvas>
  );
});

// 앞면: 기울기 전 앞면 사각형(투영 위치)에 기존 몸체를 놓고, 바닥 모서리를 축으로 돌린다.
function FrontFace({ entry, cam, s, clear }: { entry: BoxEntry; cam: Camera; s: number; clear: number }) {
  const { book, placed: p } = entry;
  const left = p.x + p.z * cam.kx;
  const top = FLOOR - (p.y + p.size.h) - p.z * cam.ky;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (SHELF.sideMargin + left) * s,
        top: (clear + top - FLOOR) * s,
        width: p.size.w * s,
        height: p.size.h * s,
        transformOrigin: p.angle > 0 ? 'right bottom' : 'left bottom',
        transform: [{ rotate: `${p.angle}deg` }],
      }}>
      <BookRenderer book={book} pose={p.pose} scale={s} box />
    </View>
  );
}

export const BoxShelf = memo(function BoxShelf({ entries, cam, scale: s, originX, clear, height }: { entries: BoxEntry[]; cam: Camera; scale: number; originX: number; clear: number; height: number }) {
  // 그림자·접촉은 투영 외곽(앞면 + 깊이 면)으로
  const frames = useMemo(
    () =>
      entries.map(
        ({ placed }) =>
          ({ bookId: placed.bookId, itemKey: placed.bookId, shelfId: 'pilot', pose: placed.pose, tilt: 0, left: 0, top: 0, width: 0, height: 0, rotate: placed.angle, origin: 'left bottom', poly: silhouette(cam, placed), stackIndex: placed.y > 0 ? 1 : 0 }) as BookFrame,
      ),
    [entries, cam],
  );
  const fronts = [...entries].sort((a, b) => b.placed.z - a.placed.z || a.placed.y - b.placed.y || a.placed.x - b.placed.x);
  return (
    <View style={{ height, width: DESIGN_WIDTH * s, marginLeft: originX }}>
      <ShelfShadows frames={frames} scale={s} hiddenId={null} height={height} clear={clear} />
      <ShelfImage scale={s} clear={clear} />
      <Contacts boxes={entries.map((e) => e.placed)} cam={cam} s={s} clear={clear} height={height} />
      <DepthFaces entries={entries} cam={cam} s={s} clear={clear} height={height} />
      {fronts.map((e) => (
        <FrontFace key={e.placed.bookId} entry={e} cam={cam} s={s} clear={clear} />
      ))}
      <Contacts boxes={entries.map((e) => e.placed)} cam={cam} s={s} clear={clear} height={height} front />
      <ShelfFront scale={s} clear={clear} />
    </View>
  );
});

// 책 한 권(상자 모델): 옆면·윗면 캔버스 + 앞면 몸체. 자기 투영 외곽(frame.poly)의 바운딩 박스를 BOX_PAD만큼 넓힌 곳에 그린다.
// 선반 줄(ShelfRow)과 드래그(DragOverlay)가 같이 쓴다. 부모는 frameBBox의 왼쪽 위에 놓고, 이 뷰는 -BOX_PAD에서 시작한다.
export const BOX_PAD = 3;

export const BoxBookView = memo(function BoxBookView({ frame, book, scale: s, cam }: { frame: BookFrame; book: Book; scale: number; cam: Camera }) {
  const grain = useImage(BRUSH_DETAIL);
  const xs = frame.poly.map((p) => p.x);
  const ys = frame.poly.map((p) => p.y);
  const minX = Math.min(...xs) - BOX_PAD;
  const minY = Math.min(...ys) - BOX_PAD;
  const w = Math.max(...xs) - minX + BOX_PAD;
  const h = Math.max(...ys) - minY + BOX_PAD;
  const px: Px = (p) => ({ x: (p.x - minX) * s, y: (p.y - minY) * s });
  const faces = frame.box ? visibleFaces(cam, frame.box).sides.sort((a, b) => (a.kind === 'top' ? 1 : 0) - (b.kind === 'top' ? 1 : 0)) : [];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: -BOX_PAD * s, top: -BOX_PAD * s, width: w * s, height: h * s }}>
      <Canvas style={StyleSheet.absoluteFill}>
        {faces.map((f) => (
          <FaceShape key={f.kind} face={f} book={book} pose={frame.pose} s={s} px={px} grain={grain} />
        ))}
      </Canvas>
      <View
        style={{
          position: 'absolute',
          left: (frame.left - minX) * s,
          top: (frame.top - minY) * s,
          width: frame.width * s,
          height: frame.height * s,
          transformOrigin: frame.origin,
          transform: [{ rotate: `${frame.rotate}deg` }],
        }}>
        <BookRenderer book={book} pose={frame.pose} scale={s} box />
      </View>
    </View>
  );
});

// 그리는 순서: 뒤(깊이 큰) 상자부터, 쌓기는 아래부터, 같은 줄은 왼쪽부터(오른쪽 책의 앞면이 왼쪽 책 옆면을 가린다)
export function paintOrder<T extends { box?: Placed; left: number }>(frames: T[]) {
  return [...frames].sort((a, b) => (b.box?.z ?? 0) - (a.box?.z ?? 0) || (a.box?.y ?? 0) - (b.box?.y ?? 0) || (a.box?.x ?? a.left) - (b.box?.x ?? b.left));
}
