import { Group, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import profiles from '@/ui/art/reference-bindings.generated.json';
import { litTone, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { MaterialGrain } from './MaterialGrain';

type Binding = { colors: string[]; positions: number[]; horizontal: boolean };
const customBindings = new Map<string, Binding>();
const rgb = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function referenceBinding(color: string): Binding | undefined {
  const key=color.toUpperCase();
  const original=(profiles as Record<string, Binding>)[key];
  if (original) return original;
  if (!/^#[0-9A-F]{6}$/.test(key)) return undefined;
  if (customBindings.has(key)) return customBindings.get(key);
  // Preserve a reader's chosen centre colour while borrowing the binding roll.
  const target=rgb(key);
  let closest: Binding | undefined, best=Infinity, base: number[]=[];
  for (const candidate of Object.values(profiles)) {
    const center=rgb(candidate.colors[Math.floor(candidate.colors.length/2)]);
    const distance=center.reduce((sum,c,i)=>sum+(c-target[i])**2,0);
    if (distance<best) { best=distance;closest=candidate;base=center; }
  }
  const binding={horizontal:closest!.horizontal,positions:closest!.positions,colors:closest!.colors.map(hex=>'#'+rgb(hex).map((c,i)=>Math.max(0,Math.min(255,Math.round(target[i]+c-base[i]))).toString(16).padStart(2,'0')).join(''))};
  customBindings.set(key,binding);
  return binding;
}

// A measured blank strip preserves the reference's matte center and narrow
// binding edge. The material turns with its book, including a lying spine.
export function ReferenceBinding({ material, w, h, s, tone }: { material: Binding; w: number; h: number; s: number; tone: string }) {
  return <Group>
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={vec(0,0)} end={vec(w,0)} colors={material.colors} positions={material.positions} />
    </Rect>
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={vec(0,0)} end={vec(w * 0.35,h)}
        colors={[withAlpha(litTone(tone),0.10), withAlpha(tone,0), withAlpha(scaleColor(tone,0.7),0.075)]}
        positions={[0,0.42,1]} />
    </Rect>
    <MaterialGrain w={w} h={h} s={s} />
  </Group>;
}
