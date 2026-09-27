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
import { edgeFactor, Grain, mix, PAGE, PAGE_LINE, scaleColor } from '@/ui/book/BookBody';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { ShelfFront, ShelfImage } from '@/ui/shelf/ShelfRow';
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

// 면 네 꼭짓점 [앞 A, 앞 B, 뒤 B, 뒤 A]의 둥글기. 다른 면과 이어지는 앞 모서리는 곧게, 바깥 모서리는 둥글게(시안: 베개처럼 둥근 책).
function faceRadii(kind: Face['kind'], s: number) {
  switch (kind) {
    case 'top': // A = 앞 왼쪽 위(앞면의 둥근 모서리와 이어짐), B = 앞 오른쪽 위(옆면과 공유)
      return [4 * s, 0, 5 * s, 4 * s];
    case 'right': // A = 앞 오른쪽 아래(바닥), B = 앞 오른쪽 위(윗면과 공유)
      return [1.5 * s, 0, 5 * s, 2.5 * s];
    default:
      return [0, 0, 2 * s, 2 * s];
  }
}

function FaceShape({ face, book, pose, s, px, grain }: { face: Face; book: Book; pose: Pose; s: number; px: Px; grain: ReturnType<typeof useImage> }) {
  const tone = toneOf(book, pose);
  const m = materialOf(pose, face.kind);
  const [A, B, Bb, Ab] = face.poly.map(px);
  const path = roundedPath([A, B, Bb, Ab], faceRadii(face.kind, s));
  // 평행사변형 위의 점: u = 앞 모서리 A→B, v = 깊이 A→Ab
  const P = (u: number, v: number) => ({ x: A.x + (B.x - A.x) * u + (Ab.x - A.x) * v, y: A.y + (B.y - A.y) * u + (Ab.y - A.y) * v });
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
        <Path path={Skia.Path.Polygon([A, B], false)} style="stroke" strokeWidth={1.6 * s} strokeCap="round">
          <LinearGradient start={vec(A.x, A.y)} end={vec(B.x, B.y)} colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.2)']} />
          <BlurMask blur={0.9 * s} style="normal" />
        </Path>
      ) : null}
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
          {/* 상자 바깥 실루엣만 연한 같은 색 선 하나(면 사이에는 선을 긋지 않는다). 앞면 쪽은 앞면이 덮는다 */}
          <Path
            path={(() => {
              const h = silhouette(cam, placed).map(px);
              return roundedPath(h, h.map(() => 4 * s));
            })()}
            style="stroke"
            strokeWidth={0.8 * s}
            strokeJoin="round"
            color={scaleColor(toneOf(book, placed.pose), edgeFactor(toneOf(book, placed.pose)))}
            opacity={0.7}
          />
        </Group>
      ))}
    </Canvas>
  );
});

// 바닥 접촉: 상자가 선반에 닿는 바닥면(앞면 윤곽에서 바닥 높이의 점 × 깊이)을 투영해 그린다.
// 1) 닿는 곳 바로 밑의 진하고 좁은 접촉 그늘, 2) 빛(왼쪽 위) 반대쪽으로 선반 윗면에 짧게 번지는 그늘.
// front = false: 책 밑·뒤로 번지는 그늘(책보다 먼저), true: 바닥 앞 그늘과 접촉선(책 위에)
const Contacts = memo(function Contacts({ entries, cam, s, clear, height, front = false }: { entries: BoxEntry[]; cam: Camera; s: number; clear: number; height: number; front?: boolean }) {
  const px: Px = (p) => ({ x: (SHELF.sideMargin + p.x) * s, y: (clear + p.y - FLOOR) * s });
  const shapes = entries
    .filter(({ placed }) => placed.y < 0.5)
    .map(({ placed: p }) => {
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
      <Contacts entries={entries} cam={cam} s={s} clear={clear} height={height} />
      <DepthFaces entries={entries} cam={cam} s={s} clear={clear} height={height} />
      {fronts.map((e) => (
        <FrontFace key={e.placed.bookId} entry={e} cam={cam} s={s} clear={clear} />
      ))}
      <Contacts entries={entries} cam={cam} s={s} clear={clear} height={height} front />
      <ShelfFront scale={s} clear={clear} />
    </View>
  );
});
