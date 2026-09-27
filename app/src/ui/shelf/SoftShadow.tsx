import { useId } from 'react';
import { PixelRatio } from 'react-native';
import { Defs, FeGaussianBlur, Filter, G, Polygon } from 'react-native-svg';
import type { Point } from '@/domain/shelf-scene';

// Explicit filter bounds avoid cut-off edges. Android multiplies deviation by
// two, then caps the radius at 25px. Stay below that cap on low-density screens
// and limit the visual spread on high-density screens.
export function SoftShadow({ points, blur, fill, opacity = 0.15 }: { points: Point[]; blur: number; fill: string; opacity?: number }) {
  const id = `soft${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const sigma = Math.min(blur, 12, 24 / PixelRatio.get());
  const pad = sigma * 3 + 1;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return (
    <G>
      <Defs>
        <Filter id={id} filterUnits="userSpaceOnUse" x={x} y={y}
          width={Math.max(...xs) - x + pad} height={Math.max(...ys) - y + pad}>
          <FeGaussianBlur stdDeviation={sigma} />
        </Filter>
      </Defs>
      <Polygon points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill={fill} opacity={opacity} filter={`url(#${id})`} />
    </G>
  );
}
