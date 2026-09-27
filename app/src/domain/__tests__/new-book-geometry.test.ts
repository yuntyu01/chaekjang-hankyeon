import { toShelfBook } from '../catalog';
import { SHELF, singleFootprint } from '../geometry';
import { computeShelf } from '../shelf-scene';
import { castShape } from '../shadow-shape';
import type { Pose, ShelfLayout, Tilt } from '../types';
import { shadow, shelfShadow } from '@/ui/theme';

const fresh = toShelfBook({
  isbn13: '9780000000001', title: '새로 추가한 책', authors: ['저자'],
  themeColor: '#416A61', heightClass: 'tall', thicknessClass: 'thick',
});

describe('예시 이미지가 없는 새 책의 공통 배치와 그림자', () => {
  it.each([
    ['spine', -7], ['spine', 0], ['spine', 7], ['front', 0], ['horizontal', 0],
  ] as [Pose, Tilt][])('%s / %i도: 책은 선반 안에 닿고 그림자는 빛 반대쪽으로 뻗는다', (pose, tilt) => {
    const layout: ShelfLayout = { version: 2, shelves: [{ id: 's', order: 0 }], drawer: [],
      placements: [{ bookId: fresh.id, shelfId: 's', order: 0, pose, tilt }] };
    const f = computeShelf(layout, { [fresh.id]: fresh }, 's').frames[0];
    const bottom = Math.max(...f.poly.map((p) => p.y));
    expect(bottom).toBeCloseTo(SHELF.clearHeight, 6);
    expect(bottom).toBeLessThan(SHELF.clearHeight + SHELF.lip - 6); // 책 앞에 나무판이 보인다
    const extent = singleFootprint(fresh, { pose, tilt });
    expect(Math.max(...f.poly.map((p) => p.x)) - Math.min(...f.poly.map((p) => p.x))).toBeCloseTo(extent.width, 6);
    const far = shadow.cast.layers.at(-1)!;
    const projected = castShape(f.poly, far.dx, far.dy);
    expect(Math.max(...projected.map((p) => p.y)) - bottom).toBeGreaterThan(30);
    expect(Math.max(...projected.map((p) => p.x))).toBeGreaterThan(Math.max(...f.poly.map((p) => p.x)) + 30);
  });

  it('선반 그림자는 50DU 이후에도 이어지고 끝은 투명해진다', () => {
    expect(shelfShadow.tail.fade.find(([distance]) => distance >= 50)![1]).toBeGreaterThan(0.04);
    expect(shelfShadow.tail.fade.at(-1)).toEqual([shelfShadow.tail.length, 0]);
    expect(shelfShadow.tail.length).toBeGreaterThanOrEqual(80);
  });
});
