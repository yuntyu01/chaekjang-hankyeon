// 책 면 그림(캔버스 없이, 면 그림 좌표 0..w, 0..h). 상자 렌더러(ui/book3d)가 Skia Picture로 기록해 면 변환에 태워 그린다.
// 면 그림은 재질(색·그림)만 담는다. 빛(명암·모서리·그늘)은 면을 그릴 때 빛 모델이 계산한다(ui/SceneLight).
import { Group, Image as SkImage, Rect, Skia, type SkImage as SkImageType } from '@shopify/react-native-skia';

import { EDGE_R } from '@/domain/book-parts';
import { focusedRect } from '@/domain/cover-artworks';
import { surfaces } from '@/ui/lighting';

// 면 그림 자르기: 면 사각형 그대로. 둥근 모서리는 책 전체 윤곽(BookNode silhouette, dstIn)이 바깥 모서리에만 준다.
// 면마다 둥글게 자르면 두 면이 만나는 모서리(돌린 표지 책의 책등·표지 사이 등)에 홈이 파여 깨져 보였다(2026-10-10 사용자)
export function bookFacePath(w: number, h: number, _s?: number) {
  const p = Skia.PathBuilder.Make();
  p.addRect(Skia.XYWHRect(0, 0, w, h));
  return p.detach();
}

// 시안에서 오린 그림의 둥근 귀퉁이를 자르는 모양(판 모서리 반지름)
function artCorners(w: number, h: number, s: number) {
  const p = Skia.PathBuilder.Make();
  const r = Math.min(EDGE_R * s, w / 2, h / 2);
  p.addRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, w, h), r, r));
  return p.detach();
}

function FocusedImage({ image, w, h, focusY }: { image: SkImageType; w: number; h: number; focusY: number }) {
  const r = focusedRect(image.width(), image.height(), w, h, focusY);
  return <SkImage image={image} x={r.x} y={r.y} width={r.width} height={r.height} fit="fill" />;
}

// 속지(종이 단면) 색: 장면 재질 입력(ui/lighting surfaces.paper)
export const PAGE_BASE = surfaces.paper;

// 책등 바탕: 책 색 한 가지(무광 재질)
export function SpineFaceArt({ w, h, face }: { w: number; h: number; face: string; s?: number }) {
  return <Rect x={0} y={0} width={w} height={h} color={face} />;
}

// 표지 그림 왼쪽(제본 쪽)을 면 밖으로 미는 비율(아래 CoverFaceArt 설명)
const COVER_ART_TRIM = 0.015;

// 표지 면(제목 제외). 표지 그림(달·풍경 등)은 그대로 두고, 그림이 없으면 책 색 + 모티프. 질감은 덧씌우지 않는다.
export function CoverFaceArt({
  w: fw,
  h,
  s,
  face,
  image,
  motif,
  focusY,
}: {
  w: number;
  h: number;
  s: number;
  face: string;
  image: SkImageType | null;
  motif: SkImageType | null;
  // 기본 정면 장정 그림(cover-artworks): 늘이지 않고 면을 채우되(가로세로 비 그대로), 위아래가 잘리면 위에서 이 몫만큼 자른다.
  // 그림 자체에는 테두리·제본 그늘이 없어 시안 그림처럼 왼쪽을 밀지 않는다
  focusY?: number;
}) {
  let mh = h * 0.38;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > fw * 0.5) {
    mh = (mh * fw * 0.5) / mw;
    mw = fw * 0.5;
  }
  return (
    <Group clip={bookFacePath(fw, h, s)}>
      <Rect x={0} y={0} width={fw} height={h} color={face} />
      {/* 표지 그림은 시안에서 둥근 모서리째 오려 와 네 귀퉁이에 시안 벽(크림색)이 묻어 있다. 그림만 둥글게 잘라 귀퉁이는 책 색으로
          (면은 사각형: 돌린 책의 책등·표지 모서리에서 크림색 세모가 보였다). 기본 정면 장정 그림은 귀퉁이가 깨끗해 자르지 않는다 */}
      <Group clip={focusY === undefined ? artCorners(fw, h, s) : bookFacePath(fw, h)}>
        {/* 표지 그림 왼쪽(제본 쪽) 끝 약 1%에는 시안에서 뽑을 때 따라온 어두운 윤곽 한 줄이 있다(b04 50 vs 안쪽 82). 제본 홈·가장자리 명암은
            코드가 그리므로 그림을 1.5% 왼쪽으로 밀어 그 줄을 면 밖으로 보낸다 */}
        {image && focusY !== undefined ? <FocusedImage image={image} w={fw} h={h} focusY={focusY} /> : null}
        {image && focusY === undefined ? <SkImage image={image} x={-fw * COVER_ART_TRIM} y={0} width={fw * (1 + COVER_ART_TRIM)} height={h} fit="cover" /> : null}
        {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={h * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
      </Group>
      {/* The live 3D shader supplies the binding depression and edge light. */}
    </Group>
  );
}
