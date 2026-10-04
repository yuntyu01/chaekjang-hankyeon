// 책의 판·속지 면(책등·앞표지 그림 면 말고 나머지). 모두 book-parts의 3D 조각을 지금 자세·카메라로 투영한다(face-geometry).
// - 종이 단면 면(머리·꼬리·책배): 둥근 표지 테두리 안에 밝은 속지를 채우고, 들어간 종이 면의 무늬를 겹친다.
//   속지 면이 판 끝보다 들어가 있어서, 앞 면(책등 등)에 가려지는 부분은 그 앞 면이 나중에 덮는다(카메라가 보이는 만큼을 정한다).
// - 판 면(뒤표지)과 비스듬히 옆으로 간 앞표지·책등: 무광 판 색 + 면에 고정된 미세 질감 + 책등 쪽 제본 홈.
// 밝기는 면마다 공통 광원 램버트 하나(shadeColor 덮기)로, 책등·앞표지 그림 면과 같은 방식이다. 다만 종이(속지 면·안쪽 벽)는 그늘을
// 반만 받는다(PAPER_SHADE): 빛을 등진 속지도 밝은 아이보리로 보이게(시안 눕힘의 책배는 위쪽 속지보다 7%쯤만 어둡다). 판 테두리는 판 면과 같다.
import { BlurMask, Group, Path, Picture, Rect, Skia, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { brightness, facing, type Book3, type Cam } from '@/domain/book3';
import { CORNER_R, facePanel } from '@/domain/book-parts';
import { hull } from '@/domain/box';
import type { Point } from '@/domain/camera';
import { bookFacePath, PAGE_BASE, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { light } from '@/ui/lighting';

import type { BookArt } from './art';
import { EMPTY_PAGE, faceMatrix, faceVisible, HIDDEN_MATRIX, pageGeom, roundedPolygon, type Affine } from './face-geometry';
import { MaterialGrain } from './MaterialGrain';
import { JacketEdgeLight } from './JacketEdgeLight';

type RO<T> = Readonly<SharedValue<T>>;

export const PAPER_SHADE = 0.5;

export function shadeColor(k: number) {
  'worklet';
  return k < 1 ? `rgba(45, 32, 24, ${Math.min(0.5, (1 - k) * 1.1)})` : `rgba(255, 252, 245, ${Math.min(0.3, k - 1)})`;
}

function polysPath(list: Point[][]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (const pts of list) {
    if (pts.length < 3) continue;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

// 종이 단면 면 하나
export function PageFace({ f, state, cam, px, art, tone, closedHead = false }: { f: 'head' | 'tail' | 'fore'; state: RO<Book3>; cam: RO<Cam>; px: Affine; art: BookArt; tone: string; closedHead?: boolean }) {
  const g = useDerivedValue(() => f === 'head' && closedHead && state.value.dims.W * cam.value.ky <= 9.6 && Math.abs(state.value.roll) < 1 && Math.abs(Math.cos(state.value.yaw * Math.PI / 180)) > 0.98 ? EMPTY_PAGE : pageGeom(cam.value, state.value, f, px));
  const opening = useDerivedValue(() => polysPath(g.value.ok ? [roundedPolygon(hull(g.value.opening), 1.2 * px.s)] : []));
  const cap = useDerivedValue(() => polysPath(g.value.ok ? [roundedPolygon(hull(g.value.rims.flat()), CORNER_R * px.s)] : []));
  const walls = useDerivedValue(() => polysPath(g.value.walls));
  // A front-facing jacket still has a paper head between two boards. Let the
  // shared camera determine its visible thickness instead of hiding it at 90°.
  const m = useDerivedValue(() => g.value.pageM);
  // 판 테두리는 판 면과 같은 그늘, 종이(열린 칸 안의 속지·안쪽 벽)는 그늘을 반만(밝아지는 쪽은 그대로)
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const paper = useDerivedValue(() => {
    const k = brightness(light, state.value, f);
    return shadeColor(k < 1 ? 1 - (1 - k) * PAPER_SHADE : k);
  });
  const pic = f === 'fore' ? art.pageFore : art.pageEnd;
  return (
    <Group clip={cap}>
      <Path path={cap} color={tone} />
      <Path path={cap} color={shade} />
      <Group>
        <Path path={opening} color={PAGE_BASE} />
        <Group clip={opening}>
          <Group matrix={m}><Picture picture={pic} /></Group>
        </Group>
        <Path path={opening} color={paper} />
        <Path path={walls} color={withAlpha(scaleColor(tone, 0.72), 0.25)}>
          <BlurMask blur={0.6 * px.s} style="normal" />
        </Path>
      </Group>
    </Group>
  );
}

// Board material only. Edge and hinge light use the live 3D normal field.
function Board({ w, h, s, tone }: { w: number; h: number; s: number; tone: string }) {
  const W = w * s;
  const H = h * s;
  return (
    <>
      <Rect x={0} y={0} width={W} height={H} color={tone} />
      <MaterialGrain w={W} h={H} s={s} strength={0.12} />
    </>
  );
}

// 뒤표지 판 면
export function BackFace({ dims: d, state, cam, px, tone }: { dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const m = useDerivedValue(() => (faceVisible(cam.value, state.value, 'back') ? faceMatrix(state.value, 'back', cam.value, px) : HIDDEN_MATRIX));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, 'back')));
  const p = facePanel(d, 'back');
  return (
    <Group matrix={m} clip={bookFacePath(p.w * px.s, p.h * px.s, px.s)}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} />
      <Rect x={0} y={0} width={p.w * px.s} height={p.h * px.s} color={shade} />
      <JacketEdgeLight state={state} cam={cam} f="back" w={p.w * px.s} h={p.h * px.s} s={px.s} />
    </Group>
  );
}

// 앞표지·책등이 비스듬히 옆으로 갈수록 판 색으로 덮는다(정면에 가까울수록 그림이 드러난다). 그림 면 바로 위에 같은 변환으로.
export function GrazeFace({ f, dims: d, state, cam, px, tone }: { f: 'spine' | 'cover'; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const op = useDerivedValue(() => {
    const v = facing(cam.value, state.value, f);
    const edge = f === 'cover' ? 0.10 : 0.5;
    const fade = f === 'cover' ? 0.08 : 0.4;
    return v <= 0.002 ? 0 : Math.max(0, Math.min(1, (edge - v) / fade));
  });
  const m = useDerivedValue(() => (op.value > 0 ? faceMatrix(state.value, f, cam.value, px) : HIDDEN_MATRIX));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const p = facePanel(d, f);
  return (
    <Group matrix={m} opacity={op} clip={bookFacePath(p.w * px.s, p.h * px.s, px.s, f === 'spine')}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} />
      <Rect x={0} y={0} width={p.w * px.s} height={p.h * px.s} color={shade} />
      <JacketEdgeLight state={state} cam={cam} f={f} w={p.w * px.s} h={p.h * px.s} s={px.s} />
    </Group>
  );
}
