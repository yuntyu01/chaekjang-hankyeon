import { Group, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import profiles from '@/ui/art/reference-bindings.generated.json';
import { MaterialGrain } from './MaterialGrain';

type Binding = { colors: string[]; positions: number[]; horizontal: boolean };
const customBindings = new Map<string, Binding>();
const rgb = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const hex = (channels: number[]) => '#' + channels.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
// The measured strip includes the reference camera's bright/dark rim pixels.
// Keep only its broad material colour; live 3D lighting owns the edge roll.
function materialOnly(binding: Binding): Binding {
  const samples = binding.colors.map(rgb);
  const positions = Array.from({ length: 17 }, (_, i) => i / 16);
  const colors = positions.map(p => {
    const at = Math.max(0.12, Math.min(0.88, p));
    const out = [0, 0, 0];
    let total = 0;
    binding.positions.forEach((q, i) => {
      if (q < 0.1 || q > 0.9) return;
      const weight = Math.exp(-0.5 * ((q - at) / 0.055) ** 2);
      total += weight;
      samples[i].forEach((c, j) => { out[j] += c * weight; });
    });
    return hex(out.map(c => c / total));
  });
  return { colors, positions, horizontal: binding.horizontal };
}
export function referenceBinding(color: string): Binding | undefined {
  const key=color.toUpperCase();
  if (customBindings.has(key)) return customBindings.get(key);
  const original=(profiles as Record<string, Binding>)[key];
  if (original) {
    const material = materialOnly(original);
    customBindings.set(key, material);
    return material;
  }
  if (!/^#[0-9A-F]{6}$/.test(key)) return undefined;
  // Preserve a reader's chosen centre colour while borrowing the binding roll.
  const target=rgb(key);
  let closest: Binding | undefined, best=Infinity, base: number[]=[];
  for (const candidate of Object.values(profiles)) {
    const center=rgb(candidate.colors[Math.floor(candidate.colors.length/2)]);
    const distance=center.reduce((sum,c,i)=>sum+(c-target[i])**2,0);
    if (distance<best) { best=distance;closest=candidate;base=center; }
  }
  const binding={horizontal:closest!.horizontal,positions:closest!.positions,colors:closest!.colors.map(hex=>'#'+rgb(hex).map((c,i)=>Math.max(0,Math.min(255,Math.round(target[i]+c-base[i]))).toString(16).padStart(2,'0')).join(''))};
  const material = materialOnly(binding);
  customBindings.set(key,material);
  return material;
}

export function bindingSurfaceTone(color: string) {
  const material = referenceBinding(color);
  return material?.colors[Math.floor(material.colors.length / 2)] ?? color;
}

// Broad paper colour and grain only. Pose-dependent light is drawn live.
export function ReferenceBinding({ material, w, h, s }: { material: Binding; w: number; h: number; s: number }) {
  return <Group>
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={vec(0,0)} end={vec(w,0)} colors={material.colors} positions={material.positions} />
    </Rect>
    <MaterialGrain w={w} h={h} s={s} />
  </Group>;
}
