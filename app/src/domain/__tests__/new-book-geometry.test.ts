import { toShelfBook } from '../catalog';
import { LYING_BACK, SHELF, SHELF_DEPTH, singleFootprint } from '../geometry';
import { computeShelf, frontOutline } from '../shelf-scene';
import { corners, fromPlaced } from '../book3';
import { onWall, travelOf } from '../cast-shadow';
import type { Pose, ShelfLayout, Tilt } from '../types';
import { light, shadow } from '@/ui/theme';

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
    const bottom = Math.max(...frontOutline(f).map((p) => p.y));
    expect(bottom).toBeCloseTo(SHELF.clearHeight, 6); // 선반 공간 바닥(누운 책은 뒤에 놓일 뿐 같은 바닥)
    expect(bottom).toBeLessThan(SHELF.clearHeight + SHELF.lip - 4); // 책 앞에 나무판이 보인다(판 앞 70mm를 공통 카메라로 본 높이)
    const extent = singleFootprint(fresh, { pose, tilt });
    const o = frontOutline(f);
    expect(Math.max(...o.map((p) => p.x)) - Math.min(...o.map((p) => p.x))).toBeCloseTo(extent.width, 6); // 점유 폭 = 앞면 폭
    // 벽 그림자 = 책 모서리를 광원 방향으로 벽(z = SHELF_DEPTH)에 떨어뜨린 점: 벽 위에 있고, 빛 반대쪽(아래·오른쪽)으로 간다
    const D = travelOf(light.dir);
    for (const c of corners(fromPlaced(f.box!))) {
      const q = onWall(c, D, SHELF_DEPTH);
      expect(q.z).toBeCloseTo(SHELF_DEPTH, 9);
      expect(q.y).toBeLessThanOrEqual(c.y + 1e-9);
      expect(q.x).toBeGreaterThanOrEqual(c.x - 1e-9);
    }
  });

  it('그림자는 따뜻한 회색이고 실제 그림자·주변광 차폐가 나뉘어 있다', () => {
    expect(shadow.color).not.toBe('#000000');
    for (const c of Object.values(shadow.cast)) expect(c.opacity).toBeLessThanOrEqual(0.4);
    expect(shadow.ao.gap.max).toBeLessThanOrEqual(0.15);
  });
});
