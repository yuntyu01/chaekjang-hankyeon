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
import { titleOpacity } from '@/domain/title-layout';
import type { Book } from '@/domain/types';
import { litTone, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { RENDER } from '@/ui/perf';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { light } from '@/ui/lighting';

import { useBookArt, toneOf, type BookArt, type Shared } from './art';
import { BackFace, GrazeFace, PageFace, shadeColor } from './BookFaces';
import { faceMatrix, HIDDEN_MATRIX, silhouette, type Affine } from './face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

// ---------- 빛 받는 변의 좁은 밝음(둥글게 깎인 작은 모서리) ----------
// 면의 네 변은 둥글게 넘어간다: 그 좁은 띠의 법선을 바깥쪽으로 기울여(가상 법선) 공통 광원과의 각도로 밝기를 매 프레임 계산한다.
// 빛 쪽 변만 책 색을 밝힌 좁고 부드러운 밝음을 넣고, 빛을 등진 변은 아무것도 그리지 않는다(어두운 외곽선·사방 흰 테두리 없음).
// 세우면 왼쪽·머리, 눕히면 위쪽 긴 변·머리 끝, 표지 전시면 위·왼쪽 변이 밝다(자세와 광원을 따라 바뀐다).
const EDGE = { deg: 55, width: 1.1, gain: 1.6, max: 0.24 };
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

// 면 그림의 변(0 위 = 머리, 1 아래 = 꼬리, 2 왼쪽, 3 오른쪽)이 바깥으로 향하는 책 좌표 방향
// 책등 그림: 왼쪽 = 뒤표지 쪽(−x), 오른쪽 = 앞표지 쪽(+x). 앞표지 그림: 왼쪽 = 책등 쪽(−z), 오른쪽 = 책배 쪽(+z).
const SPINE_N: V3 = { x: 0, y: 0, z: -1 };
const COVER_N: V3 = { x: 1, y: 0, z: 0 };
function edgeOut(f: 'spine' | 'cover', e: number): V3 {
  'worklet';
  if (e === 0) return { x: 0, y: 1, z: 0 };
  if (e === 1) return { x: 0, y: -1, z: 0 };
  if (f === 'spine') return e === 2 ? { x: -1, y: 0, z: 0 } : { x: 1, y: 0, z: 0 };
  return e === 2 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 0, z: 1 };
}
function edgeAlphas(b: Book3, f: 'spine' | 'cover') {
  'worklet';
  const n0 = f === 'spine' ? SPINE_N : COVER_N;
  const a = (EDGE.deg * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const out: number[] = [];
  for (let e = 0; e < 4; e++) {
    const o = edgeOut(f, e);
    const n = { x: n0.x * c + o.x * sn, y: n0.y * c + o.y * sn, z: n0.z * c + o.z * sn };
    out.push(Math.min(EDGE.max, Math.max(0, litDelta(b, n, n0)) * EDGE.gain));
  }
  return out;
}

// 네 변의 좁은 밝음(변에서 안쪽으로 부드럽게 사라진다). w·h: 면 그림 크기(px)
function EdgeLights({ state, f, w, h, s, tone }: { state: RO<Book3>; f: 'spine' | 'cover'; w: number; h: number; s: number; tone: string }) {
  const lit = litTone(tone);
  const a = useDerivedValue(() => edgeAlphas(state.value, f));
  const c0 = useDerivedValue(() => [withAlpha(lit, a.value[0]), withAlpha(lit, 0)]);
  const c1 = useDerivedValue(() => [withAlpha(lit, a.value[1]), withAlpha(lit, 0)]);
  const c2 = useDerivedValue(() => [withAlpha(lit, a.value[2]), withAlpha(lit, 0)]);
  const c3 = useDerivedValue(() => [withAlpha(lit, a.value[3]), withAlpha(lit, 0)]);
  const t = EDGE.width * s;
  return (
    <>
      <Rect x={0} y={0} width={w} height={t}>
        <LinearGradient start={vec(0, 0)} end={vec(0, t)} colors={c0} />
      </Rect>
      <Rect x={0} y={h - t} width={w} height={t}>
        <LinearGradient start={vec(0, h)} end={vec(0, h - t)} colors={c1} />
      </Rect>
      <Rect x={0} y={0} width={t} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec(t, 0)} colors={c2} />
      </Rect>
      <Rect x={w - t} y={0} width={t} height={h}>
        <LinearGradient start={vec(w, 0)} end={vec(w - t, 0)} colors={c3} />
      </Rect>
    </>
  );
}

// 책등 면 안의 약한 명암: 책등 폭을 가장자리에서 ±80°까지 넘어가는 낮은 원통으로 보고 공통 광원으로 아주 옅게(무광의 은은한 결).
// 빛 쪽은 책 색을 밝힌 색, 반대쪽은 같은 책 색을 낮춘 색으로 넓게 옅어진다(좁은 어두운 선이 아니다). 세우면 왼쪽, 눕히면 위가 밝다.
const ROUND_DEG = [-80, -58, -32, 0, 32, 58, 80];
const ROUND_POS = ROUND_DEG.map((g) => (Math.sin((g * Math.PI) / 180) / Math.sin((80 * Math.PI) / 180) + 1) / 2);
const ROUND = { lit: 0.08, dark: 0.08, litGain: 2.4, darkGain: 0.11, dead: 0.085 };
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

function SpineShade({ state, w, h, tone }: { state: RO<Book3>; w: number; h: number; tone: string }) {
  const lit = litTone(tone);
  const dark = scaleColor(tone, 0.6);
  const across = useDerivedValue(() => roundColors(state.value, lit, dark));
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={across} positions={ROUND_POS} />
    </Rect>
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

function ArtFace({ f, art, state, cam, px, d, tone }: { f: 'spine' | 'cover'; art: BookArt; state: RO<Book3>; cam: RO<Cam>; px: Affine; d: Book3['dims']; tone: string }) {
  const s = px.s;
  // 보이지 않는 면, 비스듬히 옆으로 가 판 색에 완전히 덮이는 면(GrazeFace 불투명)은 그리지 않는다(행렬을 화면 밖 한 점으로)
  const m = useDerivedValue(() => {
    const c = cam.value;
    return facing(c, state.value, f) > 0.1 ? faceMatrix(state.value, f, c, px) : HIDDEN_MATRIX;
  });
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const w = (f === 'spine' ? d.T : d.W) * s;
  const h = d.H * s;
  return (
    <Group matrix={m}>
      <Picture picture={f === 'spine' ? art.spine : art.cover} />
      <Rect x={0} y={0} width={w} height={h} color={shade} />
      {f === 'spine' && SHOW.body ? <SpineShade state={state} w={w} h={h} tone={tone} /> : null}
      {SHOW.body ? <EdgeLights state={state} f={f} w={w} h={h} s={s} tone={tone} /> : null}
      {SHOW.faceDebug ? <Rect x={0} y={0} width={w} height={h} color={f === 'spine' ? 'rgba(44,91,208,0.45)' : 'rgba(208,52,44,0.45)'} /> : null}
      {f === 'spine' ? <SpineTitles art={art} state={state} /> : null}
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
    // 책등 가까이 책장 사이에서 나온다(머리 면 앞쪽 18%)
    const p = project(cam.value, toWorld(b, { x: d.T * 0.55, y: d.H, z: d.W * 0.18 }));
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
export function BookNode({ book, dims, state, cam, px, shared, under, order, clip }: { book: Book; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; shared: Shared; under?: React.ReactNode; order?: RO<number>; clip?: RO<SkRect> }) {
  const art = useBookArt(book, px.s, dims, shared);
  const z = useDerivedValue(() => (order ? order.value : depthKey(state.value)));
  // 둥근 모서리: 투영 윤곽을 공통 반지름으로 깎은 모양(face-geometry silhouette)
  const outline = useDerivedValue(() => {
    const pts = silhouette(cam.value, state.value, px);
    const p = Skia.PathBuilder.Make();
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
        {/* 안쪽: 머리·꼬리·책배(판 끝보다 들어간 속지 + 테두리) */}
        <PageFace f="head" state={state} cam={cam} px={px} art={art} tone={tone} />
        <PageFace f="tail" state={state} cam={cam} px={px} art={art} tone={tone} />
        <PageFace f="fore" state={state} cam={cam} px={px} art={art} tone={tone} />
        {/* 바깥: 뒤표지 판, 책등·앞표지 그림(비스듬하면 판 색으로 덮는다) */}
        <BackFace dims={dims} state={state} cam={cam} px={px} tone={tone} />
        {RENDER.art ? (
          <>
            <ArtFace f="spine" art={art} state={state} cam={cam} px={px} d={dims} tone={tone} />
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
