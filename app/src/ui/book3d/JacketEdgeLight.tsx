import { Rect, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { faceNormal, rot, type Book3, type Cam, type Vec3 } from '@/domain/book3';
import { CORNER_R, GROOVE } from '@/domain/book-parts';
import { light } from '@/ui/lighting';

type Face = 'spine' | 'cover' | 'back';
const lightLength = Math.hypot(light.dir.x, light.dir.y, light.dir.z);
const L = { x: light.dir.x / lightLength, y: light.dir.y / lightLength, z: light.dir.z / lightLength };

// One continuous normal field, not four overlapping strips. Both sides of a
// jacket join reach the same 45-degree normal. The easing has no slope at the
// flat material, so there is no second ridge where the bevel stops.
const source = Skia.RuntimeEffect.Make(`
  uniform float2 size;
  uniform float2 radius;
  uniform float3 lightLocal;
  uniform float3 viewLocal;
  uniform float4 lighting;
  uniform float3 hinge;
  uniform float strength;

  float roll(float distance, float width) {
    float t = clamp(1.0 - distance / width, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }
  float diffuse(float3 n) {
    return clamp(lighting.x + lighting.y * dot(n, lightLocal), lighting.z, lighting.w);
  }
  float reflection(float3 n) {
    float3 halfway = normalize(lightLocal + viewLocal);
    // Broad, weak reflection for a matte paper jacket, using the actual view.
    return 0.065 * pow(max(0.0, dot(n, halfway)), 14.0)
      * max(0.0, dot(n, lightLocal));
  }
  half4 main(float2 p) {
    float x = roll(size.x - p.x, radius.x) - roll(p.x, radius.x);
    float y = roll(size.y - p.y, radius.y) - roll(p.y, radius.y);
    // A shallow binding depression, lit by the same source instead of a
    // fixed dark stroke followed by a bright stroke.
    float d = ((hinge.x > 0.0 ? p.x : size.x - p.x) - hinge.y) / hinge.z;
    x += hinge.x * 0.16 * d * exp(-d * d);
    float3 n = normalize(float3(x, y, 1.0));
    float3 baseNormal = float3(0.0, 0.0, 1.0);
    float delta = (diffuse(n) - diffuse(baseNormal) + reflection(n) - reflection(baseNormal)) * strength;
    // Premultiplied alpha: an exact zero at the flat centre, without discrete stops.
    float alpha = min(0.24, abs(delta) * (delta > 0.0 ? 1.6 : 1.1));
    float3 tint = delta > 0.0 ? float3(1.0, 0.988, 0.96) : float3(0.176, 0.125, 0.094);
    return half4(tint * alpha, alpha);
  }
`);

export function JacketEdgeLight({ state, cam, f, w, h, s, strength = 1 }: {
  state: Readonly<SharedValue<Book3>>; cam: Readonly<SharedValue<Cam>>;
  f: Face; w: number; h: number; s: number; strength?: number;
}) {
  const uniforms = useDerivedValue(() => {
    const b = state.value, c = cam.value;
    const turn = (v: Vec3) => rot(b.roll, b.yaw, v, b.spin ?? 0, b.pitch ?? 0);
    const u = turn(f === 'spine' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: f === 'back' ? -1 : 1 });
    const v = turn({ x: 0, y: -1, z: 0 });
    const n = turn(faceNormal(f));
    const viewLength = Math.hypot(c.kx, c.ky, 1);
    const view = { x: c.kx / viewLength, y: c.ky / viewLength, z: -1 / viewLength };
    const dot = (a: Vec3, d: Vec3) => a.x * d.x + a.y * d.y + a.z * d.z;
    return {
      size: [w, h], radius: [Math.min(w * 0.18, CORNER_R * s), Math.min(h * 0.18, CORNER_R * s)],
      lightLocal: [dot(u, L), dot(v, L), dot(n, L)],
      viewLocal: [dot(u, view), dot(v, view), dot(n, view)],
      lighting: [light.ambient, light.diffuse, light.min, light.max], strength,
      hinge: [f === 'spine' ? 0 : f === 'cover' ? 1 : -1, GROOVE.at * s, 2.4 * s],
    };
  });
  if (!source) return null;
  return <Rect x={0} y={0} width={w} height={h}><Shader source={source} uniforms={uniforms} /></Rect>;
}
