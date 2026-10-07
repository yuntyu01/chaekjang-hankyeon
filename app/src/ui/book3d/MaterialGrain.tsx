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

// 속지 단면의 낱장 결: 낱장(약 0.1mm)은 화소보다 가늘어 하나하나는 안 보이고, 접장(종이 묶음, 약 1.3~2.6mm마다) 사이 틈과
// 낱장 가장자리의 짙고 옅음이 결로 보인다. 접장 틈은 1~2DU 간격의 가는 줄(폭 0.12~0.2DU), 낱장은 0.15~0.4DU 간격의 아주 가는 줄(폭 0.03~0.06DU,
// 어둡거나 밝게)로, 세기는 결 세기 GRAIN 안팎에서 고르지 않게 해 면을 나누는 이음선처럼 보이지 않게 한다. 결 무늬 한 장(가로 SHEET_TILE DU)을
// 세로로 늘이고 가로로 반복한다(면 그림 = 반사율, 빛이 위에 곱해진다)
const SHEET_TILE = 24;
const sheetTiles = new Map<number, SkImage | null>();
function sheetTile(s: number): SkImage | null {
  const key = Math.round(s * 1000);
  if (sheetTiles.has(key)) return sheetTiles.get(key)!;
  const T = Math.max(1, Math.round(SHEET_TILE * s));
  const k = T / SHEET_TILE;
  const surf = Skia.Surface.Make(T, 2);
  let img: SkImage | null = null;
  if (surf) {
    const canvas = surf.getCanvas();
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    let seed = 29;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const line = (x: number, w: number, color: string, alpha: number) => {
      paint.setColor(Skia.Color(color));
      paint.setAlphaf(alpha);
      canvas.drawRect(Skia.XYWHRect(x * k, 0, w * k, 2), paint);
    };
    // 낱장
    for (let x = next() * 0.3; x < SHEET_TILE; x += 0.15 + next() * 0.25) {
      if (next() > 0.35) line(x, 0.03 + next() * 0.03, '#9E8462', GRAIN * (0.3 + next() * 0.7));
      else line(x, 0.03 + next() * 0.03, '#FFF8EA', GRAIN * (0.5 + next()));
    }
    // 접장 사이 틈(가장자리 반대쪽 끝이 다음 장과 이어지도록 마지막 간격은 남김)
    for (let x = 0.5 + next() * 0.5; x < SHEET_TILE - 0.5; x += 1 + next()) line(x, 0.12 + next() * 0.08, '#8A7154', GRAIN * (1 + next() * 0.7));
    surf.flush();
    img = surf.makeImageSnapshot();
  }
  sheetTiles.set(key, img);
  return img;
}
export function PageSheets({ w, h, s }: { w: number; h: number; s: number }) {
  const tile = useMemo(() => sheetTile(s), [s]);
  if (!RENDER.grain || !tile) return null;
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader image={tile} tx="repeat" ty="clamp" fit="fill" rect={Skia.XYWHRect(0, 0, tile.width(), h)} sampling={LINEAR} />
    </Rect>
  );
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
