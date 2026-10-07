// 책 면 그림(캔버스 없이, 면 그림 좌표 0..w, 0..h). 상자 렌더러(ui/book3d)가 Skia Picture로 기록해 면 변환에 태워 그린다.
// 면 그림은 재질(색·그림)만 담는다. 빛(명암·모서리·그늘)은 면을 그릴 때 빛 모델이 계산한다(ui/SceneLight).
import { Group, Image as SkImage, Rect, Skia, type SkImage as SkImageType } from '@shopify/react-native-skia';

import { EDGE_R } from '@/domain/book-parts';
import { surfaces } from '@/ui/lighting';

// 면 윤곽: 판 모서리 반지름(EDGE_R)의 둥근 사각형(책 좌표에 붙어 있어 돌리거나 눕혀도 모서리가 둥글다)
export function bookFacePath(w: number, h: number, s: number) {
  const p = Skia.PathBuilder.Make();
  const r = Math.min(EDGE_R * s, w / 2, h / 2);
  p.addRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, w, h), r, r));
  return p.detach();
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
}: {
  w: number;
  h: number;
  s: number;
  face: string;
  image: SkImageType | null;
  motif: SkImageType | null;
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
      {/* 표지 그림 왼쪽(제본 쪽) 끝 약 1%에는 시안에서 뽑을 때 따라온 어두운 윤곽 한 줄이 있다(b04 50 vs 안쪽 82). 제본 홈·가장자리 명암은
          코드가 그리므로 그림을 1.5% 왼쪽으로 밀어 그 줄을 면 밖으로 보낸다 */}
      {image ? <SkImage image={image} x={-fw * COVER_ART_TRIM} y={0} width={fw * (1 + COVER_ART_TRIM)} height={h} fit="cover" /> : null}
      {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={h * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
      {/* The live 3D shader supplies the binding depression and edge light. */}
    </Group>
  );
}
