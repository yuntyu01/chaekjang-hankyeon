// 줄 사이로 옮기는 책(이동 캔버스)은 맨 윗줄 좌표로 내려 그린다. 줄 캔버스는 저마다 자기 판 윗면 기준 같은 눈높이로 보므로,
// 내린 책은 책 높이에 맞춘 눈(camWithDy·eyeDyAt)으로 그려야 그 줄 캔버스와 같은 자리에 같은 모양으로 보인다.
jest.mock('react-native-reanimated', () => ({ makeMutable: <T,>(value: T) => ({ value }) }));
jest.mock('react-native-worklets', () => ({ scheduleOnUI: (f: () => void) => f() }));

import { corners, fromPlaced } from '@/domain/book3';
import { boxSize } from '@/domain/box';
import { BASE_CAM, camAt, project, VIEW_PITCH_MIN } from '@/domain/camera';
import { SAMPLE_BOOKS } from '@/domain/onboarding-sample';
import { camWithDy, eyeDyAt, lowered, type SceneGeo } from '@/ui/shelf/scene';

const rows = [0, 210, 420].map((dy, i) => ({ shelfId: `s${i}`, baseline: 0, dy, space: 190 }));
const geo: SceneGeo = { rows, s: 1, originX: 0 };
const cam = camAt(VIEW_PITCH_MIN);
const book = SAMPLE_BOOKS[0];
// 줄 안 자세(판 윗면 0), 판 앞으로 빼고 들어 올린 자세(깊이에 따라 원근 차이가 커진다)
const inRow = fromPlaced({ bookId: book.id, pose: 'spine', size: boxSize(book, 'spine'), x: 100, y: 0, z: -40, angle: 0 });

it('어느 줄 위에 놓인 책이든 맨 윗줄 좌표로 내려 높이에 맞춘 눈으로 그리면, 그 줄 캔버스와 같은 화면 점이다', () => {
  for (const row of rows) {
    const top = lowered(inRow, row.dy);
    expect(eyeDyAt(geo, top)).toBeCloseTo(row.dy, 9);
    const eyeCam = camWithDy(cam, eyeDyAt(geo, top));
    for (const [a, b] of corners(inRow).map((c, i) => [c, corners(top)[i]] as const)) {
      const own = project(cam, a); // 그 줄 캔버스(제 판 윗면 기준)
      const moved = project(eyeCam, b); // 이동 캔버스(맨 윗줄 기준) — 화면에서는 줄 사이 거리 dy만큼 아래
      expect(moved.x).toBeCloseTo(own.x, 6);
      expect(moved.y).toBeCloseTo(own.y + row.dy, 6);
    }
  }
});

it('맨 윗줄 눈 그대로 그리면 아래 줄의 깊은 쪽 꼭짓점이 어긋난다(고치기 전 동작)', () => {
  const top = lowered(inRow, rows[2].dy);
  const off = Math.max(...corners(inRow).map((c, i) => Math.abs(project(cam, corners(top)[i]).y - (project(cam, c).y + rows[2].dy))));
  expect(off).toBeGreaterThan(1);
});

it('두 줄 사이에서는 눈이 판 윗면 높이 사이로 이어서 바뀐다(줄을 건너는 동안 튀지 않는다)', () => {
  let prev = -Infinity;
  for (let y = 0; y >= -420; y -= 10) {
    const dy = eyeDyAt(geo, { ...inRow, t: { ...inRow.t, y } });
    expect(dy).toBeGreaterThanOrEqual(prev - 1e-9);
    expect(dy - Math.max(prev, 0)).toBeLessThanOrEqual(10 + 1e-9);
    prev = dy;
  }
  expect(BASE_CAM.eye).toBeDefined();
});
