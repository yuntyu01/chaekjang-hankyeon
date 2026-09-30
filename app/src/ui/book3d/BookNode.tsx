// 책 한 권 = Skia 그룹 하나. 지금 자세(Book3, UI 스레드 SharedValue)에서 여섯 면을 매 프레임 투영해 그린다.
// - 책등·앞표지: 기록해 둔 그림(Picture)을 면 변환 행렬에 태운다. 글자도 그 면에 붙어 면만큼 보인다.
//   누울 때만 책등 글자·작은 모티프를 바로 세워(돌리면서) 가로로 읽히게 한다.
// - 나머지 면(뒤표지·머리·꼬리·책배): 표지 판·종이 단면 재질. 앞표지·책등이 비스듬히 옆으로 갈수록 판 색으로 덮인다.
// - 밝기: 면 법선과 광원(램버트). 책끼리 앞뒤는 매 프레임 깊이로(zIndex).
import { Group, Image as SkImg, ImageSVG, LinearGradient, Path, Picture, Rect, Skia, Text, vec } from '@shopify/react-native-skia';
import type React from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { brightness, corners, depthKey, faceCorners, facing, rot, toWorld, viewCam, type Book3, type Cam, type FaceId } from '@/domain/book3';
import { project } from '@/domain/box';
import type { Book } from '@/domain/types';
import { BOX_HEAD_BOW, litTone, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { RENDER } from '@/ui/perf';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { light } from '@/ui/theme';

import { useBookArt, toneOf, type BookArt, type Shared } from './art';
import { FaceShape } from './FaceShape';
import { faceMatrix, sideFaceGeom, seedOf, type Affine } from './face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

function smooth(a: number, b: number, v: number) {
  'worklet';
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function shadeColor(k: number) {
  'worklet';
  return k < 1 ? `rgba(45, 32, 24, ${Math.min(0.5, (1 - k) * 1.1)})` : `rgba(255, 252, 245, ${Math.min(0.3, k - 1)})`;
}

// 누울수록 글자·모티프를 바로 세운다(기대기 정도의 기울기에서는 책과 함께 기운다)
function upright(b: Book3) {
  'worklet';
  const r = b.roll;
  const sm = smooth(15, 75, Math.abs(r));
  return { angle: -r * sm, sm };
}

// 책등 글자·모티프 칸: 누울수록 바로 세운다(칸 가운데를 축으로)
function Upright({ cx, cy, cyLie, state, fit, children }: { cx: number; cy: number; cyLie?: number; state: RO<Book3>; fit: number; children: React.ReactNode }) {
  const tf = useDerivedValue(() => {
    const u = upright(state.value);
    const k = 1 + (fit - 1) * u.sm;
    const y = cyLie === undefined ? cy : cy + (cyLie - cy) * u.sm;
    return [{ translateX: cx }, { translateY: y }, { rotate: (u.angle * Math.PI) / 180 }, { scale: k }];
  });
  return <Group transform={tf}>{children}</Group>;
}

// ---------- 둥근 책등(얕은 베벨)의 빛 ----------
// 책등 양쪽 가장자리와 머리 쪽 가장자리는 둥글게 넘어간다: 그 좁은 띠의 법선을 바깥쪽으로 기울여(가상 법선)
// 공통 광원과의 각도로 밝기를 매 프레임 계산한다. 빛을 향하면 따뜻한 무광 하이라이트, 반대면 원래 색을 거의 유지하는 옅은 그늘.
// 책을 눕히거나 돌리면 밝은 모서리도 따라 바뀐다(세우면 왼쪽·머리, 눕히면 위쪽 모서리가 밝다).
const BEVEL_DEG = 62;
const LN = (() => {
  const d = light.dir;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
})();

function litDelta(b: Book3, n: { x: number; y: number; z: number }) {
  'worklet';
  const w = rot(b.roll, b.yaw, n, b.spin ?? 0, b.pitch ?? 0);
  const w0 = rot(b.roll, b.yaw, { x: 0, y: 0, z: -1 }, b.spin ?? 0, b.pitch ?? 0);
  return w.x * LN.x + w.y * LN.y + w.z * LN.z - (w0.x * LN.x + w0.y * LN.y + w0.z * LN.z);
}

// 빛 쪽 모서리는 책 색을 밝힌 색(흰 띠가 아니라 표지색과 이어지게), 반대쪽은 같은 책 색을 조금 어둡게(검은 테두리가 아니게)
function bevelColor(delta: number, lit: string, dark: string) {
  'worklet';
  if (delta >= 0) return withAlpha(lit, Math.min(0.45, delta * 2.4));
  return withAlpha(dark, Math.min(0.22, -delta * 0.4));
}

// 가장자리에서 안쪽으로: 기울기 1(가장자리) → 0.45 → 0(평평)
const PROFILE = [1, 0.45, 0];

function edgeColors(b: Book3, axis: 'x' | 'y', sign: number, lit: string, dark: string) {
  'worklet';
  const out: string[] = [];
  for (const k of PROFILE) {
    const a = (BEVEL_DEG * k * Math.PI) / 180;
    const n = axis === 'x' ? { x: sign * Math.sin(a), y: 0, z: -Math.cos(a) } : { x: 0, y: Math.sin(a), z: -Math.cos(a) };
    out.push(bevelColor(litDelta(b, n), lit, dark));
  }
  return out;
}

// 둥근 책등: 책등 폭 전체에 걸쳐 법선을 -50°~+50°로 기울인 원통으로 보고 공통 광원으로 밝기를 매긴다(가장자리 테두리 없이
// 완만하게 이어지는 명암). 세우면 왼쪽이, 눕히면 위쪽이 밝다(책 자세를 따라 광원 기준으로 바뀐다). 머리 쪽 가장자리는 좁게.
const ROUND = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1];
const ROUND_DEG = 50;
function roundColors(b: Book3, lit: string, dark: string) {
  'worklet';
  const out: string[] = [];
  for (const u of ROUND) {
    const a = (ROUND_DEG * u * Math.PI) / 180;
    const d = litDelta(b, { x: Math.sin(a), y: 0, z: -Math.cos(a) });
    out.push(d >= 0 ? withAlpha(lit, Math.min(0.32, d * 1.6)) : withAlpha(dark, Math.min(0.2, -d * 0.45)));
  }
  return out;
}
const ROUND_POS = ROUND.map((u) => (u + 1) / 2);

function SpineBevel({ state, w, h, s, tone }: { state: RO<Book3>; w: number; h: number; s: number; T: number; tone: string }) {
  const bh = 2.6 * s;
  const lit = litTone(tone);
  const dark = scaleColor(tone, 0.7);
  const across = useDerivedValue(() => roundColors(state.value, lit, dark));
  const head = useDerivedValue(() => edgeColors(state.value, 'y', 1, lit, dark));
  const pos = [0, 0.45, 1];
  return (
    <>
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={across} positions={ROUND_POS} />
      </Rect>
      <Rect x={0} y={0} width={w} height={bh}>
        <LinearGradient start={vec(0, 0)} end={vec(0, bh)} colors={head} positions={pos} />
      </Rect>
    </>
  );
}

function ArtFace({ f, art, state, cam, px, d, tone }: { f: 'spine' | 'cover'; art: BookArt; state: RO<Book3>; cam: RO<Cam>; px: Affine; d: Book3['dims']; tone: string }) {
  const s = px.s;
  // 보이지 않는 면은 행렬을 0으로(그룹 불투명도만으로는 기록된 그림이 얇은 선으로 남는다)
  const m = useDerivedValue(() => {
    const c = viewCam(cam.value, state.value);
    return facing(c, state.value, f) > 0.002 ? faceMatrix(state.value, f, c, px) : [0, 0, -1e4, 0, 0, -1e4, 0, 0, 1];
  });
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const w = (f === 'spine' ? d.T : d.W) * s;
  const h = d.H * s;
  // 누웠을 때 글자·모티프 크기: 두께 안에 들어가게
  const fitG = Math.min(1, (0.42 * d.T) / Math.max(1, art.fontDU));
  const fitM = art.motif ? Math.min(1, (0.62 * d.T * s) / art.motif.h, (0.22 * d.H * s) / art.motif.w) : 1;
  return (
    <Group matrix={m}>
      <Picture picture={f === 'spine' ? art.spine : art.cover} />
      <Rect x={0} y={0} width={w} height={h} color={shade} />
      {f === 'spine' && SHOW.body ? <SpineBevel state={state} w={w} h={h} s={s} T={d.T} tone={tone} /> : null}
      {f === 'spine' ? (
        <>
          {art.motif ? (
            <Upright cx={art.motif.cx} cy={art.motif.cy} state={state} fit={fitM}>
              {art.motif.image ? (
                <SkImg image={art.motif.image} x={-art.motif.w / 2} y={-art.motif.h / 2} width={art.motif.w} height={art.motif.h} fit="contain" />
              ) : art.motif.svg ? (
                <ImageSVG svg={art.motif.svg} x={-art.motif.w / 2} y={-art.motif.h / 2} width={art.motif.w} height={art.motif.h} />
              ) : null}
            </Upright>
          ) : null}
          {art.cells.map((c, i) => (
            <Upright key={i} cx={c.cx} cy={c.cy} cyLie={c.cyLie} state={state} fit={fitG}>
              <Picture picture={c.pic} />
            </Upright>
          ))}
        </>
      ) : null}
    </Group>
  );
}

function Side({ f, state, cam, px, book, pages, tone, grain, graze }: { f: FaceId; state: RO<Book3>; cam: RO<Cam>; px: Affine; book: Book; pages: boolean; tone: string; grain: Shared['grain']; graze?: boolean }) {
  const seed = seedOf(book.id, f);
  const bow = BOX_HEAD_BOW * px.s;
  const geom = useDerivedValue(() => sideFaceGeom(viewCam(cam.value, state.value), state.value, f, px, bow, pages, seed));
  const k = useDerivedValue(() => brightness(light, state.value, f));
  // 앞표지·책등이 옆면이 되면(비스듬히) 판 색으로 덮는다: 정면에 가까울수록 그림이 드러난다
  const op = useDerivedValue(() => (graze ? Math.max(0, Math.min(1, (0.5 - facing(viewCam(cam.value, state.value), state.value, f)) / 0.4)) : 1));
  return <FaceShape geom={geom} pages={pages} tone={tone} k={k} s={px.s} grain={grain} opacity={op} />;
}

// 측정용 기본 도형: 책등·표지 면을 그림 없이 단색 사각형으로
function PlainFace({ f, state, cam, px, tone }: { f: 'spine' | 'cover'; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const path = useDerivedValue(() => {
    const b = state.value;
    const c = viewCam(cam.value, b);
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
    const p = project(viewCam(cam.value, b), toWorld(b, { x: d.T * 0.55, y: d.H, z: d.W * 0.18 }));
    return [{ translateX: p.x * px.s + px.tx }, { translateY: p.y * px.s + px.ty }, { rotate: (b.roll * Math.PI) / 180 }];
  });
  return (
    <Group transform={tf}>
      <Picture picture={art.ribbons!} />
    </Group>
  );
}

export { depthKey } from '@/domain/book3';

const NOTHING = Skia.XYWHRect(0, 0, 0, 0);

// shared: 캔버스 밖에서 useBookShared()로 읽어 넘긴다
// under: 면 위·갈피 아래에 그릴 것(이 책이 받는 그림자)
// order: 줄 전체의 그리는 순서(가림 순서, ShelfMotion의 drawOrder). 없으면(서랍·단독) 깊이 키.
// hidden: 그리지 않는다(끌고 있는 동안 줄의 자리. 마운트는 유지해 놓는 순간 바로 다시 보인다)
export function BookNode({ book, dims, state, cam, px, shared, under, order, hidden = false }: { book: Book; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; shared: Shared; under?: React.ReactNode; order?: RO<number>; hidden?: boolean }) {
  const art = useBookArt(book, px.s, dims, shared);
  const z = useDerivedValue(() => (order ? order.value : depthKey(state.value)));
  if (!art) return null;
  const tone = toneOf(book, false);
  const ctone = toneOf(book, true);
  return (
    <Group zIndex={z} clip={hidden ? NOTHING : undefined}>
      {/* 올려다볼 때는 머리 면이 안 보이므로 책 뒤에서 나오는 것처럼(먼저), 정면·내려다볼 때는 머리 면 위에(나중) */}
      <Side f="back" state={state} cam={cam} px={px} book={book} pages={false} tone={tone} grain={shared.grain} />
      <Side f="head" state={state} cam={cam} px={px} book={book} pages tone={tone} grain={shared.grain} />
      <Side f="tail" state={state} cam={cam} px={px} book={book} pages tone={tone} grain={shared.grain} />
      <Side f="fore" state={state} cam={cam} px={px} book={book} pages tone={ctone} grain={shared.grain} />
      {RENDER.art ? (
        <>
          <ArtFace f="spine" art={art} state={state} cam={cam} px={px} d={dims} tone={tone} />
          <ArtFace f="cover" art={art} state={state} cam={cam} px={px} d={dims} tone={ctone} />
          <Side f="cover" state={state} cam={cam} px={px} book={book} pages={false} tone={ctone} grain={shared.grain} graze />
          <Side f="spine" state={state} cam={cam} px={px} book={book} pages={false} tone={tone} grain={shared.grain} graze />
        </>
      ) : (
        <>
          <PlainFace f="spine" state={state} cam={cam} px={px} tone={tone} />
          <PlainFace f="cover" state={state} cam={cam} px={px} tone={ctone} />
        </>
      )}
      {under}
      {/* 갈피: 내려다보는 시점(3°~8°)이라 머리 면 위에 그린다 */}
      {art.ribbons && RENDER.art ? <Ribbons art={art} state={state} cam={cam} px={px} /> : null}
    </Group>
  );
}
