// 위젯 칸(2026-11-11 사용자 '1단 2단 3단 4단'): 책장 첫 네 칸을 칸마다 따로 떠 둔다(4단째는 첫 화면에서 하단바에 가려, 스크롤해 다 보일 때 뜬다).
// widgetRows: 칸마다 콘텐츠 dp 범위, 그림이 바뀌었는지 가릴 열쇠(책 자리·모양·보기 각·폭), 오려 낼 모양(꺼낼 때만 계산).
// 투명 위젯(2026-11-11 사용자 '선반이랑 책만 보이고 나머지 뒷배경은 투명'): 홈 사진에서 책과 선반 판만 오려 내는 데 쓰는 모양.
// 책은 지금 자세의 상자를 카메라로 투영한 외곽(접근성 칸·고른 책 윤곽과 같은 outlineOf), 갈피는 책 머리 위 띠(띠 안의 색 있는 화소만),
// 선반 판은 판 그리기와 같은 윤곽(plankShape: 윗면·앞면 껍질, 끝 둥근 모서리). 모두 책장 보기 기준 dp.
// 판을 나무 색 화소로 고르면 윗면·앞면 사이 어두운 모서리 줄이 빠져 판이 위아래로 갈라져 보였다(2026-11-11 사용자 '선반 갈라지는 거')
import { fromPlaced } from '@/domain/book3';
import { camAt } from '@/domain/camera';
import { SHELF } from '@/domain/geometry';
import { hasRibbon, ribbonDesign } from '@/domain/ribbon-design';
import { outlineOf, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import type { RowGeom, ShelfMetrics } from '@/ui/shelf/metrics';
import { plankShape } from '@/ui/shelf/ShelfPlank';

// books: 책마다 외곽 [x0,y0,x1,y1,…], ribbons: 갈피 띠 [x,y,w,h], boards: 판마다 외곽 [x0,y0,x1,y1,…]
export type CutShapes = { books: number[][]; ribbons: number[][]; boards: number[][] };

export function shelfCutShapes(rows: RowGeom[], frames: Map<string, BookFrame[]>, books: Record<string, Book>, m: ShelfMetrics, pitch: number, top: number): CutShapes {
  const cam = camAt(pitch);
  const s = m.scale;
  const x0 = m.originX + SHELF.sideMargin * s;
  const out: CutShapes = { books: [], ribbons: [], boards: [] };
  for (const row of rows) {
    const y0 = top + row.baseline;
    for (const f of frames.get(row.shelfId) ?? []) {
      const poly = outlineOf(cam, fromPlaced(f.box));
      if (poly.length < 3) continue;
      const flat: number[] = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (const p of poly) {
        const x = x0 + p.x * s;
        const y = y0 + p.y * s;
        flat.push(x, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
      }
      out.books.push(flat);
      const book = books[f.bookId];
      if (book && hasRibbon(book)) {
        const up = (ribbonDesign(book).out + 3) * s;
        out.ribbons.push([minX, minY - up, maxX - minX, up + 2 * s]);
      }
    }
    out.boards.push(plankShape(cam, { s, tx: x0, ty: y0 }).outline.flatMap((p) => [p.x, p.y]));
  }
  return out;
}

// 위젯에 넘길 칸(콘텐츠 dp, 머리글 포함 좌표). 첫 칸은 머리글 아래(구멍 위 끝 벽)부터.
// rel: 책장 내용(머리글 아래) 기준 칸 위 끝(dp): 네이티브가 칸을 이어 붙일 자리(머리글 높이가 실행마다 조금 달라도 같게)
export type WidgetRow = { key: string; top: number; bottom: number; rel: number; cut: () => CutShapes };
export const WIDGET_ROWS = 4;

// 짧은 해시(열쇠 길이를 줄인다)
function hash(str: string) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 칸 그림이 같은지 가리는 열쇠: 칸 크기·자리(머리글 아래 기준), 보기 각·폭, 책 자리와 그림에 영향을 주는 책 값만.
// 실행마다 달라질 수 있는 값(머리글 높이, 그림 캐시 주소 같은 책의 나머지 값)은 넣지 않는다: 넣으면 화면 밖 칸(4단째)이 다시 켤 때마다 버려진다(2026-11-12)
function bookSig(b: Book | undefined) {
  if (!b) return null;
  return [b.title, b.themeColor, b.heightClass, b.thicknessClass, b.coverAspectRatio, b.quotes ?? 0, b.physical ?? null, b.dims ?? null, b.art ?? null];
}

export function widgetRows(rows: RowGeom[], frames: Map<string, BookFrame[]>, books: Record<string, Book>, m: ShelfMetrics, pitch: number, top: number, width: number): WidgetRow[] {
  return rows.slice(0, WIDGET_ROWS).map((row, i) => {
    const fs = frames.get(row.shelfId) ?? [];
    const sig = JSON.stringify([i, Math.round(row.top), Math.round(row.height), pitch, Math.round(width), Math.round(m.scale * 1000), Math.round(m.originX), fs.map((f) => [f.bookId, f.box]), fs.map((f) => bookSig(books[f.bookId]))]);
    return {
      key: hash(sig),
      top: i === 0 ? top : top + row.top,
      bottom: top + row.top + row.height,
      rel: i === 0 ? 0 : row.top,
      cut: () => shelfCutShapes([row], frames, books, m, pitch, top),
    };
  });
}
