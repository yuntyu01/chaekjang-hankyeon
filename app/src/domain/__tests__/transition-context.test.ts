import { pivotLocal, rot, sub3, toWorld, type Book3 } from '../book3';
import { bookAt, build, candidates } from '../transition';

// 재계획은 이전 목표 배열을 그대로 쓸 수 있지만, 출발점은 매번 실제 보이는 자세다.
// 일부 좌표로 만든 전역 캐시 키 때문에 이전 계획의 출발 높이가 재사용되면 첫 프레임이 튄다.
it('같은 목표로 다시 계획해도 현재 출발 높이에서 이어진다', () => {
  const from: Book3 = { id: 'book', dims: { T: 10, H: 100, W: 50 }, roll: 0, yaw: 0, t: { x: 0, y: 0, z: 0 } };
  const foot = pivotLocal(from.dims, 1);
  const to: Book3 = { ...from, roll: 60, t: sub3(toWorld(from, foot), rot(60, 0, foot)) };
  const targets = [to];
  const candidate = candidates(false, false)[0];
  const first = build([from], targets, candidate)[0];
  expect(bookAt(first, 0).t.y).toBeCloseTo(0, 8);

  const current = { ...from, t: { ...from.t, y: 0.25 } };
  const replanned = build([current], targets, candidate)[0];
  expect(bookAt(replanned, 0).t.y).toBeCloseTo(current.t.y, 8);
  expect(bookAt(replanned, 1).t.y).toBeCloseTo(to.t.y, 8);
  // 다음 후보 계산이 이미 만든 계획을 바꾸지 않는다.
  expect(bookAt(first, 0).t.y).toBeCloseTo(0, 8);
});
