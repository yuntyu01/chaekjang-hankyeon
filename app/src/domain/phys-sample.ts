// 측정 번들 전용 물리 점검 책장(?demoboot=phys): 옆 벽에 기댄 책, 돌려 벽에 기댄 표지 책, 대각선으로 누운 책, 쌓은 책을 실제 책으로 한 화면에 둔다.
// 저장하지 않는다(placementStore.setDemo). 자세는 사용자가 하는 조작과 같은 계산(layout-engine)으로 만든다
import { frontRelease, frontSpin, frontStateOf, frontTilt, moveBook, setPose, setSpin, setTilt, type BookMap } from './layout-engine';
import { realBookOf } from './real-sample';
import { withLeans } from './shelf-scene';
import type { Book, BookPlacement, ShelfLayout } from './types';

const IDS = ['b10', 'b19', 'b07', 'b04', 'b12', 'b05', 'b13', 'b15', 'b01', 'b02', 'b03', 'b16'];
function build(): [Book[], ShelfLayout] {
  const books: Book[] = IDS.map(realBookOf);
  const map: BookMap = Object.fromEntries(books.map((b) => [b.id, b]));
  const sp = (bookId: string, shelfId: string, order: number, pos: number): BookPlacement => ({ bookId, shelfId, order, pose: 'spine', tilt: 0, pos });
  let l: ShelfLayout = {
    version: 2,
    shelves: [{ id: 'p0', order: 0 }, { id: 'p1', order: 1 }, { id: 'p2', order: 2 }, { id: 'p3', order: 3 }],
    drawer: [],
    placements: [
      sp('b10', 'p0', 0, 10), sp('b07', 'p0', 1, 120), sp('b19', 'p0', 2, 330),
      sp('b12', 'p1', 0, 40), sp('b13', 'p1', 1, 212), sp('b15', 'p1', 2, 330),
      sp('b04', 'p2', 0, 60), sp('b05', 'p2', 1, 200),
      sp('b02', 'p3', 0, 20), sp('b01', 'p3', 1, 110), sp('b03', 'p3', 2, 220), sp('b16', 'p3', 3, 320),
    ],
  };
  const need = <T extends { ok: true; layout: ShelfLayout } | { ok: false }>(r: T) => (r.ok ? withLeans(r.layout, map) : l);
  const leanBack = (id: string, spin: number) => {
    l = need(setPose(l, map, id, 'front'));
    let f = frontStateOf(l, map, id);
    const s = f && frontSpin(l, map, id, f.state, f.qx, spin);
    if (s) l = s.layout;
    f = frontStateOf(l, map, id);
    const t = f && frontTilt(l, map, id, f.state, f.qx, 25);
    if (t) {
      const f2 = frontStateOf(t.layout, map, id)!;
      l = frontRelease(t.layout, map, id, f2.state, f2.qx) ?? t.layout;
    }
  };
  // 첫 줄: 가운데 표지 책은 돌려 뒷벽에 모서리로 기대고, 양쪽 끝은 옆 벽에 기댄다
  leanBack('b07', 30);
  l = need(setTilt(l, map, 'b10', -7));
  l = need(setTilt(l, map, 'b19', 7));
  // 둘째 줄: 돌려 눕힌 책(모서리가 뒷벽에)과 쌓은 책
  l = need(setPose(l, map, 'b13', 'horizontal'));
  l = need(setPose(l, map, 'b15', 'horizontal'));
  l = need(moveBook(l, map, 'b15', { kind: 'stack', shelfId: 'p1', itemKey: 'b13' }));
  l = need(setPose(l, map, 'b12', 'horizontal'));
  l = need(setSpin(l, map, 'b12', 30));
  // 셋째 줄: 크게 돌려 기댄 표지 책, 돌려 눕힌 책
  leanBack('b04', -45);
  l = need(setPose(l, map, 'b05', 'horizontal'));
  l = need(setSpin(l, map, 'b05', -25));
  // 넷째 줄: 벽까지 이어진 기대기 사슬(벽 ← b02 ← b01, b03 → b16 → 벽)
  l = need(setTilt(l, map, 'b02', -7));
  l = need(setTilt(l, map, 'b01', -7));
  l = need(setTilt(l, map, 'b16', 7));
  l = need(setTilt(l, map, 'b03', 7));
  return [books, withLeans(l, map)];
}
let built: [Book[], ShelfLayout] | null = null;
export function physDemo(): [Book[], ShelfLayout] {
  return (built ??= build());
}
