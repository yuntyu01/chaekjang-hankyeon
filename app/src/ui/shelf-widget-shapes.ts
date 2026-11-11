// 투명 위젯(2026-11-11 사용자 '선반이랑 책만 보이고 나머지 뒷배경은 투명'): 홈 사진에서 책과 선반 판만 오려 내는 데 쓰는 모양.
// 책은 지금 자세의 상자를 카메라로 투영한 외곽(접근성 칸·고른 책 윤곽과 같은 outlineOf), 갈피는 책 머리 위 띠(띠 안의 색 있는 화소만),
// 선반 판은 판 윗면 뒤끝부터 판 아래 끝까지 가로 띠(띠 안의 나무 색 화소만, 네이티브가 고른다). 모두 책장 보기 기준 dp.
import { fromPlaced } from '@/domain/book3';
import { camAt, kyOf } from '@/domain/camera';
import { SHELF, SHELF_DEPTH } from '@/domain/geometry';
import { hasRibbon, ribbonDesign } from '@/domain/ribbon-design';
import { outlineOf, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import type { RowGeom, ShelfMetrics } from '@/ui/shelf/metrics';

// books: 책마다 외곽 [x0,y0,x1,y1,…], ribbons: 갈피 띠 [x,y,w,h], boards: 판 띠 [y0,y1]
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
    // 판 윗면 뒤끝(깊이만큼 위로 투영) 조금 위부터 줄 아래 끝(판 앞면 아래)까지
    out.boards.push([y0 - (SHELF_DEPTH * kyOf(pitch) + 6) * s, top + row.top + row.height + 1]);
  }
  return out;
}
