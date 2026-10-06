// 가림 순서: 분리축으로 앞뒤를 정하고 한 줄을 위상 정렬한다.
import { drawOrder, frontOf, type Book3 } from '../book3';
import { CAMERA } from '../geometry';
import { setDepth, type BookMap, normalize, bookXs, applySwapTarget, findSwapTarget, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf } from '../shelf-scene';
import { depthKey } from '../book3';
import { SHELF_DEPTH, SHELF_FRONT } from '../geometry';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const at = (bs: Book3[], id: string) => bs.find((b) => b.id === id)!;
const orderOf = (bs: Book3[]) => {
  const r = drawOrder(bs, CAMERA, depthKey);
  return Object.fromEntries(bs.map((b, i) => [b.id, r[i]]));
};

it('나란히 선 책: 오른쪽 책이 나중(오른쪽 옆면이 보이는 카메라라 왼쪽 책 옆면을 덮는다)', () => {
  const bs = bodiesOf(SAMPLE_LAYOUT, books, 'shelf-1');
  expect(frontOf(at(bs, 'b01'), at(bs, 'b02'), CAMERA)).toBe(1);
  const o = orderOf(bs);
  expect(o.b02).toBeGreaterThan(o.b01);
});

it('쌓기: 위 책이 나중', () => {
  const bs = bodiesOf(SAMPLE_LAYOUT, books, 'shelf-3');
  expect(frontOf(at(bs, 'b12'), at(bs, 'b13'), CAMERA)).toBe(1);
});

it('뒤쪽 정면 책 앞에 세운 책을 겹쳐 두면 세운 책이 나중(표지 일부를 가린다), 앞뒤를 바꾸면 순서도 바뀐다', () => {
  const keep = ['b16', 'b14'];
  let l = normalize({
    ...SAMPLE_LAYOUT,
    placements: SAMPLE_LAYOUT.placements
      .filter((p) => p.shelfId !== 'shelf-3' || keep.includes(p.bookId))
      .map((p) => (p.bookId === 'b16' ? { ...p, pos: 150 } : p.bookId === 'b14' ? { ...p, pos: 40 } : p)),
    drawer: [],
  });
  l = ok(setDepth(l, books, 'b16', SHELF_DEPTH));
  l = ok(setDepth(l, books, 'b14', -SHELF_FRONT));
  const x16 = bookXs(l, books).get('b16')!;
  l = ok(applySwapTarget(l, books, 'b14', findSwapTarget(l, books, 'b14', x16 + 40)));
  const bs = bodiesOf(l, books, 'shelf-3');
  expect(frontOf(at(bs, 'b16'), at(bs, 'b14'), CAMERA)).toBe(1);
  const o = orderOf(bs);
  expect(o.b14).toBeGreaterThan(o.b16);
  // 세운 책을 표지 책 왼쪽 앞에 비스듬히 걸쳐도(오른쪽 옆면이 표지 앞에) 같은 결론
  const tilted = bs.map((b) => (b.id === 'b14' ? { ...b, roll: 7 } : b));
  expect(frontOf(at(tilted, 'b16'), at(tilted, 'b14'), CAMERA)).toBe(1);
});

it('깊이 키만으로는 틀리는 경우: 긴 눕힌 책이 앞쪽 좁은 책보다 앞면이 앞에 있어도 옆으로 떨어져 있으면 순서는 옆 관계로', () => {
  // 눕힌 책(앞면 z=-20)과 오른쪽의 세운 책(z=0): 깊이 키는 눕힌 책을 나중에 두지만, 실제로는 x로 나뉘어 세운 책이 오른쪽(나중)
  // 줄 왼쪽(눈보다 왼쪽)이라 눕힌 책의 오른쪽 옆면이 보이고, 그 옆면이 세운 책과 화면에서 겹친다
  const lying: Book3 = { id: 'L', dims: { T: 30, H: 150, W: 100 }, roll: -90, yaw: 0, spin: 0, t: { x: 100, y: 0, z: -20 } };
  const stand: Book3 = { id: 'S', dims: { T: 25, H: 140, W: 100 }, roll: 0, yaw: 0, spin: 0, t: { x: 101, y: 0, z: 0 } }; // 3D로는 1DU 떨어져 있고 화면에서는 겹친다
  expect(frontOf(lying, stand, CAMERA)).toBe(1);
  expect(depthKey(lying)).toBeGreaterThan(depthKey(stand));
  const o = orderOf([lying, stand]);
  expect(o.S).toBeGreaterThan(o.L);
});
