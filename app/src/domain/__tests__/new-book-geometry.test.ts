import { toShelfBook } from '../catalog';
import { BASE_CAM, project } from '../camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, singleFootprint } from '../geometry';
import { computeShelf, frontOutline } from '../shelf-scene';
import { corners, fromPlaced } from '../book3';
import { onWall, travelOf } from '../cast-shadow';
import type { Pose, ShelfLayout, Tilt } from '../types';
import { light, shadow } from '@/ui/lighting';

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

  it('넓은 그림자는 옅고 좁은 책 사이 차폐는 별도의 따뜻한 색을 쓴다', () => {
    expect(shadow.color).not.toBe('#000000');
    // 책 그림자(벽·선반 윗면 한 모델) 한 층은 옅게(층이 겹쳐 가까운 곳만 진해진다). 문턱은 멀수록 길다
    const b = shadow.cast.book;
    for (const o of b.opacity) expect(o).toBeLessThanOrEqual(0.2);
    for (let k = 1; k < b.layers.length; k++) expect(b.layers[k]).toBeGreaterThan(b.layers[k - 1]);
    // 선반 → 벽: 빛 길이 층은 멀수록 길다. 층은 서로 포개지므로(먼 층이 가까운 부분도 덮는다) 판 바로 아래가 가장 진하다.
    // 세기는 시안 판 아래 수치(벽 대비 +4px 약 45%, +44px 약 19%, 따뜻한 갈색)에 맞춘다: 층 하나는 0.25 이하, 모두 겹친 곳은 0.6 이하
    const w = shadow.cast.plank;
    for (let k = 1; k < w.layers.length; k++) expect(w.layers[k]).toBeGreaterThan(w.layers[k - 1]);
    for (const o of w.opacity) expect(o).toBeLessThanOrEqual(0.25);
    expect(w.opacity.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0.6);
    void travelOf;
    void SHELF_THICK;
    // 시안의 짙은 틈은 넓은 벽 그림자와 다르다. 불투명도 범위를 지키고
    // 좁은 간격에서만 적용해 떨어진 책 사이 전체를 어둡게 만들지 않는다.
    expect(shadow.ao.gap.max).toBeGreaterThan(0);
    expect(shadow.ao.gap.max).toBeLessThanOrEqual(1);
    expect(shadow.ao.gap.color).not.toBe('#000000');
    expect(shadow.ao.gap.fadeAt).toBeLessThanOrEqual(12);
  });
});
