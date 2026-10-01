// 책의 판·속지 면(책등·앞표지 그림 면 말고 나머지). 모두 book-parts의 3D 조각을 지금 자세·카메라로 투영한다(face-geometry).
// - 종이 단면 면(머리·꼬리·책배): 열린 칸(판 사이 그늘) → 판 끝보다 sq 안쪽의 속지 면(기록한 그림, 면 변환) → 보이는 안쪽 벽 → 판·책등 테두리.
//   속지 면이 판 끝보다 들어가 있어서, 앞 면(책등 등)에 가려지는 부분은 그 앞 면이 나중에 덮는다(카메라가 보이는 만큼을 정한다).
// - 판 면(뒤표지)과 비스듬히 옆으로 간 앞표지·책등: 판 색 + 붓결 + 제본 홈(책등 쪽).
// 밝기는 면마다 공통 광원 램버트 하나(shadeColor 덮기)로, 책등·앞표지 그림 면과 같은 방식이다.
import { BlurMask, Group, ImageShader, Path, Picture, Rect, Skia, type SkImage, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { brightness, facing, type Book3, type Cam } from '@/domain/book3';
import { facePanel, GROOVE } from '@/domain/book-parts';
import type { Point } from '@/domain/camera';
import { GRAIN_STRENGTH, litTone, mix, PAGE_BASE, PAGE_RIM, scaleColor, SRC_DU, withAlpha } from '@/ui/book/BookBody';
import { RENDER } from '@/ui/perf';
import { light } from '@/ui/lighting';

import type { BookArt } from './art';
import { faceMatrix, faceVisible, HIDDEN_MATRIX, pageGeom, type Affine } from './face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

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

// 판 안쪽은 면지(종이)라 종이색이다. 판 사이로 들여다보이는 칸은 그늘진 종이, 카메라 쪽을 향한 판 안쪽 벽은 조금 덜 그늘진 종이.
// (판 색을 낮춘 색으로 칠하면 속지 대신 어두운 줄이 생겨 윤곽선처럼 읽힌다)
const GAP = mix(scaleColor(PAGE_BASE, 0.84), PAGE_RIM, 0.18);
const WALL = mix(scaleColor(PAGE_BASE, 0.92), PAGE_RIM, 0.08);

// 종이 단면 면 하나
export function PageFace({ f, state, cam, px, art, tone }: { f: 'head' | 'tail' | 'fore'; state: RO<Book3>; cam: RO<Cam>; px: Affine; art: BookArt; tone: string }) {
  const g = useDerivedValue(() => pageGeom(cam.value, state.value, f, px));
  const opening = useDerivedValue(() => polysPath(g.value.ok ? [g.value.opening] : []));
  const rims = useDerivedValue(() => polysPath(g.value.rims));
  const walls = useDerivedValue(() => polysPath(g.value.walls));
  // 면 전체(열린 칸 + 테두리)를 한 번에 덮는 밝기
  const whole = useDerivedValue(() => polysPath(g.value.ok ? [...g.value.rims, g.value.opening] : []));
  const m = useDerivedValue(() => g.value.pageM);
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const pic = f === 'fore' ? art.pageFore : art.pageEnd;
  return (
    <>
      <Path path={opening} color={GAP} />
      <Group matrix={m}>
        <Picture picture={pic} />
      </Group>
      <Path path={walls} color={WALL} />
      <Path path={rims} color={tone} />
      <Path path={whole} color={shade} />
    </>
  );
}

// 판 면 그림(판 색 + 붓결 + 제본 홈). w×h(DU), hingeAt: 제본 홈이 있는 쪽(그림 가로 0 = 왼쪽, 1 = 오른쪽, null = 없음)
function Board({ w, h, s, tone, grain, hingeAt }: { w: number; h: number; s: number; tone: string; grain: SkImage | null; hingeAt: 0 | 1 | null }) {
  const W = w * s;
  const H = h * s;
  // 제본 홈(GROOVE, 앞표지 그림과 같은 규칙): 책등 쪽 변에서 at 안쪽의 그늘, 그 뒤 gap에 가는 밝음
  const side = (d: number) => (hingeAt === 1 ? W - d * s : d * s);
  const gx = side(GROOVE.at);
  const ex = side(GROOVE.at + GROOVE.gap + GROOVE.lit / 2);
  return (
    <>
      <Rect x={0} y={0} width={W} height={H} color={tone} />
      {RENDER.grain && grain ? (
        <Rect x={0} y={0} width={W} height={H} blendMode="softLight" opacity={GRAIN_STRENGTH}>
          <ImageShader image={grain} tx="repeat" ty="repeat" transform={[{ scale: SRC_DU * s }]} />
        </Rect>
      ) : null}
      {hingeAt !== null ? (
        <>
          <Rect x={gx - (GROOVE.dark / 2) * s} y={0} width={GROOVE.dark * s} height={H} color={withAlpha(scaleColor(tone, 0.55), 0.18)}>
            <BlurMask blur={0.4 * s} style="normal" />
          </Rect>
          <Rect x={ex - (GROOVE.lit / 2) * s} y={0} width={GROOVE.lit * s} height={H} color={withAlpha(litTone(tone), 0.16)} />
        </>
      ) : null}
    </>
  );
}

// 뒤표지 판 면
export function BackFace({ dims: d, state, cam, px, tone, grain }: { dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string; grain: SkImage | null }) {
  const m = useDerivedValue(() => (faceVisible(cam.value, state.value, 'back') ? faceMatrix(state.value, 'back', cam.value, px) : HIDDEN_MATRIX));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, 'back')));
  const p = facePanel(d, 'back');
  return (
    <Group matrix={m}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} grain={grain} hingeAt={1} />
      <Rect x={0} y={0} width={p.w * px.s} height={p.h * px.s} color={shade} />
    </Group>
  );
}

// 앞표지·책등이 비스듬히 옆으로 갈수록 판 색으로 덮는다(정면에 가까울수록 그림이 드러난다). 그림 면 바로 위에 같은 변환으로.
export function GrazeFace({ f, dims: d, state, cam, px, tone, grain }: { f: 'spine' | 'cover'; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string; grain: SkImage | null }) {
  const op = useDerivedValue(() => {
    const v = facing(cam.value, state.value, f);
    return v <= 0.002 ? 0 : Math.max(0, Math.min(1, (0.5 - v) / 0.4));
  });
  const m = useDerivedValue(() => (op.value > 0 ? faceMatrix(state.value, f, cam.value, px) : HIDDEN_MATRIX));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const p = facePanel(d, f);
  return (
    <Group matrix={m} opacity={op}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} grain={grain} hingeAt={f === 'cover' ? 0 : null} />
      <Rect x={0} y={0} width={p.w * px.s} height={p.h * px.s} color={shade} />
    </Group>
  );
}
