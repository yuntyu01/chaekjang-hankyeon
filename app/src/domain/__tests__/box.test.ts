import { boxSize, collide, frontPoly, project, silhouette, solveLean, visibleFaces, type Placed } from '../box';
import { LYING_BACK_Z, SHELF } from '../geometry';
import { SAMPLE_BOOKS } from '../onboarding-sample';
import { PLANK_BOUNDS } from '../shelf-scene';

const books = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const cam = { kx: 0.07, ky: 0.045 };

describe('책 상자', () => {
  it('자세는 같은 상자를 돌린 것(세 치수가 같다)', () => {
    const b = books.b01;
    const dims = (['spine', 'front', 'horizontal'] as const).map((p) => {
      const s = boxSize(b, p);
      return [s.w, s.h, s.d].sort((x, y) => x - y);
    });
    expect(dims[1]).toEqual(dims[0]);
    expect(dims[2]).toEqual(dims[0]);
  });

  it('공통 카메라: 모든 책이 오른쪽 옆면과 윗면만 보인다', () => {
    const p: Placed = { bookId: 'b01', pose: 'spine', size: boxSize(books.b01, 'spine'), x: 10, y: 0, z: 0, angle: 0 };
    expect(visibleFaces(cam, p).sides.map((f) => f.kind).sort()).toEqual(['right', 'top']);
    // 왼쪽으로 조금 기울어도 같은 쪽이 보인다
    expect(visibleFaces(cam, { ...p, angle: -10 }).sides.map((f) => f.kind).sort()).toEqual(['right', 'top']);
  });

  it('깊이는 화면에서 오른쪽 위로 밀린다', () => {
    const a = project(cam, { x: 0, y: 0, z: 0 });
    const b = project(cam, { x: 0, y: 0, z: 100 });
    expect(a.y).toBeCloseTo(SHELF.clearHeight);
    expect(b.x - a.x).toBeCloseTo(7);
    expect(a.y - b.y).toBeCloseTo(4.5);
  });

  it('터치 외곽은 앞면과 깊이 면을 모두 덮는다', () => {
    const p: Placed = { bookId: 'b01', pose: 'spine', size: boxSize(books.b01, 'spine'), x: 10, y: 0, z: 0, angle: 0 };
    const sil = silhouette(cam, p);
    const xs = sil.map((q) => q.x);
    expect(Math.max(...xs)).toBeCloseTo(10 + p.size.w + p.size.d * cam.kx);
  });

  it('깊이가 다르면 화면에서 겹쳐도 닿지 않는다', () => {
    const front: Placed = { bookId: 'b16', pose: 'front', size: boxSize(books.b16, 'front'), x: 0, y: 0, z: 0, angle: 0 };
    const lying: Placed = { bookId: 'b12', pose: 'horizontal', size: boxSize(books.b12, 'horizontal'), x: 20, y: 0, z: LYING_BACK_Z, angle: 0 };
    expect(front.size.d).toBeLessThan(LYING_BACK_Z);
    expect(collide(front, lying)).toBe(false);
    expect(collide({ ...front, z: LYING_BACK_Z }, lying)).toBe(true);
  });

  it('기대기: 뒤에 놓인 눕힌 책에 틈·파고듦 없이 닿는다', () => {
    const lying: Placed = { bookId: 'b12', pose: 'horizontal', size: boxSize(books.b12, 'horizontal'), x: 4, y: 0, z: LYING_BACK_Z, angle: 0 };
    const spine: Placed = { bookId: 'b06', pose: 'spine', size: boxSize(books.b06, 'spine'), x: 4 + lying.size.w + 6, y: 0, z: 0, angle: 0 };
    const r = solveLean(spine, -1, [lying], PLANK_BOUNDS);
    expect(r.supported).toBe(true);
    expect(r.on).toBe('b12');
    expect(r.angle).toBeLessThan(0);
    expect(collide({ ...spine, angle: r.angle }, lying)).toBe(false);
    expect(collide({ ...spine, angle: r.angle - 0.05 }, lying)).toBe(true); // 이분 탐색: 0.05도만 더 가도 닿는다
    // 밑면은 선반에 그대로
    expect(Math.min(...frontPoly({ ...spine, angle: r.angle }).map((q) => q.y))).toBeCloseTo(0);
  });

});
