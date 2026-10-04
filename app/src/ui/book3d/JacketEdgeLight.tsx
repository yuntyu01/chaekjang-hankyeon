import { LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { rot, type Book3, type Vec3 } from '@/domain/book3';
import { mix, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { light } from '@/ui/lighting';

type Face = 'spine' | 'cover' | 'back';
const POSITIONS = [0, 0.26, 0.52, 0.8, 1];
const ANGLES = [64, 46, 24, 10, 0];
const lightLength = Math.hypot(light.dir.x, light.dir.y, light.dir.z);
const L = { x: light.dir.x / lightLength, y: light.dir.y / lightLength, z: light.dir.z / lightLength };

// A rounded binding rolls its normal toward the adjoining face. The light
// peaks inside that curve, then fades into the flat material, without a stroke.
function edgeColors(book: Book3, face: Face, edge: number, tone: string, strength: number) {
  'worklet';
  const normal: Vec3 = face === 'spine' ? { x: 0, y: 0, z: -1 } : { x: face === 'cover' ? 1 : -1, y: 0, z: 0 };
  const outward: Vec3 = edge < 2 ? { x: 0, y: edge === 0 ? 1 : -1, z: 0 }
    : face === 'spine' ? { x: edge === 2 ? -1 : 1, y: 0, z: 0 }
    : { x: 0, y: 0, z: (edge === 2 ? -1 : 1) * (face === 'back' ? -1 : 1) };
  const dot = (n: Vec3) => {
    const v = rot(book.roll, book.yaw, n, book.spin ?? 0, book.pitch ?? 0);
    return v.x * L.x + v.y * L.y + v.z * L.z;
  };
  const base = dot(normal);
  const rgb = tone.startsWith('#') ? [1, 3, 5].map(i => parseInt(tone.slice(i, i + 2), 16)) : (tone.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const lightness = (rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11) / 255;
  const lit = mix(tone, '#FFFDF5', 0.9), dark = scaleColor(tone, 0.72);
  const highlight = 0.25 + 0.6 * Math.max(0, (lightness - 0.45) / 0.55);
  return ANGLES.map(deg => {
    const a = deg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const delta = dot({ x: normal.x * c + outward.x * s, y: normal.y * c + outward.y * s, z: normal.z * c + outward.z * s }) - base;
    return delta >= 0 ? withAlpha(lit, Math.min(highlight, delta * 2.7) * strength)
      : withAlpha(dark, Math.min(0.17, -delta * 0.32) * strength);
  });
}

export function JacketEdgeLight({ state, f, w, h, s, tone, strength = 1 }: {
  state: Readonly<SharedValue<Book3>>; f: Face; w: number; h: number; s: number; tone: string; strength?: number;
}) {
  const top = useDerivedValue(() => edgeColors(state.value, f, 0, tone, strength));
  const bottom = useDerivedValue(() => edgeColors(state.value, f, 1, tone, strength));
  const left = useDerivedValue(() => edgeColors(state.value, f, 2, tone, strength));
  const right = useDerivedValue(() => edgeColors(state.value, f, 3, tone, strength));
  const tx = Math.min(w * 0.18, 3.8 * s), ty = Math.min(h * 0.18, 3.8 * s);
  return <>
    <Rect x={0} y={0} width={w} height={ty}><LinearGradient start={vec(0, 0)} end={vec(0, ty)} colors={top} positions={POSITIONS} /></Rect>
    <Rect x={0} y={h - ty} width={w} height={ty}><LinearGradient start={vec(0, h)} end={vec(0, h - ty)} colors={bottom} positions={POSITIONS} /></Rect>
    <Rect x={0} y={0} width={tx} height={h}><LinearGradient start={vec(0, 0)} end={vec(tx, 0)} colors={left} positions={POSITIONS} /></Rect>
    <Rect x={w - tx} y={0} width={tx} height={h}><LinearGradient start={vec(w, 0)} end={vec(w - tx, 0)} colors={right} positions={POSITIONS} /></Rect>
  </>;
}
