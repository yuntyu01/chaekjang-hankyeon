import { toShelfBook } from '../catalog';
import { BASE_CAM, project } from '../camera';
import { SHELF_DEPTH, SHELF_FRONT, singleFootprint } from '../geometry';
import { computeShelf, frontOutline } from '../shelf-scene';
import { corners, fromPlaced } from '../book3';
import { onWall, travelOf } from '../cast-shadow';
import type { Pose, ShelfLayout, Tilt } from '../types';
import { light } from '@/ui/lighting';

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
    expect(bottom).toBeCloseTo(0, 6); // 선반 공간 바닥 = 판 윗면(누운 책은 뒤에 놓일 뿐 같은 바닥)
    // 책 앞에 나무판이 보인다: 판 윗면 앞 모서리(판 앞 70mm를 공통 카메라로 본 자리)가 책 밑면보다 화면에서 아래
    expect(bottom).toBeLessThan(project(BASE_CAM, { x: 0, y: 0, z: -SHELF_FRONT }).y - 1);
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
});
