// 장면 터치(pickAt): 지금 보이는 윤곽과 가림 순서(분리축, 모든 줄의 책 + 선반 판)로 가장 앞에 보이는 책을 고른다.
// 윗선반 판이 가린 곳은 책이 아니다. 장면은 홈 화면과 같이 짠다: 줄 칸(computeRows) → 줄 위치(기준선 px, 맨 윗줄 기준 3D 거리 dy).
// scene.ts는 UI 스레드 값(makeMutable)을 쓰지만 pickAt·sceneOrder는 .value만 읽으므로, 테스트에서는 값 상자로 바꿔 둔다.
jest.mock('react-native-reanimated', () => ({ makeMutable: <T>(value: T) => ({ value }) }));

import { computeRows, makeMetrics, toContent, type RowGeom } from '@/ui/shelf/metrics';
import { camWithDy, eyeDyAt, lowered, makeMotion, outsideRow, pickAt, rowPx, sceneOrder, type SceneGeo, type SceneMotion } from '@/ui/shelf/scene';
import { holdTrack } from '../transition';

import { corners, fromPlaced, type Book3 } from '../book3';
import { bookViewCam } from '../book-view';
import { hull, type Placed } from '../box';
import { BASE_CAM, camAt, project, toPx, type Cam, type Vec3 } from '../camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, VIEW_PITCH_MAX } from '../geometry';
import { applySwapTarget, bookXs, findSwapTarget, normalize, setDepth, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { shelfBoxCorners } from '../shelf-geom';
import { bodiesOf, computeShelf, outlineOf, pointInPoly } from '../shelf-scene';
import type { ShelfLayout } from '../types';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
// 넓은 화면(가운데 정렬 여백이 있는 배율)
const m = makeMetrics(600);
const SLOP = 3 * m.scale; // 손가락 여유 3DU
const STEEP = camAt(VIEW_PITCH_MAX);

function sceneOf(layout: ShelfLayout) {
  const rows = computeRows(layout, books, m.scale, 900, 80);
  const geo: SceneGeo = { rows: rows.map((r) => ({ shelfId: r.shelfId, baseline: r.baseline, dy: (r.baseline - rows[0].baseline) / m.scale, space: r.space })), s: m.scale, originX: m.originX };
  const list: SceneMotion[] = rows.map((r) => ({ shelfId: r.shelfId, m: makeMotion(bodiesOf(layout, books, r.shelfId)) }));
  return { rows, geo, list };
}
// 선반 공간 점 → 그 줄의 콘텐츠 px(JS 쪽 변환 toContent, 카메라 cam)
const at = (row: RowGeom, cam: Cam, v: Vec3) => toContent(m, row, project(cam, v));
const outlinePx = (row: RowGeom, cam: Cam, b: Book3) => outlineOf(cam, b).map((q) => toContent(m, row, q));
const boxOf = (layout: ShelfLayout, shelfId: string, id: string): Placed => computeShelf(layout, books, shelfId).frames.find((f) => f.bookId === id)!.box;

describe('쌓인 책과 빈 곳', () => {
  const { rows, geo, list } = sceneOf(SAMPLE_LAYOUT);
  const row = rows.find((r) => r.shelfId === 'shelf-3')!;
  const pick = (v: Vec3, slop = SLOP) => {
    const p = at(row, BASE_CAM, v);
    return pickAt(list, geo, BASE_CAM, p.x, p.y, slop);
  };

  it('쌓인 책은 위 책부터 맞고, 아래 책도 따로 선택된다', () => {
    const top = boxOf(SAMPLE_LAYOUT, 'shelf-3', 'b13');
    const bottom = boxOf(SAMPLE_LAYOUT, 'shelf-3', 'b12');
    expect(pick({ x: top.x + 20, y: top.y + top.size.h / 2, z: top.z })).toEqual({ shelfId: 'shelf-3', bookId: 'b13' });
    expect(pick({ x: bottom.x + 20, y: 8, z: bottom.z })).toEqual({ shelfId: 'shelf-3', bookId: 'b12' });
    expect(pick({ x: 340, y: 168, z: 0 })).toBeNull(); // 책 위 빈 곳
  });

  it('눕힌 표지도 실제 투영 윤곽 안에서 선택되고 바닥선은 선반과 일치한다', () => {
    const top = boxOf(SAMPLE_LAYOUT, 'shelf-3', 'b13');
    const b = fromPlaced(top);
    const cam = bookViewCam(BASE_CAM, b);
    const cover = { x: top.x + top.size.w / 2, y: top.y + top.size.h, z: top.z + top.size.d * 0.8 };
    const p = at(row, cam, cover);
    const oldOutline = hull(corners(b).map(q => at(row, BASE_CAM, q)));
    expect(pointInPoly(p, oldOutline)).toBe(true);
    expect(pickAt(list, geo, BASE_CAM, p.x, p.y, 0)).toEqual({ shelfId: 'shelf-3', bookId: 'b13' });
    const front = { x: top.x, y: top.y, z: top.z };
    expect(at(row, cam, front)).toEqual(at(row, BASE_CAM, front));
  });

  it('윤곽 밖이면 손가락 여유(slop) 안에서 가장 가까운 책', () => {
    // 마지막 책(b16) 화면 외곽 오른쪽 변에서 1.5DU 바깥
    const b = fromPlaced(boxOf(SAMPLE_LAYOUT, 'shelf-3', 'b16'));
    const poly = outlineOf(BASE_CAM, b);
    const right = Math.max(...poly.map((q) => q.x));
    const mid = (Math.min(...poly.map((q) => q.y)) + Math.max(...poly.map((q) => q.y))) / 2;
    const p = toContent(m, row, { x: right + 1.5, y: mid });
    expect(pickAt(list, geo, BASE_CAM, p.x, p.y, SLOP)).toEqual({ shelfId: 'shelf-3', bookId: 'b16' });
    expect(pickAt(list, geo, BASE_CAM, p.x, p.y, 0)).toBeNull();
  });
});

describe('가림 순서대로 가장 앞에 보이는 책', () => {
  // 3번 선반: 표지 책(b16)은 벽 쪽, 세운 책(b14)은 판 앞 끝으로 당겨 b16 표지 앞에(가로로 겹치고 깊이로 떨어져 있다)
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
  l = ok(applySwapTarget(l, books, 'b14', findSwapTarget(l, books, 'b14', bookXs(l, books).get('b16')! + 40)));
  const { rows, geo, list } = sceneOf(l);
  const row = rows.find((r) => r.shelfId === 'shelf-3')!;
  const front = boxOf(l, 'shelf-3', 'b14');
  const back = boxOf(l, 'shelf-3', 'b16');

  it.each([
    ['4°', BASE_CAM],
    ['8°', STEEP],
  ])('%s: 두 책 외곽이 겹친 곳은 앞으로 당긴 책, 가리지 않은 뒤 책 표지는 뒤 책', (_n, cam) => {
    const p = at(row, cam, { x: front.x + front.size.w / 2, y: front.size.h / 2, z: front.z });
    expect(pointInPoly(p, outlinePx(row, cam, fromPlaced(front)))).toBe(true);
    expect(pointInPoly(p, outlinePx(row, cam, fromPlaced(back)))).toBe(true);
    expect(pickAt(list, geo, cam, p.x, p.y, SLOP)).toEqual({ shelfId: 'shelf-3', bookId: 'b14' });
    const q = at(row, cam, { x: back.x + back.size.w - 15, y: back.size.h / 2, z: back.z });
    expect(pointInPoly(q, outlinePx(row, cam, fromPlaced(front)))).toBe(false);
    expect(pickAt(list, geo, cam, q.x, q.y, SLOP)).toEqual({ shelfId: 'shelf-3', bookId: 'b16' });
    const order = sceneOrder(list, geo, cam);
    expect(order.b14).toBeGreaterThan(order.b16);
  });

  it('앞뒤를 바꾸면(세운 책은 벽 쪽, 표지 책은 앞 끝) 같은 곳에서 표지 책이 잡힌다', () => {
    // 가장 앞 z가 z0이 되도록 앞뒤로만 옮긴 자세(가로·높이 그대로, 두 책은 깊이로 떨어져 있다)
    const movedTo = (b: Book3, z0: number): Book3 => ({ ...b, t: { ...b.t, z: b.t.z + z0 - Math.min(...corners(b).map((c) => c.z)) } });
    const spine = movedTo(fromPlaced(front), SHELF_DEPTH - front.size.d);
    const cover = movedTo(fromPlaced(back), -SHELF_FRONT);
    const swapped = list.map((e) => (e.shelfId === 'shelf-3' ? { shelfId: e.shelfId, m: makeMotion([spine, cover]) } : e));
    const p = at(row, BASE_CAM, { x: front.x + front.size.w / 2, y: front.size.h / 2, z: SHELF_DEPTH - front.size.d });
    expect(pointInPoly(p, outlinePx(row, BASE_CAM, spine))).toBe(true);
    expect(pointInPoly(p, outlinePx(row, BASE_CAM, cover))).toBe(true);
    expect(pickAt(swapped, geo, BASE_CAM, p.x, p.y, SLOP)).toEqual({ shelfId: 'shelf-3', bookId: 'b16' });
  });
});

describe('윗선반 판이 아래 줄 책 머리를 가린다', () => {
  // 위 줄에 작은 책, 아래 줄에 가장 키 큰 책(월든, 갈피 없음): 3D 줄 간격 = 월든 키 + 여유
  const l: ShelfLayout = {
    version: 2,
    drawer: [],
    shelves: [
      { id: 'up', order: 0 },
      { id: 'low', order: 1 },
    ],
    placements: [
      { bookId: 'b01', shelfId: 'up', order: 0, pose: 'spine', tilt: 0, pos: 150 },
      { bookId: 'b07', shelfId: 'low', order: 0, pose: 'spine', tilt: 0, pos: 150 },
    ],
  };
  const { rows, geo, list } = sceneOf(l);
  const box = boxOf(l, 'low', 'b07');
  const head = { x: box.x + box.size.w / 2, y: box.size.h, z: box.z + box.size.d * 0.95 }; // 책 머리의 벽 가까운 점

  it('아래 줄은 3D 줄 간격(판 윗면 → 윗선반 아랫면 + 판 두께)만큼 아래', () => {
    expect(geo.rows[1].dy).toBeCloseTo(rows[1].space + SHELF_THICK, 9);
  });

  it('8°: 머리가 윗선반 판에 가려지는지는 눈에서 그 점까지의 시선이 판에 걸리는지로 정해진다(같은 책 앞면은 잡힌다)', () => {
    // 원근 카메라: 아래 줄 눈은 그 줄 판에서 거리 × tan(8°) 위. 머리(벽 가까운 점)로 가는 시선이 윗선반 앞면(z = -SHELF_FRONT)을 지나는 높이
    const e = STEEP.eye!;
    const sight = head.y + ((e.y - head.y) * (head.z + SHELF_FRONT)) / (e.dist + head.z);
    const p = at(rows[1], STEEP, head);
    const upperPlank = hull(shelfBoxCorners().map((q) => at(rows[0], STEEP, q)));
    expect(pointInPoly(p, outlinePx(rows[1], STEEP, fromPlaced(box)))).toBe(true);
    // 줄 여유가 있어 시선이 판 아래로 지난다 → 머리는 판에 가리지 않고 책이 잡힌다
    expect(sight).toBeLessThan(rows[1].space);
    expect(pointInPoly(p, upperPlank)).toBe(false);
    expect(pickAt(list, geo, STEEP, p.x, p.y, 0)).toEqual({ shelfId: 'low', bookId: 'b07' });
    // 판 바로 아래보다 위(시선이 판에 걸리는 높이)의 벽 가까운 점은 위 줄이 그린 판 윤곽 안이다
    const hidden = at(rows[1], STEEP, { x: head.x, y: rows[1].space + SHELF_THICK / 2, z: head.z });
    expect(pointInPoly(hidden, upperPlank)).toBe(true);
    const face = at(rows[1], STEEP, { x: head.x, y: box.size.h / 2, z: box.z });
    expect(pickAt(list, geo, STEEP, face.x, face.y, 0)).toEqual({ shelfId: 'low', bookId: 'b07' });
    // 위 줄 책은 그대로 잡힌다
    const up = boxOf(l, 'up', 'b01');
    const u = at(rows[0], STEEP, { x: up.x + up.size.w / 2, y: up.size.h / 2, z: up.z });
    expect(pickAt(list, geo, STEEP, u.x, u.y, 0)).toEqual({ shelfId: 'up', bookId: 'b01' });
    // 가림 순서: 윗선반 판이 아래 줄 책보다 나중(앞), 책은 받치는 자기 판보다 나중
    const order = sceneOrder(list, geo, STEEP);
    expect(order['plank:up']).toBeGreaterThan(order.b07);
    expect(order.b07).toBeGreaterThan(order['plank:low']);
  });

  it('기본 4°에서는 같은 머리 점이 윗선반 판 아래로 드러나 책이 잡힌다', () => {
    const p = at(rows[1], BASE_CAM, head);
    expect(pointInPoly(p, hull(shelfBoxCorners().map((q) => at(rows[0], BASE_CAM, q))))).toBe(false);
    expect(pickAt(list, geo, BASE_CAM, p.x, p.y, 0)).toEqual({ shelfId: 'low', bookId: 'b07' });
  });
});

describe('줄 사이로 옮겨 가는 책', () => {
  it('이동 캔버스가 그린 윤곽(맨 윗줄 좌표로 내려 그 높이 눈으로)에서 잡힌다', () => {
    const { geo, list } = sceneOf(SAMPLE_LAYOUT);
    const row = geo.rows[2];
    const mo = list.find((e) => e.shelfId === row.shelfId)!.m;
    const id = Object.keys(mo.tracks.value)[0];
    const b0 = fromPlaced(boxOf(SAMPLE_LAYOUT, row.shelfId, id));
    // 선반 앞으로 다 빼서(판 앞 끝보다 앞) 윗선반 높이에 걸치게 들어 올린 자세(줄 공간 밖: 이동 캔버스가 그린다)
    const back = Math.max(...corners(b0).map((q) => q.z));
    const ys0 = corners(b0).map((q) => q.y);
    const lift = row.space - (Math.max(...ys0) - Math.min(...ys0)) / 2 - Math.min(...ys0);
    const lifted: Book3 = { ...b0, t: { x: b0.t.x, y: b0.t.y + lift, z: b0.t.z - (back + SHELF_FRONT + 5) } };
    expect(outsideRow(lifted, row.space)).toBe(true);
    mo.tracks.value = { ...mo.tracks.value, [id]: holdTrack(lifted) };
    const L = lowered(lifted, row.dy);
    const drawn = hull(corners(L).map((q) => toPx(camWithDy(STEEP, eyeDyAt(geo, L)), rowPx(geo, geo.rows[0]), q)));
    const own = hull(corners(lifted).map((q) => toPx(STEEP, rowPx(geo, row), q)));
    // 그린 윤곽 안이지만 제 줄 눈으로 잰 윤곽 밖인 점(고치기 전에는 여기서 놓쳤다)
    const xs = drawn.map((q) => q.x);
    const ys = drawn.map((q) => q.y);
    let probe: { x: number; y: number } | null = null;
    for (let i = 0; i <= 40 && !probe; i++)
      for (let j = 0; j <= 40 && !probe; j++) {
        const q = { x: Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 40, y: Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 40 };
        if (pointInPoly(q, drawn) && !pointInPoly(q, own)) probe = q;
      }
    expect(probe).not.toBeNull();
    expect(pickAt(list, geo, STEEP, probe!.x, probe!.y, 0)).toEqual({ shelfId: row.shelfId, bookId: id });
  });
});
