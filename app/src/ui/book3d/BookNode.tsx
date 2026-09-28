// 책 한 권 = Skia 그룹 하나. 지금 자세(Book3, UI 스레드 SharedValue)에서 여섯 면을 매 프레임 투영해 그린다.
// - 책등·앞표지: 기록해 둔 그림(Picture)을 면 변환 행렬에 태운다. 글자도 그 면에 붙어 면만큼 보인다.
//   누울 때만 책등 글자·작은 모티프를 바로 세워(돌리면서) 가로로 읽히게 한다.
// - 나머지 면(뒤표지·머리·꼬리·책배): 표지 판·종이 단면 재질. 앞표지·책등이 비스듬히 옆으로 갈수록 판 색으로 덮인다.
// - 밝기: 면 법선과 광원(램버트). 책끼리 앞뒤는 매 프레임 깊이로(zIndex).
import { Group, Image as SkImg, ImageSVG, Picture, Rect, Text } from '@shopify/react-native-skia';
import type React from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { brightness, corners, faceFrame, facing, rot, toWorld, type Book3, type Cam, type FaceId } from '@/domain/book3';
import { project } from '@/domain/box';
import type { Book } from '@/domain/types';
import { BOX_HEAD_BOW } from '@/ui/book/BookBody';
import { light } from '@/ui/theme';

import { useBookArt, toneOf, type BookArt, type Shared } from './art';
import { FaceShape } from './FaceShape';
import { sideFaceGeom, seedOf, type Affine } from './face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

// 면 그림 px → 캔버스 px 행렬(3×3, 행 우선)
function faceMatrix(b: Book3, f: 'spine' | 'cover', cam: Cam, px: Affine) {
  'worklet';
  const fr = faceFrame(b.dims, f);
  const O = project(cam, toWorld(b, fr.O));
  const U = rot(b.roll, b.yaw, fr.U);
  const V = rot(b.roll, b.yaw, fr.V);
  const s = px.s;
  const ux = (U.x + U.z * cam.kx) / fr.w;
  const uy = -(U.y + U.z * cam.ky) / fr.w;
  const vx = (V.x + V.z * cam.kx) / fr.h;
  const vy = -(V.y + V.z * cam.ky) / fr.h;
  return [ux, vx, O.x * s + px.tx, uy, vy, O.y * s + px.ty, 0, 0, 1];
}

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

function ArtFace({ f, art, state, cam, px, d }: { f: 'spine' | 'cover'; art: BookArt; state: RO<Book3>; cam: Cam; px: Affine; d: Book3['dims'] }) {
  const s = px.s;
  const m = useDerivedValue(() => faceMatrix(state.value, f, cam, px));
  const vis = useDerivedValue(() => (facing(cam, state.value, f) > 0.002 ? 1 : 0));
  const shade = useDerivedValue(() => shadeColor(brightness(light, state.value, f)));
  const w = (f === 'spine' ? d.T : d.W) * s;
  const h = d.H * s;
  // 누웠을 때 글자·모티프 크기: 두께 안에 들어가게
  const fitG = Math.min(1, (0.42 * d.T) / Math.max(1, art.fontDU));
  const fitM = art.motif ? Math.min(1, (0.62 * d.T * s) / art.motif.h, (0.22 * d.H * s) / art.motif.w) : 1;
  return (
    <Group matrix={m} opacity={vis}>
      <Picture picture={f === 'spine' ? art.spine : art.cover} />
      <Rect x={0} y={0} width={w} height={h} color={shade} />
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
              <Text x={c.x} y={c.y} text={c.ch} font={art.font} color={art.ink} />
              {c.punct ? <Text x={c.punct.x} y={c.punct.y} text={c.punct.text} font={art.font} color={art.ink} /> : null}
            </Upright>
          ))}
        </>
      ) : null}
    </Group>
  );
}

function Side({ f, state, cam, px, book, pages, tone, grain, graze }: { f: FaceId; state: RO<Book3>; cam: Cam; px: Affine; book: Book; pages: boolean; tone: string; grain: Shared['grain']; graze?: boolean }) {
  const seed = seedOf(book.id, f);
  const bow = BOX_HEAD_BOW * px.s;
  const geom = useDerivedValue(() => sideFaceGeom(cam, state.value, f, px, bow, pages, seed));
  const k = useDerivedValue(() => brightness(light, state.value, f));
  // 앞표지·책등이 옆면이 되면(비스듬히) 판 색으로 덮는다: 정면에 가까울수록 그림이 드러난다
  const op = useDerivedValue(() => (graze ? Math.max(0, Math.min(1, (0.5 - facing(cam, state.value, f)) / 0.4)) : 1));
  return <FaceShape geom={geom} pages={pages} tone={tone} k={k} s={px.s} grain={grain} opacity={op} />;
}

function Ribbons({ art, state, cam, px }: { art: BookArt; state: RO<Book3>; cam: Cam; px: Affine }) {
  const tf = useDerivedValue(() => {
    const b = state.value;
    const d = b.dims;
    const p = project(cam, toWorld(b, { x: d.T * 0.55, y: d.H, z: d.W * 0.35 }));
    return [{ translateX: p.x * px.s + px.tx }, { translateY: p.y * px.s + px.ty }, { rotate: (b.roll * Math.PI) / 180 }];
  });
  return (
    <Group transform={tf}>
      <Picture picture={art.ribbons!} />
    </Group>
  );
}

// 앞뒤 순서: 뒤(깊이 큰) → 앞, 아래 → 위, 왼쪽 → 오른쪽
export function depthKey(b: Book3) {
  'worklet';
  const c = corners(b);
  let z = Infinity;
  let y = Infinity;
  let x = Infinity;
  for (const q of c) {
    z = Math.min(z, q.z);
    y = Math.min(y, q.y);
    x = Math.min(x, q.x);
  }
  return -z * 10 + y * 0.05 + x * 0.0001;
}

// shared: 캔버스 밖에서 useBookShared()로 읽어 넘긴다
export function BookNode({ book, dims, state, cam, px, shared }: { book: Book; dims: Book3['dims']; state: RO<Book3>; cam: Cam; px: Affine; shared: Shared }) {
  const art = useBookArt(book, px.s, dims, shared);
  const z = useDerivedValue(() => depthKey(state.value));
  if (!art) return null;
  const tone = toneOf(book, false);
  const ctone = toneOf(book, true);
  return (
    <Group zIndex={z}>
      {art.ribbons ? <Ribbons art={art} state={state} cam={cam} px={px} /> : null}
      <Side f="back" state={state} cam={cam} px={px} book={book} pages={false} tone={tone} grain={shared.grain} />
      <Side f="head" state={state} cam={cam} px={px} book={book} pages tone={tone} grain={shared.grain} />
      <Side f="tail" state={state} cam={cam} px={px} book={book} pages tone={tone} grain={shared.grain} />
      <Side f="fore" state={state} cam={cam} px={px} book={book} pages tone={ctone} grain={shared.grain} />
      <ArtFace f="spine" art={art} state={state} cam={cam} px={px} d={dims} />
      <ArtFace f="cover" art={art} state={state} cam={cam} px={px} d={dims} />
      <Side f="cover" state={state} cam={cam} px={px} book={book} pages={false} tone={ctone} grain={shared.grain} graze />
      <Side f="spine" state={state} cam={cam} px={px} book={book} pages={false} tone={tone} grain={shared.grain} graze />
    </Group>
  );
}
