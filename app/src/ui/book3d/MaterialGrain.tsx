import { FilterMode, ImageShader, MipmapMode, Rect, Skia, type SkImage } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { RENDER } from '@/ui/perf';

// 종이·천 재질의 결: 면 좌표에 붙은 잔 섬유 점(어두운 점·밝은 점). 재질 입력 하나, 모든 면에 같은 세기.
// 결 무늬 한 장(TILE × TILE 칸, 칸 간격 CELL DU, 가장자리를 넘는 점은 반대쪽에도 그려 이음새 없이 반복)을 배율마다 한 번 그림으로 그려 두고
// 면마다 그 그림을 반복해 붙인다(면이 움직여도 프레임마다 수천 개의 점을 다시 그리지 않는다)
export const GRAIN = 0.06;
const CELL = 2.2;
const TILE = 24;
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

const tiles = new Map<number, SkImage | null>();
function grainTile(s: number): SkImage | null {
  const key = Math.round(s * 1000);
  if (tiles.has(key)) return tiles.get(key)!;
  const T = Math.max(1, Math.round(TILE * CELL * s));
  const step = T / TILE;
  const surf = Skia.Surface.Make(T, T);
  let img: SkImage | null = null;
  if (surf) {
    const dark = Skia.PathBuilder.Make();
    const light = Skia.PathBuilder.Make();
    let seed = 17;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let j = 0; j < TILE; j++)
      for (let i = 0; i < TILE; i++) {
        const x = (i + next()) * step;
        const y = (j + next()) * step;
        const size = (0.22 + next() * 0.43) * s;
        const p = next() > 0.5 ? dark : light;
        for (const dx of x + size > T ? [0, -T] : [0])
          for (const dy of y + size * 0.65 > T ? [0, -T] : [0]) p.addOval(Skia.XYWHRect(x + dx, y + dy, size, size * 0.65));
      }
    const canvas = surf.getCanvas();
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color('#675444'));
    paint.setAlphaf(GRAIN * 0.35);
    canvas.drawPath(dark.detach(), paint);
    paint.setColor(Skia.Color('#FFF6E5'));
    paint.setAlphaf(GRAIN * 0.6);
    canvas.drawPath(light.detach(), paint);
    surf.flush();
    img = surf.makeImageSnapshot();
  }
  tiles.set(key, img);
  return img;
}

export function MaterialGrain({ w, h, s }: { w: number; h: number; s: number }) {
  const tile = useMemo(() => grainTile(s), [s]);
  if (!RENDER.grain || !tile) return null;
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader image={tile} tx="repeat" ty="repeat" sampling={LINEAR} />
    </Rect>
  );
}
