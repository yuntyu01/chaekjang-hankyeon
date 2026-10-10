import { FilterMode, Group, Image, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import { EDGE_R } from '@/domain/book-parts';
import type { CoverArt } from '@/domain/types';

// The supplied illustration stays unmodified on disk. Each live book samples
// its printed jacket from that asset, then rotates with the same book geometry.
// A different reader title uses a clean strip of the same paper in its print
// area, leaving the original landscape and binding pixels intact.
// 시안 책은 모서리가 둥글어 오린 사각형의 네 귀퉁이에 시안 벽(크림색)이 묻어 있다. 귀퉁이 반지름만큼 안쪽을 늘여 바닥에 깔고
// 그 위에 원래 그림을 둥글게 잘라 얹어, 귀퉁이도 표지 가장자리 색이 되게 한다(두 면이 함께 보이는 돌린 책의 책등·표지 모서리에서
// 크림색 세모나 책 색 홈이 보였다: 2026-10-10 사용자)
// s: 캔버스 배율(DU → px)
export function ReferenceCover({ image, cover, w, h, s, retainTitle }: { image: SkImage; cover: CoverArt; w: number; h: number; s: number; retainTitle: boolean }) {
  const r = cover.sourceRect!;
  const sx = w / r.width, sy = h / r.height;
  const t = cover.titleRect;
  const rc = Math.min(2 * EDGE_R * s, w / 2, h / 2); // 면 위 귀퉁이 반지름(px): 시안 모서리 호(원본 약 10px)와 그 가장자리 밝은 화소보다 안쪽에서 자른다
  const ix = w / (r.width - (2 * rc) / sx), iy = h / (r.height - (2 * rc) / sy);
  const corners = Skia.PathBuilder.Make().addRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, w, h), rc, rc)).detach();
  const sampling = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };
  return <Group clip={Skia.XYWHRect(0, 0, w, h)}>
    <Image image={image} x={-(r.x + rc / sx) * ix} y={-(r.y + rc / sy) * iy} width={image.width() * ix} height={image.height() * iy} fit="fill" sampling={sampling} />
    <Group clip={corners}>
      <Image image={image} x={-r.x * sx} y={-r.y * sy} width={image.width() * sx} height={image.height() * sy} fit="fill" sampling={sampling} />
    </Group>
    {!retainTitle && t ? <Group clip={Skia.XYWHRect(t.x * sx, t.y * sy, t.width * sx, t.height * sy)}>
      <Image image={image} x={t.x * sx - (r.x + t.cleanX) * t.width * sx / 2} y={-r.y * sy} width={image.width() * t.width * sx / 2} height={image.height() * sy} fit="fill" sampling={{filter:FilterMode.Linear,mipmap:MipmapMode.Linear}} />
    </Group> : null}
  </Group>;
}
