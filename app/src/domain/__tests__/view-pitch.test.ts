// 보기 각: 같은 3D 장면을 다르게 볼 뿐 책 자리·충돌·받침·줄 간격은 그대로. 카메라(투영)만 바뀐다.
// 보기 각은 전역 카메라를 고치지 않는다(화면 카메라만 camAt(각)). 배치·충돌은 카메라를 읽지 않는다.
import { fromPlaced } from '../book3';
import { BASE_CAM, camAt, clampPitch, kyOf } from '../camera';
import { CAMERA, VIEW_DEG_PER_DP, VIEW_PITCH_MAX, VIEW_PITCH_MIN, viewSettle } from '../geometry';
import * as engine from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import * as scene from '../shelf-scene';

const books: engine.BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const shelves = SAMPLE_LAYOUT.shelves.map((s) => s.id);

// 배치 결과(자리·3D 자세·상자·공간 판정)
function layoutOf(le: typeof engine, sc: typeof scene) {
  return {
    xs: le.bookXs(SAMPLE_LAYOUT, books),
    bodies: shelves.map((id) => sc.bodiesOf(SAMPLE_LAYOUT, books, id)),
    boxes: shelves.map((id) => sc.computeShelf(SAMPLE_LAYOUT, books, id).frames.map((f) => f.box)),
    space: le.checkSpace(SAMPLE_LAYOUT, books),
  };
}

// 기본 카메라(BASE_CAM)가 deg였다면: 모듈을 새로 불러 카메라만 바꿔 넣고 같은 배치를 계산한다
function layoutUnder(deg: number) {
  let out: { ky: number; result: ReturnType<typeof layoutOf> } | null = null;
  jest.isolateModules(() => {
    jest.doMock('../camera', () => {
      const real = jest.requireActual<typeof import('../camera')>('../camera');
      return { ...real, BASE_CAM: real.camAt(deg) };
    });
    const geometry: typeof import('../geometry') = require('../geometry');
    out = { ky: geometry.CAMERA.ky, result: layoutOf(require('../layout-engine'), require('../shelf-scene')) };
  });
  jest.dontMock('../camera');
  return out!;
}

it('4°~8° 안으로 제한, 다른 각의 카메라를 만들어도 기본 카메라(4°)는 그대로', () => {
  expect(clampPitch(1)).toBe(VIEW_PITCH_MIN);
  expect(clampPitch(20)).toBe(VIEW_PITCH_MAX);
  expect(clampPitch(5)).toBe(5);
  expect(camAt(clampPitch(20)).ky).toBeCloseTo(kyOf(VIEW_PITCH_MAX), 12);
  expect(CAMERA).toBe(BASE_CAM);
  expect(CAMERA.ky).toBeCloseTo(kyOf(VIEW_PITCH_MIN), 12);
});

it('각을 바꿔도 책의 3D 자세·자리·공간 판정은 같고, 화면 투영(터치 영역)만 달라진다', () => {
  // 기본 카메라가 8°라 해도 배치는 같다(배치·충돌·받침이 카메라를 읽지 않는다)
  const steep = layoutUnder(VIEW_PITCH_MAX);
  expect(steep.ky).toBeCloseTo(kyOf(VIEW_PITCH_MAX), 12); // 바꿔 넣은 카메라가 실제로 쓰였다
  expect(steep.result).toEqual(layoutOf(engine, scene));
  // 같은 상자를 4°·8°로 투영한 외곽(그림·터치)은 다르다
  const outlines = (deg: number) => scene.computeShelf(SAMPLE_LAYOUT, books, 'shelf-2').frames.map((f) => scene.outlineOf(camAt(deg), fromPlaced(f.box)));
  expect(outlines(VIEW_PITCH_MAX)).not.toEqual(outlines(VIEW_PITCH_MIN));
});

describe('시점 끌기를 놓았을 때 정착', () => {
  it('조금 움직였다 놓으면 원래 시점(가까운 쪽이 아니라), 아주 세게 튕기면 그 방향', () => {
    expect(viewSettle(VIEW_PITCH_MAX, 8, 7.5, 0)).toBe(VIEW_PITCH_MAX);
    expect(viewSettle(VIEW_PITCH_MIN, VIEW_PITCH_MIN, VIEW_PITCH_MIN + 0.6, 300)).toBe(VIEW_PITCH_MIN);
    expect(viewSettle(VIEW_PITCH_MIN, VIEW_PITCH_MIN, VIEW_PITCH_MIN + 0.6, 2000)).toBe(VIEW_PITCH_MAX);
  });

  it('충분히 끌었으면 가까운 쪽, 빠르게 놓으면 놓는 방향', () => {
    const mid = (VIEW_PITCH_MIN + VIEW_PITCH_MAX) / 2;
    expect(viewSettle(VIEW_PITCH_MIN, VIEW_PITCH_MIN, mid + 0.5, 0)).toBe(VIEW_PITCH_MAX);
    expect(viewSettle(VIEW_PITCH_MIN, VIEW_PITCH_MIN, mid - 0.5, 0)).toBe(VIEW_PITCH_MIN);
    expect(viewSettle(VIEW_PITCH_MIN, VIEW_PITCH_MIN, mid - 0.5, 700)).toBe(VIEW_PITCH_MAX);
    expect(viewSettle(VIEW_PITCH_MAX, VIEW_PITCH_MAX, mid + 0.9, -700)).toBe(VIEW_PITCH_MIN);
  });

  it('정착 중에 다시 잡고 조금만 움직이면 향하던 시점으로', () => {
    // 4 → 8로 정착하던 중 5.2°에서 잡아 0.3°만 움직임: 원래 목표(8°)
    expect(viewSettle(VIEW_PITCH_MAX, 5.2, 4.9, 0)).toBe(VIEW_PITCH_MAX);
  });

  it('약 170dp 끌면 기본 → 8°', () => {
    expect(VIEW_PITCH_MIN + 170 * VIEW_DEG_PER_DP).toBeCloseTo(VIEW_PITCH_MAX, 0);
  });
});
