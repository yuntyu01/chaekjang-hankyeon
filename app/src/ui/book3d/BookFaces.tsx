// 책의 판·속지 면(책등·앞표지 그림 면 말고 나머지). 모두 book-parts의 3D 조각을 지금 자세·카메라로 투영한다(face-geometry).
// - 종이 단면 면(머리·꼬리·책배): 열린 칸(판 사이로 보이는 종이) → 판 끝보다 sq 안쪽의 속지 면(기록한 그림, 면 변환) → 보이는 안쪽 벽 → 판·책등 테두리.
//   속지 면이 판 끝보다 들어가 있어서, 앞 면(책등 등)에 가려지는 부분은 그 앞 면이 나중에 덮는다(카메라가 보이는 만큼을 정한다).
// - 판 면(뒤표지)과 비스듬히 옆으로 간 앞표지·책등: 판 색(균일한 무광) + 제본 홈(책등 쪽). 질감은 덧씌우지 않는다.
// 밝기는 면마다 공통 광원 램버트 하나(shadeColor 덮기)로, 책등·앞표지 그림 면과 같은 방식이다. 다만 종이(속지 면·안쪽 벽)는 그늘을
// 반만 받는다(PAPER_SHADE): 빛을 등진 속지도 밝은 아이보리로 보이게(시안 눕힘의 책배는 위쪽 속지보다 7%쯤만 어둡다). 판 테두리는 판 면과 같다.
import { BlurMask, Group, Path, Picture, Rect, Skia, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { brightness, facing, type Book3, type Cam } from '@/domain/book3';
import { facePanel, GROOVE } from '@/domain/book-parts';
import type { Point } from '@/domain/camera';
import { litTone, PAGE_BASE, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { light } from '@/ui/lighting';

import type { BookArt } from './art';
import { faceMatrix, faceVisible, HIDDEN_MATRIX, pageGeom, type Affine } from './face-geometry';

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

// 판 안쪽은 면지(종이)라 종이색이다. 판 사이로 들여다보이는 칸(속지 묶음의 끝 단면이 비스듬히 보이는 곳)은 조금 그늘진 아이보리,
// 카메라 쪽을 향한 판 안쪽 벽은 그보다 덜 그늘진 아이보리(속지와 같은 계열이라 어두운 띠·윤곽선처럼 읽히지 않게).
// 시안: 머리 면은 책 색 테두리 안의 밝은 아이보리 속지뿐이다(베이지 안쪽 띠 없음). 칸·벽도 속지보다 조금만 어둡게.
const GAP = scaleColor(PAGE_BASE, 0.96);
const WALL = scaleColor(PAGE_BASE, 0.985);

// 종이 단면 면 하나
export function PageFace({ f, state, cam, px, art, tone }: { f: 'head' | 'tail' | 'fore'; state: RO<Book3>; cam: RO<Cam>; px: Affine; art: BookArt; tone: string }) {
  const g = useDerivedValue(() => pageGeom(cam.value, state.value, f, px));
  const opening = useDerivedValue(() => polysPath(g.value.ok ? [g.value.opening] : []));
  const rims = useDerivedValue(() => polysPath(g.value.rims));
  const walls = useDerivedValue(() => polysPath(g.value.walls));
  const m = useDerivedValue(() => g.value.pageM);
  // 판 테두리는 판 면과 같은 그늘, 종이(열린 칸 안의 속지·안쪽 벽)는 그늘을 반만(밝아지는 쪽은 그대로)
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const paper = useDerivedValue(() => {
    const k = brightness(light, state.value, f);
    return shadeColor(k < 1 ? 1 - (1 - k) * PAPER_SHADE : k);
  });
  const pic = f === 'fore' ? art.pageFore : art.pageEnd;
  return (
    <>
      <Path path={opening} color={GAP} />
      <Group matrix={m}>
        <Picture picture={pic} />
      </Group>
      <Path path={walls} color={WALL} />
      <Path path={opening} color={paper} />
      <Path path={rims} color={tone} />
      <Path path={rims} color={shade} />
    </>
  );
}

// 판 면 그림(판 색 + 제본 홈). w×h(DU), hingeAt: 제본 홈이 있는 쪽(그림 가로 0 = 왼쪽, 1 = 오른쪽, null = 없음)
function Board({ w, h, s, tone, hingeAt }: { w: number; h: number; s: number; tone: string; hingeAt: 0 | 1 | null }) {
  const W = w * s;
  const H = h * s;
  // 제본 홈(GROOVE, 앞표지 그림과 같은 규칙): 책등 쪽 변에서 at 안쪽의 그늘, 그 뒤 gap에 가는 밝음
  const side = (d: number) => (hingeAt === 1 ? W - d * s : d * s);
  const gx = side(GROOVE.at);
  const ex = side(GROOVE.at + GROOVE.gap + GROOVE.lit / 2);
  return (
    <>
      <Rect x={0} y={0} width={W} height={H} color={tone} />
      {hingeAt !== null ? (
        <>
          <Rect x={gx - (GROOVE.dark / 2) * s} y={0} width={GROOVE.dark * s} height={H} color={withAlpha(scaleColor(tone, 0.55), 0.14)}>
            <BlurMask blur={0.45 * s} style="normal" />
          </Rect>
          <Rect x={ex - (GROOVE.lit / 2) * s} y={0} width={GROOVE.lit * s} height={H} color={withAlpha(litTone(tone), 0.2)} />
        </>
      ) : null}
    </>
  );
}

// 뒤표지 판 면
export function BackFace({ dims: d, state, cam, px, tone }: { dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const m = useDerivedValue(() => (faceVisible(cam.value, state.value, 'back') ? faceMatrix(state.value, 'back', cam.value, px) : HIDDEN_MATRIX));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, 'back')));
  const p = facePanel(d, 'back');
  return (
    <Group matrix={m}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} hingeAt={1} />
      <Rect x={0} y={0} width={p.w * px.s} height={p.h * px.s} color={shade} />
    </Group>
  );
}

// 앞표지·책등이 비스듬히 옆으로 갈수록 판 색으로 덮는다(정면에 가까울수록 그림이 드러난다). 그림 면 바로 위에 같은 변환으로.
export function GrazeFace({ f, dims: d, state, cam, px, tone }: { f: 'spine' | 'cover'; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const op = useDerivedValue(() => {
    const v = facing(cam.value, state.value, f);
    return v <= 0.002 ? 0 : Math.max(0, Math.min(1, (0.5 - v) / 0.4));
  });
  const m = useDerivedValue(() => (op.value > 0 ? faceMatrix(state.value, f, cam.value, px) : HIDDEN_MATRIX));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const p = facePanel(d, f);
  return (
    <Group matrix={m} opacity={op}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} hingeAt={f === 'cover' ? 0 : null} />
      <Rect x={0} y={0} width={p.w * px.s} height={p.h * px.s} color={shade} />
    </Group>
  );
}
