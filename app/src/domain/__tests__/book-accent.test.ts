// 갈피 색 하나: 표지에서 흰색·검정·회색을 뺀 가장 넓은 색. 책장 갈피 탭·갈피 카드 뒤 종이·테이프가 모두 이 색에서 나온다(2026-11-05 사용자)
import { isNeutralColor, paperColors, tabColors } from '../color';
import { coverAccentOf, needsCoverAccent, rememberCoverAccent } from '../cover-url';
import { accentColorOf } from '../rebinding';

// 표지 흉내: [색, 칸 수]를 RGBA 바이트로
const cover = (...parts: [[number, number, number], number][]) => {
  const out: number[] = [];
  for (const [[r, g, b], n] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return out;
};
const WHITE: [number, number, number] = [253, 253, 250];
const BLACK: [number, number, number] = [8, 8, 8];
const GREY: [number, number, number] = [200, 198, 200];
const YELLOW: [number, number, number] = [244, 189, 55];
const BLUE: [number, number, number] = [82, 118, 180];
const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

describe('표지에서 갈피 색 뽑기', () => {
  it('가장 넓은 색이 흰색·검정·회색이면 건너뛰고 그다음 넓은 색을 고른다', () => {
    expect(accentColorOf(cover([WHITE, 68], [YELLOW, 15], [BLUE, 5]))).toBe('#f4bd37');
    expect(accentColorOf(cover([BLACK, 57], [BLUE, 10]))).toBe('#5276b4');
    expect(accentColorOf(cover([GREY, 90], [YELLOW, 10]))).toBe('#f4bd37');
  });
  it('유채색이 가장 넓으면 그 색이다', () => {
    expect(accentColorOf(cover([BLUE, 60], [YELLOW, 30], [WHITE, 10]))).toBe('#5276b4');
  });
  it('3% 미만의 작은 점은 고르지 않고, 무채색뿐이면 없음', () => {
    expect(accentColorOf(cover([WHITE, 98], [YELLOW, 2]))).toBeNull();
    expect(accentColorOf(cover([WHITE, 60], [BLACK, 40]))).toBeNull();
  });
});

describe('갈피 색에서 탭·종이·테이프', () => {
  it('같은 색 하나에서 같은 색상으로 나온다', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return r > g && r > b ? 'r' : b > g ? 'b' : 'g';
    };
    const [c1, c2] = tabColors('#5276B4', 'x');
    const { paper, tape } = paperColors('#5276B4', 'x');
    for (const c of [c1, c2, paper, tape]) expect(hue(c)).toBe('b');
  });
  it('어두운 표지 색도 벽에 보이게 밝히고, 진한 색은 형광처럼 튀지 않게 채도를 누른다', () => {
    expect(lightness(tabColors('#491416', 'x')[0])).toBeGreaterThanOrEqual(0.41);
    expect(lightness(tabColors('#FDF3D0', 'x')[0])).toBeLessThanOrEqual(0.73);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(tabColors('#04D294', 'x')[0].slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(150);
  });
  it('뒤 종이는 흰 앞 종이와 갈리고 테이프는 종이보다 진하다', () => {
    const { paper, tape } = paperColors('#F4BD37', 'x');
    expect(lightness(paper)).toBeLessThan(0.9);
    expect(lightness(tape)).toBeLessThan(lightness(paper));
  });
  it('고를 색이 없는 책은 책마다 정해진 기본색(무채색이 아니고, 같은 책은 늘 같다)', () => {
    expect(tabColors(undefined, 'book-a')).toEqual(tabColors(undefined, 'book-a'));
    expect(isNeutralColor(tabColors(undefined, 'book-a')[0])).toBe(false);
    const all = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => tabColors(undefined, k)[0]));
    expect(all.size).toBeGreaterThan(1);
  });
});

it('표지별 값: 아직 안 쟀으면 재고, 고를 색 없음도 잰 것으로 기억한다', () => {
  const uri = 'https://image.yes24.com/goods/999/L';
  expect(needsCoverAccent(uri)).toBe(true);
  rememberCoverAccent(uri, '');
  expect(needsCoverAccent(uri)).toBe(false);
  expect(coverAccentOf(uri)).toBe('');
  expect(needsCoverAccent('file:///my-photo.jpg')).toBe(false);
});
