// 보기 각: 같은 3D 장면을 다르게 볼 뿐 책 자리·충돌·받침은 그대로. 공통 카메라와 줄 높이만 바뀐다.
import { CAMERA, kyOf, setViewPitch, VIEW_DEG_PER_DP, VIEW_PITCH_MAX, VIEW_PITCH_MIN, viewSettle } from '../geometry';
import { bookXs, checkSpace, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf, computeShelf } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

afterEach(() => setViewPitch(VIEW_PITCH_MIN));

it('3°~8° 안으로 제한', () => {
  expect(setViewPitch(1)).toBe(VIEW_PITCH_MIN);
  expect(setViewPitch(20)).toBe(VIEW_PITCH_MAX);
  expect(CAMERA.ky).toBeCloseTo(kyOf(VIEW_PITCH_MAX), 12);
});

it('각을 바꿔도 책의 3D 자세·자리·공간 판정은 같고, 화면 투영(터치 영역)만 달라진다', () => {
  const at = (deg: number) => {
    setViewPitch(deg);
    return { xs: bookXs(SAMPLE_LAYOUT, books), bodies: bodiesOf(SAMPLE_LAYOUT, books, 'shelf-2'), space: checkSpace(SAMPLE_LAYOUT, books), polys: computeShelf(SAMPLE_LAYOUT, books, 'shelf-2').frames.map((f) => f.poly) };
  };
  const a = at(3);
  const b = at(8);
  expect(b.xs).toEqual(a.xs);
  expect(b.bodies).toEqual(a.bodies);
  expect(b.space).toBe(a.space);
  expect(b.polys).not.toEqual(a.polys);
});

describe('시점 끌기를 놓았을 때 정착', () => {
  it('조금 움직였다 놓으면 원래 시점(가까운 쪽이 아니라), 아주 세게 튕기면 그 방향', () => {
    expect(viewSettle(VIEW_PITCH_MAX, 8, 7.5, 0)).toBe(VIEW_PITCH_MAX);
    expect(viewSettle(VIEW_PITCH_MIN, 3, 3.6, 300)).toBe(VIEW_PITCH_MIN);
    expect(viewSettle(VIEW_PITCH_MIN, 3, 3.6, 2000)).toBe(VIEW_PITCH_MAX);
  });

  it('충분히 끌었으면 가까운 쪽, 빠르게 놓으면 놓는 방향', () => {
    expect(viewSettle(VIEW_PITCH_MIN, 3, 6, 0)).toBe(VIEW_PITCH_MAX);
    expect(viewSettle(VIEW_PITCH_MIN, 3, 5, 0)).toBe(VIEW_PITCH_MIN);
    expect(viewSettle(VIEW_PITCH_MIN, 3, 5, 700)).toBe(VIEW_PITCH_MAX);
    expect(viewSettle(VIEW_PITCH_MAX, 8, 6, -700)).toBe(VIEW_PITCH_MIN);
  });

  it('정착 중에 다시 잡고 조금만 움직이면 향하던 시점으로', () => {
    // 3 → 8로 정착하던 중 5.2°에서 잡아 0.3°만 움직임: 원래 목표(8°)
    expect(viewSettle(VIEW_PITCH_MAX, 5.2, 4.9, 0)).toBe(VIEW_PITCH_MAX);
  });

  it('약 170dp 끌면 3° → 8°', () => {
    expect(VIEW_PITCH_MIN + 170 * VIEW_DEG_PER_DP).toBeCloseTo(VIEW_PITCH_MAX, 0);
  });
});
