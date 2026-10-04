// 책 한 권 = Skia 그룹 하나. 지금 자세(Book3, UI 스레드 SharedValue)에서 몸체 조각(domain/book-parts)을 매 프레임 투영해 그린다.
// - 책등·앞표지: 기록해 둔 그림(Picture)을 면 변환 행렬에 태운다. 글자도 그 면에 붙어 몸체와 함께 돈다(글자를 따로 돌리지 않는다).
//   책등 제목은 조판 두 가지(세운 책등 = 세로, 눕힌 책등 = 가로 한 줄)를 따로 기록해 두고 자세(눕힘 정도)로 고른다:
//   몸체 회전은 면 변환만 바꾸고, 조판 변경은 어느 그림을 보일지만 바꾼다(둘을 섞지 않는다).
// - 머리·꼬리·책배: 판 끝보다 안쪽으로 들어간 속지 면 + 판·책등 테두리(BookFaces). 뒤표지: 판 면.
//   앞표지·책등이 비스듬히 옆으로 갈수록 판 색으로 덮인다.
// - 그리는 순서: 속지 면(안쪽) 먼저, 바깥 면(판·책등·앞표지) 나중: 들어간 속지 가운데 바깥 면 뒤로 숨는 부분은 바깥 면이 덮는다.
// - 둥근 모서리: 책 전체 투영 윤곽을 공통 반지름으로 깎아 자른다(모든 면·받는 그림자가 같이). 갈피 끈만 윤곽 밖(머리 위로 나온다).
// - 밝기: 면 법선과 광원(램버트) + 약한 면 안 명암 + 빛을 받는 변에만 좁고 부드러운 밝음(검은 외곽선·사방 테두리 없음).
//   책끼리 앞뒤는 매 프레임 가림 순서로(zIndex).
import { Group, LinearGradient, Path, Picture, Rect, Skia, vec, type SkRect } from '@shopify/react-native-skia';
import type React from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { brightness, corners, depthKey, faceCorners, facing, rot, toWorld, type Book3, type Cam } from '@/domain/book3';
import { project } from '@/domain/camera';
import { bookViewCam } from '@/domain/book-view';
import { jacketHeadReveal } from '@/domain/book-design';
import { titleOpacity } from '@/domain/title-layout';
import type { Book } from '@/domain/types';
import { bookFacePath, litTone, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { RENDER } from '@/ui/perf';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { light } from '@/ui/lighting';

import { JacketEdgeLight } from './JacketEdgeLight';
import { useBookArt, toneOf, type BookArt, type Shared } from './art';
import { BackFace, GrazeFace, PageFace, shadeColor } from './BookFaces';
import { faceMatrix, HIDDEN_MATRIX, silhouette, type Affine } from './face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

// 책등 곡면의 명암. 면 사이의 둥근 연결은 JacketEdgeLight에서 같은 광원으로 그린다.
const LN = (() => {
  const d = light.dir;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
})();

type V3 = { x: number; y: number; z: number };
// n0: 기준 면 법선(없으면 책등). 기본값 매개변수는 워클릿에 실리지 않아 본문에서 정한다.
function litDelta(b: Book3, n: V3, n0?: V3) {
  'worklet';
  const w = rot(b.roll, b.yaw, n, b.spin ?? 0, b.pitch ?? 0);
  const w0 = rot(b.roll, b.yaw, n0 ?? { x: 0, y: 0, z: -1 }, b.spin ?? 0, b.pitch ?? 0);
  return w.x * LN.x + w.y * LN.y + w.z * LN.z - (w0.x * LN.x + w0.y * LN.y + w0.z * LN.z);
}

// 책등 면 안의 약한 명암: 책등 폭을 가장자리에서 ±80°까지 넘어가는 낮은 원통으로 보고 공통 광원으로 아주 옅게(무광의 은은한 결).
// 빛 쪽은 책 색을 밝힌 색, 반대쪽은 같은 책 색을 낮춘 색으로 넓게 옅어진다(좁은 어두운 선이 아니다). 세우면 왼쪽, 눕히면 위가 밝다.
const ROUND_DEG = [-80, -58, -32, 0, 32, 58, 80];
const ROUND_POS = ROUND_DEG.map((g) => (Math.sin((g * Math.PI) / 180) / Math.sin((80 * Math.PI) / 180) + 1) / 2);
const ROUND = { lit: 0.13, dark: 0.12, litGain: 2.4, darkGain: 0.18, dead: 0.035 };
function roundColors(b: Book3, lit: string, dark: string) {
  'worklet';
  const out: string[] = [];
  for (const g of ROUND_DEG) {
    const a = (g * Math.PI) / 180;
    const d = litDelta(b, { x: Math.sin(a), y: 0, z: -Math.cos(a) });
    out.push(d >= 0 ? withAlpha(lit, Math.min(ROUND.lit, Math.max(0, d - ROUND.dead) * ROUND.litGain)) : withAlpha(dark, Math.min(ROUND.dark, -d * ROUND.darkGain)));
  }
  return out;
}

// 그늘 쪽 가장자리 띠: 시안 책등은 면이 거의 평평하고, 빛을 등진 쪽 가장자리(세우면 오른쪽) 약 2.6DU가 13~20% 어둡다.
// 공통 광원으로 정한다(자세를 바꾸면 그늘 쪽으로 옮겨 간다). 검은 선이 아니라 같은 책 색을 낮춘 넓은 그러데이션이다.
const SIDE_BAND = { width: 2.6, dead: 0.45, gain: 0.65, max: 0.21 };
function sideBands(b: Book3) {
  'worklet';
  const a = (80 * Math.PI) / 180;
  const dl = litDelta(b, { x: -Math.sin(a), y: 0, z: -Math.cos(a) });
  const dr = litDelta(b, { x: Math.sin(a), y: 0, z: -Math.cos(a) });
  return [Math.min(SIDE_BAND.max, Math.max(0, -dl - SIDE_BAND.dead) * SIDE_BAND.gain), Math.min(SIDE_BAND.max, Math.max(0, -dr - SIDE_BAND.dead) * SIDE_BAND.gain)];
}

function SpineShade({ state, w, h, s, tone }: { state: RO<Book3>; w: number; h: number; s: number; tone: string }) {
  const lit = litTone(tone);
  const dark = scaleColor(tone, 0.6);
  const across = useDerivedValue(() => roundColors(state.value, lit, dark));
  const band = useDerivedValue(() => sideBands(state.value));
  const cl = useDerivedValue(() => [withAlpha(dark, band.value[0]), withAlpha(dark, 0)]);
  const cr = useDerivedValue(() => [withAlpha(dark, 0), withAlpha(dark, band.value[1])]);
  const bw = Math.min(w * 0.3, SIDE_BAND.width * s);
  return (
    <>
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={across} positions={ROUND_POS} />
      </Rect>
      <Rect x={0} y={0} width={bw} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec(bw, 0)} colors={cl} />
      </Rect>
      <Rect x={w - bw} y={0} width={bw} height={h}>
        <LinearGradient start={vec(w - bw, 0)} end={vec(w, 0)} colors={cr} />
      </Rect>
    </>
  );
}

// 책등 제목: 세로 조판(세운 책등)과 가로 조판(눕힌 책등)을 눕힘 정도로 고른다. 보이지 않는 쪽은 화면 밖으로 보낸다
// (불투명도 0만으로는 기록된 그림이 얇은 선으로 남는다). 바뀌는 구간(36~54°)에서 하나가 사라진 뒤 다른 하나가 나타난다.
function SpineTitles({ art, state }: { art: BookArt; state: RO<Book3> }) {
  const op = useDerivedValue(() => titleOpacity(state.value.roll));
  const vOp = useDerivedValue(() => op.value.v);
  const hOp = useDerivedValue(() => op.value.h);
  const vT = useDerivedValue(() => [{ translateX: op.value.v <= 0 ? -1e5 : 0 }]);
  const hT = useDerivedValue(() => [{ translateX: op.value.h <= 0 ? -1e5 : 0 }]);
  return (
    <>
      <Group opacity={vOp} transform={vT}>
        <Picture picture={art.titleV} />
      </Group>
      <Group opacity={hOp} transform={hT}>
        <Picture picture={art.titleH} />
      </Group>
    </>
  );
}

function ArtFace({ f, art, state, cam, px, d, tone, headReveal = 0.35 }: { f: 'spine' | 'cover'; art: BookArt; state: RO<Book3>; cam: RO<Cam>; px: Affine; d: Book3['dims']; tone: string; headReveal?: number }) {
  const s = px.s;
  // 보이지 않는 면, 비스듬히 옆으로 가 판 색에 완전히 덮이는 면(GrazeFace 불투명)은 그리지 않는다(행렬을 화면 밖 한 점으로)
  const m = useDerivedValue(() => {
    const c = cam.value;
    const b = state.value;
    if (facing(c, b, f) <= 0.02) return HIDDEN_MATRIX;
    const matrix = faceMatrix(b, f, c, px);
    if (f === 'spine') {
      // 둥글게 감싼 책등이 종이 머리 일부를 가린다. 바닥은 고정하고
      // 위쪽만 감싸며, 눕히거나 돌릴 때는 실제 평면으로 부드럽게 돌아온다.
      const upright = Math.cos(b.roll * Math.PI / 180) ** 2;
      const front = Math.cos(b.yaw * Math.PI / 180) ** 2;
      const lift = Math.min(9.5, d.W * c.ky) * (1 - headReveal) * upright * front;
      matrix[2] -= matrix[1] * lift * s;
      matrix[5] -= matrix[4] * lift * s;
      matrix[8] -= matrix[7] * lift * s;
      matrix[1] *= 1 + lift / d.H;
      matrix[4] *= 1 + lift / d.H;
      matrix[7] *= 1 + lift / d.H;
    }
    return matrix;
  });
  const w = (f === 'spine' ? d.T : d.W) * s;
  const h = d.H * s;
  const prelit = f === 'spine' ? art.prelitSpine : art.prelitCover;
  const shade = useDerivedValue(() => {
    const b = state.value;
    const k = brightness(light, b, f);
    // The sampled jacket already contains the reference's frontal light.
    // Only apply the change in light caused by a new pose, avoiding double shade.
    const reference = prelit ? brightness(light, { ...b, roll: 0, yaw: f === 'cover' ? 90 : 0, spin: 0, pitch: 0 }, f) : 1;
    return shadeColor(k / reference);
  });
  const materialTransform = useDerivedValue(() => {
    const horizontal = Math.abs(state.value.roll) > 45;
    const flip = f === 'spine' && art.prelitSpine && horizontal !== art.spineHorizontal;
    return [{ translateX: flip ? w : 0 }, { scaleX: flip ? -1 : 1 }];
  });
  return (
    <Group matrix={m} clip={bookFacePath(w, h, s, f === 'spine')}>
      <Group transform={materialTransform}><Picture picture={f === 'spine' ? art.spine : art.cover} /></Group>
      {f === 'spine' && SHOW.body && !prelit ? <SpineShade state={state} w={w} h={h} s={s} tone={tone} /> : null}
      {SHOW.body ? <JacketEdgeLight state={state} f={f} w={w} h={h} s={s} tone={tone} strength={prelit ? 0.85 : 1} /> : null}
      {SHOW.faceDebug ? <Rect x={0} y={0} width={w} height={h} color={f === 'spine' ? 'rgba(44,91,208,0.45)' : 'rgba(208,52,44,0.45)'} /> : null}
      {f === 'spine' ? <SpineTitles art={art} state={state} /> : null}
      {SHOW.body ? <Rect x={0} y={0} width={w} height={h} color={shade} /> : null}
    </Group>
  );
}

// 측정용 기본 도형: 책등·표지 면을 그림 없이 단색 사각형으로
function PlainFace({ f, state, cam, px, tone }: { f: 'spine' | 'cover'; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const path = useDerivedValue(() => {
    const b = state.value;
    const c = cam.value;
    const p = Skia.PathBuilder.Make();
    if (facing(c, b, f) <= 0.002) return p.detach();
    const cs = corners(b);
    faceCorners(f).forEach((i, n) => {
      const q = project(c, cs[i]);
      if (n === 0) p.moveTo(q.x * px.s + px.tx, q.y * px.s + px.ty);
      else p.lineTo(q.x * px.s + px.tx, q.y * px.s + px.ty);
    });
    p.close();
    return p.detach();
  });
  const color = useDerivedValue(() => scaleColor(tone, Math.min(1.06, brightness(light, state.value, f))));
  return <Path path={path} color={color} />;
}

function Ribbons({ art, state, cam, px }: { art: BookArt; state: RO<Book3>; cam: RO<Cam>; px: Affine }) {
  const tf = useDerivedValue(() => {
    const b = state.value;
    const d = b.dims;
    // 갈피는 종이 머리 뒤쪽에서 나온다. 감싸 올라간 책등과 같은 높이로
    // 보여야 띠 아래가 책 앞면에 붙은 사각형처럼 드러나지 않는다.
    const p = project(cam.value, toWorld(b, { x: d.T * 0.55, y: d.H, z: d.W * 0.8 }));
    return [{ translateX: p.x * px.s + px.tx }, { translateY: p.y * px.s + px.ty }, { rotate: (b.roll * Math.PI) / 180 }];
  });
  return (
    <Group transform={tf}>
      <Picture picture={art.ribbons!} />
    </Group>
  );
}

export { depthKey } from '@/domain/book3';

// shared: 캔버스 밖에서 useBookShared()로 읽어 넘긴다
// under: 면 위·갈피 아래에 그릴 것(이 책이 받는 그림자)
// order: 줄 전체의 그리는 순서(가림 순서, ShelfMotion의 drawOrder). 없으면(서랍·단독) 깊이 키.
// clip: 이 책을 그릴 영역(없으면 전부). 줄 캔버스는 다른 줄로 옮겨 가는 동안 빈 영역을 준다(그동안은 이동 캔버스가 그린다)
export function BookNode({ book, dims, state, cam: sceneCam, px, shared, under, order, clip }: { book: Book; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; shared: Shared; under?: React.ReactNode; order?: RO<number>; clip?: RO<SkRect> }) {
  const cam = useDerivedValue(() => bookViewCam(sceneCam.value, state.value));
  const art = useBookArt(book, px.s, dims, shared);
  const headReveal = jacketHeadReveal(book);
  const bindingTone = toneOf(book);
  const warmBinding = parseInt(bindingTone.slice(1,3),16) > parseInt(bindingTone.slice(3,5),16);
  const z = useDerivedValue(() => (order ? order.value : depthKey(state.value)));
  // 둥근 모서리: 투영 윤곽을 공통 반지름으로 깎은 모양(face-geometry silhouette)
  const outline = useDerivedValue(() => {
    const pts = silhouette(cam.value, state.value, px);
    const p = Skia.PathBuilder.Make();
    // A single Bezier crown keeps the closed head smooth at small screen sizes.
    if (headReveal < 0.05 && state.value.dims.W * cam.value.ky <= 9.6 && Math.abs(state.value.roll) < 0.1 && Math.abs(state.value.yaw) < 0.1) {
      const x0=Math.min(...pts.map(q=>q.x)),x1=Math.max(...pts.map(q=>q.x));
      const y0=Math.min(...pts.map(q=>q.y))+(warmBinding?0.4:0.8)*px.s,y1=Math.max(...pts.map(q=>q.y));
      const w=x1-x0,r=Math.min(4*px.s,w*.20),a=1.2*px.s;
      p.moveTo(x0,y0+r+a);
      p.quadTo(x0,y0+a,x0+r,y0+a);
      p.cubicTo(x0+w*.25,y0-a/3,x0+w*.75,y0-a/3,x1-r,y0+a);
      p.quadTo(x1,y0+a,x1,y0+r+a);
      p.lineTo(x1,y1-r-a);p.quadTo(x1,y1-a,x1-r,y1-a);
      p.cubicTo(x0+w*.75,y1+a/3,x0+w*.25,y1+a/3,x0+r,y1-a);
      p.quadTo(x0,y1-a,x0,y1-r-a);
      p.close();
      return p.detach();
    }
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.close();
    return p.detach();
  });
  if (!art) return null;
  // 몸체 색 하나: 판 두 장·책등·판 끝·책등 띠가 모두 같은 책 색이다
  const tone = toneOf(book);
  return (
    <Group zIndex={z} clip={clip}>
      <Group clip={outline}>
        {/* A continuous jacket closes the joins between the rounded boards. */}
        <Path path={outline} color={tone} />
        {/* 안쪽: 머리·꼬리·책배(판 끝보다 들어간 속지 + 테두리) */}
        <PageFace f="head" state={state} cam={cam} px={px} art={art} tone={tone} closedHead={headReveal < 0.05} />
        <PageFace f="tail" state={state} cam={cam} px={px} art={art} tone={tone} />
        <PageFace f="fore" state={state} cam={cam} px={px} art={art} tone={tone} />
        {/* 바깥: 뒤표지 판, 책등·앞표지 그림(비스듬하면 판 색으로 덮는다) */}
        <BackFace dims={dims} state={state} cam={cam} px={px} tone={tone} />
        {RENDER.art ? (
          <>
            <ArtFace f="spine" art={art} state={state} cam={cam} px={px} d={dims} tone={tone} headReveal={headReveal} />
            <ArtFace f="cover" art={art} state={state} cam={cam} px={px} d={dims} tone={tone} />
            <GrazeFace f="cover" dims={dims} state={state} cam={cam} px={px} tone={tone} />
            <GrazeFace f="spine" dims={dims} state={state} cam={cam} px={px} tone={tone} />
          </>
        ) : (
          <>
            <PlainFace f="spine" state={state} cam={cam} px={px} tone={tone} />
            <PlainFace f="cover" state={state} cam={cam} px={px} tone={tone} />
          </>
        )}
        {under}
      </Group>
      {/* 갈피: 머리 위로 나오므로 둥근 윤곽 밖에 */}
      {art.ribbons && RENDER.art ? <Ribbons art={art} state={state} cam={cam} px={px} /> : null}
    </Group>
  );
}
