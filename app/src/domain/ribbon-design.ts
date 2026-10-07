import type { Book } from './types';

export function hasRibbon(book: Book): boolean {
  return book.art.ribbonVisible ?? ((book.quotes ?? 0) > 0);
}

// 갈피(종이 탭) 모양: 갈피가 하나면 한 장, 둘 이상이면 두 장이 머리 위로 나란히 나온다(2026-10-07 사용자 참고 사진).
// 장마다 폭·나온 길이(DU). 두 장은 길이가 달라 겹쳐 보이지 않게 조금 떨어진다(GAP). 순서는 책마다 정해진다(seed).
export type Tab = { x: number; width: number; out: number };
// 갈피가 머리에서 나오는 자리(책 좌표): 두께 가운데쯤(0.55T), 책등에서 깊이 RIBBON_Z·W 뒤. 2026-10-07 사용자 요청으로 앞으로(0.8 → 0.3)
export const RIBBON_Z = 0.3;
export type RibbonDesign = { width: number; out: number; x: number; y: number; tabs: Tab[] };
const GAP = 1.2;
function seedOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
// 크기는 참고 사진(갈피 폭 ≈ 화면의 2.7%, 머리 위로 ≈ 4.5%)에서 잰 값
export function ribbonDesign(book: Book): RibbonDesign {
  const two = (book.art.ribbonCount ?? book.quotes ?? 1) >= 2;
  if (!two) {
    const t = { x: 0, width: 9.2, out: 14 };
    return { width: t.width, out: t.out, x: 0, y: 0, tabs: [t] };
  }
  const h = seedOf(book.id);
  const a = { width: 8.4, out: 15 };
  const b = { width: 7.2, out: 11.5 };
  // 길쭉한 장이 왼쪽인지 오른쪽인지는 책마다
  const [l, r] = h % 2 ? [a, b] : [b, a];
  const total = l.width + GAP + r.width;
  const tabs = [
    { x: -total / 2 + l.width / 2, width: l.width, out: l.out },
    { x: total / 2 - r.width / 2, width: r.width, out: r.out },
  ];
  return { width: total, out: Math.max(a.out, b.out), x: 0, y: 0, tabs };
}
