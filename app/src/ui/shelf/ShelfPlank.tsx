// 선반 판. ShelfRow가 쓴다.
// 모양: 3D 판 꼭짓점을 책과 같은 카메라로 투영한 면(domain/shelf-geom). 화면에 보이는 선반 외곽 = 이 면들의 외곽.
// 재질: 받은 선반 PNG에서 잘라 낸 나무 질감(윗면·앞면 안쪽만, scripts/extract-shelf-texture.py)을 각 면에 affine으로 붙인다.
// PNG의 외곽·투명 여백·원근 끝·바깥 그림자는 쓰지 않는다. 판이 벽에 드리우는 그림자는 광원으로 계산한다(ShelfWallShadow).
import { BlurMask, Group, ImageShader, LinearGradient, Path, Skia, useImage, vec, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { project, type Camera } from '@/domain/box';
import { shadowOnPlane, travelOf } from '@/domain/cast-shadow';
import { SHELF, SHELF_DEPTH } from '@/domain/geometry';
import { hull, rgba } from '@/domain/shadow-shape';
import type { Point } from '@/domain/shelf-scene';
import { faceTextureMatrix, shelfFaces, shelfVertices } from '@/domain/shelf-geom';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { light, plankLight, shadow } from '@/ui/theme';

type RO<T> = Readonly<SharedValue<T>>;

const TOP_TEX = require('../../../assets/bookshelf/shelf-top.png');
const FRONT_TEX = require('../../../assets/bookshelf/shelf-front.png');
const FLOOR = SHELF.clearHeight;
// 면 사이 이음새: 뒤에 그리는 면을 공유 변 너머로 이만큼(px) 덮어 투명 틈이 생기지 않게 한다(같은 꼭짓점, 그리기만 겹침)
const SEAM_PX = 0.6;

function pathOf(pts: Point[]) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  if (pts.length) {
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

function linePath(a: Point, b: Point) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  p.moveTo(a.x, a.y);
  p.lineTo(b.x, b.y);
  return p.detach();
}

// 선반 한 줄의 좌표 변환: 선반 공간을 투영한 설계 단위 → 이 줄의 px
export function shelfPx(s: number, clear: number) {
  'worklet';
  return { s, tx: SHELF.sideMargin * s, ty: (clear - FLOOR) * s };
}

// 공유 변 a→b 쪽으로 면을 SEAM_PX만큼 넓힌 다각형(px). dir: 넓힐 방향(화면 px 단위 벡터)
function grow(poly: Point[], i: number, j: number, dir: Point): Point[] {
  'worklet';
  return poly.map((q, k) => (k === i || k === j ? { x: q.x + dir.x * SEAM_PX, y: q.y + dir.y * SEAM_PX } : q));
}

// ---------- 판 → 벽 실제 그림자 ----------
// 빛 길이로 판을 나눈 층: 벽에 가까운 층(짧은 빛 길이)만 또렷하고 진하며, 먼 층일수록 넓고 옅고 흐리다.
// 층마다 판의 그 부분이 벽에 떨어뜨린 모양이라, 오른쪽 끝 너머 벽에는 먼 층(옅은 것)만 닿는다.
// 벽 중 판 뒤에 가려지는 부분은 판을 나중에 그려 덮는다.
const LIGHT = travelOf(light.dir);
const SW = shadow.cast.shelfWall;
// 그림자가 판 앞면 아래로 보이는 최대 길이(DU)
export const SHELF_CAST_EXTENT = SW.layers[SW.layers.length - 1] * Math.abs(LIGHT.y) + SW.blurPad;

function WallLayer({ cam, s, clear, k }: { cam: RO<Camera>; s: number; clear: number; k: number }) {
  const path = useDerivedValue(() => {
    const c = cam.value;
    const t = shelfPx(s, clear);
    const vs = shelfVertices();
    const all = [vs.LFT, vs.RFT, vs.RBT, vs.LBT, vs.LFB, vs.RFB, vs.RBB, vs.LBB];
    const r = shadowOnPlane(all, { x: 0, y: 0, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, LIGHT, SW.layers[k]);
    return pathOf(hull(r.pts.map((q) => {
      const p = project(c, q);
      return { x: p.x * s + t.tx, y: p.y * s + t.ty };
    })));
  });
  return (
    <Path path={path} color={rgba(SW.color, SW.opacity[k])}>
      <BlurMask blur={((SW.near + SW.perDU * SW.layers[k]) * s) / 2} style="normal" />
    </Path>
  );
}

// 판 → 벽 그림자(줄 캔버스에서 판보다 먼저 그린다)
export function ShelfWallShadow({ cam, s, clear }: { cam: RO<Camera>; s: number; clear: number }) {
  return (
    <Group>
      {SW.layers.map((_, k) => (
        <WallLayer key={k} cam={cam} s={s} clear={clear} k={k} />
      ))}
    </Group>
  );
}

function Face({ poly, matrix, image, children }: { poly: RO<SkPath>; matrix: RO<number[]>; image: ReturnType<typeof useImage>; children?: React.ReactNode }) {
  return (
    <Group clip={poly}>
      <Path path={poly} color="#F3DDC3">
        {image ? <ImageShader image={image} tx="clamp" ty="clamp" matrix={matrix} /> : null}
      </Path>
      {children}
    </Group>
  );
}

// 판(줄의 한 캔버스 안에 그린다. 판 → 벽 그림자는 ShelfWallShadow로 따로, 그보다 나중에)
export function ShelfBoard({ scale: s, clear, cam }: { scale: number; clear: number; cam: RO<Camera> }) {
  const top = useImage(TOP_TEX);
  const front = useImage(FRONT_TEX);
  const tw = top?.width() ?? 1;
  const th = top?.height() ?? 1;
  const fw = front?.width() ?? 1;
  const fh = front?.height() ?? 1;
  // 지금 카메라로 판 면을 투영(시점을 끄는 동안에도 매 프레임)
  const g = useDerivedValue(() => {
    const f = shelfFaces(cam.value);
    const t = shelfPx(s, clear);
    const px = (q: Point) => ({ x: q.x * s + t.tx, y: q.y * s + t.ty });
    const topPoly = f.top.poly.map(px);
    // 앞면은 위 변(윗면과 공유)을 위로, 옆면은 왼쪽 변(윗면·앞면과 공유)을 왼쪽으로 조금 덮는다
    const frontPoly = grow(f.front.poly.map(px), 0, 1, { x: 0, y: -1 });
    const sidePoly = f.side ? grow(f.side.poly.map(px), 0, 3, { x: -1, y: 0 }) : [];
    const lfb = px(f.corners.LFB);
    const rfb = px(f.corners.RFB);
    const fTop = px(f.corners.LFT).y;
    const lip = shadow.ao.shelfLip.dy * s * 2;
    return {
      top: pathOf(topPoly),
      front: pathOf(frontPoly),
      side: pathOf(sidePoly),
      topM: faceTextureMatrix(f.top, tw, th, s, t.tx, t.ty),
      frontM: faceTextureMatrix(f.front, fw, fh, s, t.tx, t.ty),
      sideM: f.side ? faceTextureMatrix(f.side, fw, fh, s, t.tx, t.ty) : [1, 0, 0, 0, 1, 0, 0, 0, 1],
      lip: pathOf([lfb, rfb, { x: rfb.x, y: rfb.y + lip }, { x: lfb.x, y: lfb.y + lip }]),
      edge: linePath(px(f.corners.LFT), px(f.corners.RFT)),
      sideEdge: linePath(px(f.corners.RFT), px(f.corners.RBT)),
      g0: vec(0, lfb.y - (lfb.y - fTop) * 0.35),
      g1: vec(0, lfb.y),
    };
  });
  const topP = useDerivedValue(() => g.value.top);
  const frontP = useDerivedValue(() => g.value.front);
  const sideP = useDerivedValue(() => g.value.side);
  const topM = useDerivedValue(() => g.value.topM);
  const frontM = useDerivedValue(() => g.value.frontM);
  const sideM = useDerivedValue(() => g.value.sideM);
  const lipP = useDerivedValue(() => g.value.lip);
  const edge = useDerivedValue(() => g.value.edge);
  const sideEdge = useDerivedValue(() => g.value.sideEdge);
  const g0 = useDerivedValue(() => g.value.g0);
  const g1 = useDerivedValue(() => g.value.g1);
  return (
      <Group>
        {/* 주변광 차폐: 판 앞면 바로 아래 좁은 어둠(광원과 무관한 분위기 층) */}
        {SHOW.shelfAO ? (
          <Path path={lipP} color={rgba(shadow.ao.shelfLip.color, shadow.ao.shelfLip.opacity)}>
            <BlurMask blur={(shadow.ao.shelfLip.blur / 2) * s} style="normal" />
          </Path>
        ) : null}
        {/* 윗면: 빛을 받아 살짝 밝게(질감 명암 위에 한 번만) */}
        <Face poly={topP} matrix={topM} image={top}>
          <Path path={topP} color={`rgba(255,255,255,${plankLight.top})`} />
        </Face>
        {/* 앞면: 질감 자체가 이미 윗면보다 어둡다. 코드 명암은 아주 약하게, 아래쪽 가장자리만 살짝 */}
        <Face poly={frontP} matrix={frontM} image={front}>
          <Path path={frontP} color={`rgba(59,51,48,${plankLight.front})`} />
          <Path path={frontP}>
            <LinearGradient start={g0} end={g1} colors={['rgba(110,75,45,0)', 'rgba(110,75,45,0.10)']} />
          </Path>
        </Face>
        {/* 오른쪽 옆면: 빛 반대쪽이라 앞면보다 조금 더 어둡게 */}
        <Face poly={sideP} matrix={sideM} image={front}>
          {SHOW.shelfSide ? <Path path={sideP} color="rgba(59,51,48,0.10)" /> : null}
        </Face>
        {/* 윗면과 앞면이 만나는 모서리의 은은한 광택(둥글게 깎인 모서리에 빛이 맺힌 느낌) */}
        <Path path={edge} style="stroke" strokeWidth={0.8 * s} strokeCap="round" color="rgba(255,250,240,0.55)">
          <BlurMask blur={0.35 * s} style="normal" />
        </Path>
        <Path path={sideEdge} style="stroke" strokeWidth={0.6 * s} strokeCap="round" color="rgba(255,250,240,0.25)">
          <BlurMask blur={0.35 * s} style="normal" />
        </Path>
      </Group>
  );
}
