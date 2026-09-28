// 선반 판. ShelfRow가 쓴다.
// 모양: 3D 판 꼭짓점을 책과 같은 카메라로 투영한 면(domain/shelf-geom). 화면에 보이는 선반 외곽 = 이 면들의 외곽.
// 재질: 받은 선반 PNG에서 잘라 낸 나무 질감(윗면·앞면 안쪽만, scripts/extract-shelf-texture.py)을 각 면에 affine으로 붙인다.
// PNG의 외곽·투명 여백·원근 끝·바깥 그림자는 쓰지 않는다. 판이 벽에 드리우는 그림자는 광원으로 계산한다(ShelfWallShadow).
import { BlurMask, Canvas, Group, ImageShader, LinearGradient, Path, Skia, useImage, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { hull, rgba } from '@/domain/shadow-shape';
import { shadowOnPlane, travelOf } from '@/domain/cast-shadow';
import { SHELF_DEPTH } from '@/domain/geometry';
import { shelfVertices } from '@/domain/shelf-geom';
import { light, shadow } from '@/ui/theme';

import { project, type Camera } from '@/domain/box';
import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import type { Point } from '@/domain/shelf-scene';
import { faceTextureMatrix, shelfFaces, type ShelfFace } from '@/domain/shelf-geom';
import { plankLight } from '@/ui/theme';
import { SHOW } from '@/ui/shelf/shadow-debug';

const TOP_TEX = require('../../../assets/bookshelf/shelf-top.png');
const FRONT_TEX = require('../../../assets/bookshelf/shelf-front.png');
const FLOOR = SHELF.clearHeight;
// 면 사이 이음새: 뒤에 그리는 면을 공유 변 너머로 이만큼(px) 덮어 투명 틈이 생기지 않게 한다(같은 꼭짓점, 그리기만 겹침)
const SEAM_PX = 0.6;

function pathOf(pts: Point[]) {
  const p = Skia.PathBuilder.Make();
  p.moveTo(pts[0].x, pts[0].y);
  for (const q of pts.slice(1)) p.lineTo(q.x, q.y);
  p.close();
  return p.detach();
}

// 선반 한 줄의 좌표 변환: 선반 공간을 투영한 설계 단위 → 이 줄의 px
export function shelfPx(s: number, clear: number) {
  return { s, tx: SHELF.sideMargin * s, ty: (clear - FLOOR) * s };
}

export function useShelfFaces(cam: Camera, s: number, clear: number) {
  return useMemo(() => {
    const f = shelfFaces(cam);
    const t = shelfPx(s, clear);
    const px = (q: Point) => ({ x: q.x * s + t.tx, y: q.y * s + t.ty });
    return { f, t, px };
  }, [cam, s, clear]);
}

function Face({ face, image, w, h, s, t, poly, children }: { face: ShelfFace; image: ReturnType<typeof useImage>; w: number; h: number; s: number; t: { tx: number; ty: number }; poly: Point[]; children?: React.ReactNode }) {
  const path = useMemo(() => pathOf(poly), [poly]);
  const m = useMemo(() => faceTextureMatrix(face, w, h, s, t.tx, t.ty), [face, w, h, s, t]);
  return (
    <Group clip={path}>
      <Path path={path} color="#F3DDC3">
        {image ? <ImageShader image={image} tx="clamp" ty="clamp" matrix={m} /> : null}
      </Path>
      {children}
    </Group>
  );
}

// 공유 변 a→b 쪽으로 면을 SEAM_PX만큼 넓힌 다각형(px). dir: 넓힐 방향(화면 px 단위 벡터)
function grow(poly: Point[], i: number, j: number, dir: Point): Point[] {
  return poly.map((q, k) => (k === i || k === j ? { x: q.x + dir.x * SEAM_PX, y: q.y + dir.y * SEAM_PX } : q));
}

// ---------- 판 → 벽 실제 그림자 ----------
// 판 여덟 꼭짓점을 광원 방향으로 벽(z = SHELF_DEPTH)에 떨어뜨린 볼록 외곽. 판 뒤 모서리는 벽에 붙어 있어 거기서 시작한다.
// 면광원: 벽 위 한 점의 진하기는 그 점을 가리는 판까지의 빛 길이 r로 정한다(r = 벽에서 아래로 내려간 거리 / |D.y|).
// 벽 중 판 뒤에 가려지는 부분은 판을 나중에 그려 덮는다. 아래 줄 책은 아래 줄이 나중에 그려 덮는다(책에 지는 그림자는 아직 없음).
const LIGHT = travelOf(light.dir);
const SW = shadow.cast.shelfWall;
// 그림자가 판 앞면 아래로 보이는 최대 길이(DU): 진하기가 5% 아래로 떨어지는 곳까지
export const SHELF_CAST_EXTENT = SW.layers[SW.layers.length - 1] * Math.abs(LIGHT.y) + SW.blurPad;

function ShelfWallShadow({ cam, s, clear }: { cam: Camera; s: number; clear: number }) {
  const g = useMemo(() => {
    const t = shelfPx(s, clear);
    const px = (q: Point) => ({ x: q.x * s + t.tx, y: q.y * s + t.ty });
    const vs = Object.values(shelfVertices());
    const wall = { x: 0, y: 0, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 }; // 벽 면(사용자 쪽을 향함)
    const top = px(project(cam, shelfVertices().LBB)).y - 4 * s;
    let bottom = top;
    // 빛 길이로 판을 나눈 층: 벽에 가까운 층(짧은 빛 길이)만 또렷하고 진하며, 먼 층일수록 넓고 옅고 흐리다.
    // 층마다 판의 그 부분이 벽에 떨어뜨린 모양이라, 오른쪽 끝 너머 벽에는 먼 층(옅은 것)만 닿는다.
    const layers = SW.layers.map((tMax, k) => {
      const r = shadowOnPlane(vs, wall, n, LIGHT, tMax);
      const pts = hull(r.pts.map((q) => px(project(cam, q))));
      for (const q of pts) bottom = Math.max(bottom, q.y);
      return { path: pathOf(pts.map((q) => ({ x: q.x, y: q.y - top }))), color: rgba(shadow.color, SW.opacity[k]), blur: (SW.near + SW.perDU * tMax) * s };
    });
    const h = bottom - top + SW.blurPad * s;
    return { layers, top, h };
  }, [cam, s, clear]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: g.top, width: DESIGN_WIDTH * s, height: g.h }}>
      <Canvas style={{ width: DESIGN_WIDTH * s, height: g.h }}>
        {g.layers.map((l, k) => (
          <Path key={k} path={l.path} color={l.color}>
            <BlurMask blur={l.blur / 2} style="normal" />
          </Path>
        ))}
      </Canvas>
    </View>
  );
}

export function ShelfBoard({ scale: s, clear, cam, height }: { scale: number; clear: number; cam: Camera; height: number }) {
  const { f, t, px } = useShelfFaces(cam, s, clear);
  const top = useImage(TOP_TEX);
  const front = useImage(FRONT_TEX);
  const topPoly = useMemo(() => f.top.poly.map(px), [f, px]);
  // 앞면은 위 변(윗면과 공유)을 위로, 옆면은 왼쪽 변(윗면·앞면과 공유)을 왼쪽으로 조금 덮는다
  const frontPoly = useMemo(() => grow(f.front.poly.map(px), 0, 1, { x: 0, y: -1 }), [f, px]);
  const sidePoly = useMemo(() => (f.side ? grow(f.side.poly.map(px), 0, 3, { x: -1, y: 0 }) : null), [f, px]);
  const edge = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    const a = px(f.corners.LFT);
    const b = px(f.corners.RFT);
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
    return p.detach();
  }, [f, px]);
  const sideEdge = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    const a = px(f.corners.RFT);
    const b = px(f.corners.RBT);
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
    return p.detach();
  }, [f, px]);
  const fTop = px(f.corners.LFT).y;
  const fBot = px(f.corners.LFB).y;
  const tw = top?.width() ?? 1;
  const th = top?.height() ?? 1;
  const fw = front?.width() ?? 1;
  const fh = front?.height() ?? 1;
  return (
    <>
      {/* 실제 그림자: 판 → 벽 */}
      {SHOW.shelf ? <ShelfWallShadow cam={cam} s={s} clear={clear} /> : null}
      <Canvas style={[StyleSheet.absoluteFill, { width: DESIGN_WIDTH * s, height: height + SHELF_CAST_EXTENT * s }]} pointerEvents="none">
        {/* 주변광 차폐: 판 앞면 바로 아래 좁은 어둠(광원과 무관한 분위기 층) */}
        <Path path={pathOf([px(f.corners.LFB), px(f.corners.RFB), { x: px(f.corners.RFB).x, y: fBot + shadow.ao.shelfLip.dy * s * 2 }, { x: px(f.corners.LFB).x, y: fBot + shadow.ao.shelfLip.dy * s * 2 }])} color={rgba(shadow.color, shadow.ao.shelfLip.opacity)}>
          <BlurMask blur={(shadow.ao.shelfLip.blur / 2) * s} style="normal" />
        </Path>
        {/* 윗면: 빛을 받아 살짝 밝게(질감 명암 위에 한 번만) */}
        <Face face={f.top} image={top} w={tw} h={th} s={s} t={t} poly={topPoly}>
          <Path path={pathOf(topPoly)} color={`rgba(255,255,255,${plankLight.top})`} />
        </Face>
        {/* 앞면: 질감 자체가 이미 윗면보다 어둡다. 코드 명암은 아주 약하게, 아래쪽 가장자리만 살짝 */}
        <Face face={f.front} image={front} w={fw} h={fh} s={s} t={t} poly={frontPoly}>
          <Path path={pathOf(frontPoly)} color={`rgba(59,51,48,${plankLight.front})`} />
          <Path path={pathOf(frontPoly)}>
            <LinearGradient start={vec(0, fBot - (fBot - fTop) * 0.35)} end={vec(0, fBot)} colors={['rgba(110,75,45,0)', 'rgba(110,75,45,0.10)']} />
          </Path>
        </Face>
        {/* 오른쪽 옆면: 빛 반대쪽이라 앞면보다 조금 더 어둡게 */}
        {f.side && sidePoly ? (
          <Face face={f.side} image={front} w={fw} h={fh} s={s} t={t} poly={sidePoly}>
            <Path path={pathOf(sidePoly)} color="rgba(59,51,48,0.10)" />
          </Face>
        ) : null}
        {/* 윗면과 앞면이 만나는 모서리의 은은한 광택(둥글게 깎인 모서리에 빛이 맺힌 느낌) */}
        <Path path={edge} style="stroke" strokeWidth={0.8 * s} strokeCap="round" color="rgba(255,250,240,0.55)">
          <BlurMask blur={0.35 * s} style="normal" />
        </Path>
        <Path path={sideEdge} style="stroke" strokeWidth={0.6 * s} strokeCap="round" color="rgba(255,250,240,0.25)">
          <BlurMask blur={0.35 * s} style="normal" />
        </Path>
      </Canvas>
    </>
  );
}
