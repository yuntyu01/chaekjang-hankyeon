// 실제 표지 사진의 채도: 회색은 그대로, 색은 회색 쪽으로, 휘도는 그대로. 책등 색도 같은 값을 쓴다
import { PHOTO_SATURATION } from '@/scene-config/lighting';

import { bookTone, saturated, saturationMatrix } from '../binding-material';
import { SAMPLE_BOOKS } from '../onboarding-sample';

const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);

it('회색은 그대로, 색은 줄고, 휘도는 같다', () => {
  saturated([128, 128, 128], 0.5).forEach((v) => expect(v).toBeCloseTo(128, 6));
  const c = [200, 40, 80];
  const out = saturated(c, 0.85);
  expect(chroma(out)).toBeLessThan(chroma(c));
  expect(chroma(out)).toBeCloseTo(chroma(c) * 0.85, 6);
  expect(luma(out)).toBeCloseTo(luma(c), 6);
});

it('1이면 원본, 0이면 회색', () => {
  expect(saturationMatrix(1)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const g = saturated([200, 40, 80], 0);
  expect(chroma(g)).toBeCloseTo(0, 6);
});

it('표지 사진이 있는 책만 책등 색을 낮추고, 코드 장정 책은 그대로', () => {
  const book = SAMPLE_BOOKS.find((b) => !b.coverArtUri && /^#/.test(b.themeColor))!;
  const plain = bookTone(book);
  const photo = bookTone({ ...book, coverArtUri: 'https://image.yes24.com/goods/1/L' });
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  expect(PHOTO_SATURATION).toBeLessThan(1);
  expect(chroma(parse(photo))).toBeLessThan(chroma(parse(plain)));
});
