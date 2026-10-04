import { Group, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { RENDER } from '@/ui/perf';

// A pair of cached paths, in face coordinates. No animated noise or offscreen
// filter pass: small cloth fibres remain attached when the book moves.

export function MaterialGrain({ w, h, s, strength = 0.16 }: { w: number; h: number; s: number; strength?: number }) {
  const grain = useMemo(() => {
    const dark = Skia.PathBuilder.Make(), light = Skia.PathBuilder.Make();
    let seed = 17;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let y = 0; y < h; y += 2.2 * s) for (let x = 0; x < w; x += 2.2 * s) {
      const px = x + next() * 2.2 * s, py = y + next() * 2.2 * s;
      const size = (0.22 + next() * 0.43) * s;
      (next() > 0.5 ? dark : light).addOval(Skia.XYWHRect(px, py, size, size * 0.65));
    }
    return { dark: dark.detach(), light: light.detach() };
  }, [w, h, s]);
  if (!RENDER.grain) return null;
  return <Group>
    <Path path={grain.dark} color="#675444" opacity={strength * 0.35} />
    <Path path={grain.light} color="#FFF6E5" opacity={strength * 0.6} />
  </Group>;
}
