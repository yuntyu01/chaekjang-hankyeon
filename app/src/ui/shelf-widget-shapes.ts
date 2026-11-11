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
