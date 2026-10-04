import { FilterMode, Group, Image, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import type { CoverArt } from '@/domain/types';

// The supplied illustration stays unmodified on disk. Each live book samples
// its printed jacket from that asset, then rotates with the same book geometry.
// A different reader title uses a clean strip of the same paper in its print
// area, leaving the original landscape and binding pixels intact.
export function ReferenceCover({ image, cover, w, h, retainTitle }: { image: SkImage; cover: CoverArt; w: number; h: number; retainTitle: boolean }) {
  const r = cover.sourceRect!;
  const sx = w / r.width, sy = h / r.height;
  const t = cover.titleRect;
  return <Group clip={Skia.XYWHRect(0, 0, w, h)}>
    <Image image={image} x={-r.x * sx} y={-r.y * sy} width={image.width() * sx} height={image.height() * sy} fit="fill" sampling={{filter:FilterMode.Linear,mipmap:MipmapMode.Linear}} />
    {!retainTitle && t ? <Group clip={Skia.XYWHRect(t.x * sx, t.y * sy, t.width * sx, t.height * sy)}>
      <Image image={image} x={t.x * sx - (r.x + t.cleanX) * t.width * sx / 2} y={-r.y * sy} width={image.width() * t.width * sx / 2} height={image.height() * sy} fit="fill" sampling={{filter:FilterMode.Linear,mipmap:MipmapMode.Linear}} />
    </Group> : null}
  </Group>;
}
