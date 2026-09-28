import { toShelfBook } from '../catalog';
import { LYING_BACK, SHELF, singleFootprint } from '../geometry';
import { computeShelf, frontOutline } from '../shelf-scene';
import { castShape } from '../shadow-shape';
import type { Pose, ShelfLayout, Tilt } from '../types';
import { shadow } from '@/ui/theme';

const shelfShadow = shadow.shelfWall;

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
    const far = shadow.bookWall;
    const projected = castShape(f.poly, far.dx * 6, far.dy * 6);
    expect(Math.max(...projected.map((p) => p.y)) - bottom).toBeGreaterThan(30);
    expect(Math.max(...projected.map((p) => p.x))).toBeGreaterThan(Math.max(...f.poly.map((p) => p.x)) + 30);
  });

  it('선반→벽 그림자는 넓고 옅다(따뜻한 회색)', () => {
    expect(shelfShadow.blur).toBeGreaterThanOrEqual(16);
    expect(shelfShadow.opacity).toBeLessThanOrEqual(0.2);
    expect(shadow.color).not.toBe('#000000');
  });
});
