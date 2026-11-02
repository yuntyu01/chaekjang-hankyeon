import { coverAtSize, whiteMat, withSharpCover } from '../cover-url';

// 가로 w, 세로 h 그림: inside(x, y)이면 색, 아니면 흰색
function picture(w: number, h: number, inside: (x: number, y: number) => boolean) {
  return (x0: number, y0: number, rw: number, rh: number) => {
    const out: number[] = [];
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) out.push(...(inside(x, y) ? [200, 120, 90, 255] : [255, 255, 255, 255]));
    return out;
  };
}

describe('표지 그림의 흰 여백', () => {
  it('네 변에 좁은 흰 띠가 있으면 여백으로 잘라 낸다', () => {
    const m = whiteMat(800, 1200, picture(800, 1200, (x, y) => x >= 40 && x < 760 && y >= 30 && y < 1160))!;
    expect(m.l).toBeCloseTo(40 / 800);
    expect(m.r).toBeCloseTo(40 / 800);
    expect(m.t).toBeCloseTo(30 / 1200);
    expect(m.b).toBeCloseTo(40 / 1200);
  });
  it('여백 없는 표지는 그대로', () => {
    expect(whiteMat(800, 1200, picture(800, 1200, () => true))).toBeNull();
  });
  it('원래 흰 표지: 띠가 없는 변이 있거나, 띠가 넓으면 그대로', () => {
    expect(whiteMat(800, 1200, picture(800, 1200, (x, y) => y >= 190 && x < 760))).toBeNull(); // 왼쪽 0
    expect(whiteMat(800, 1200, picture(800, 1200, (x, y) => x >= 100 && x < 700 && y >= 150 && y < 1050))).toBeNull(); // 가운데 그림만 있는 흰 표지
    expect(whiteMat(800, 1200, () => new Array(1200 * 4).fill(255))).toBeNull(); // 온통 흰색
  });
  it('픽셀을 못 읽으면 그대로', () => {
    expect(whiteMat(800, 1200, () => null)).toBeNull();
  });
});

describe('큰 표지 사본', () => {
  it('YES24 표지만 XL로, 같은 책에는 같은 사본', () => {
    const b = { coverArtUri: 'https://image.yes24.com/goods/1/L', title: 'x' };
    const s = withSharpCover(b);
    expect(s.coverArtUri).toBe(coverAtSize(b.coverArtUri, 'XL'));
    expect(withSharpCover(b)).toBe(s);
    const own = { coverArtUri: 'file:///my.jpg' };
    expect(withSharpCover(own)).toBe(own);
    const none = {};
    expect(withSharpCover(none)).toBe(none);
  });
});
