import type { Book, Physical } from './types';
import { mm, spineDU, thicknessMm } from './geometry';

type Dims = NonNullable<Book['dims']>;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Display proportions for the illustrated jackets. Bibliographic sizes remain
// unchanged; the same display dimensions drive rendering, picking and packing.
export function illustratedDimensions(p: Physical): Dims {
  const height = clamp(152 + (p.heightMm - 188) * 0.55, 146, 176);
  const aspect = clamp((p.widthMm / p.heightMm) * 1.08, 0.74, 0.85);
  return {
    height,
    coverWidth: height * aspect,
    thickness: clamp(spineDU(thicknessMm(p.pages)) - 3.2, 26.8, 44.8),
  };
}

// 내 책의 실제 크기(2026-11-01 사용자 '책 크기·두께가 제공된 쪽수·길이에 맞아야'): 제공된 mm를 선반과 같은 축척으로 그대로 쓴다.
// 두께는 YES24 책등 사진 비율(폭/높이)이 있으면 실제 두께로 그 값, 없으면 쪽수로 어림한다.
// 잘못 온 값(가로 20mm 같은 것)은 흔한 판형으로 그린다.
// 최소 두께 28DU(2026-11-01 사용자 '최소 크기는 위 예시 책 크기의 글씨가 여유롭게 들어오게'): 책등 제목이 예시 책과 같은 글자 크기(11DU, 폭의 약 42%)로 들어간다.
export const REAL_SPINE_MIN = 28;
const saneSize = (w: number, h: number) => w >= 70 && h >= 90 && w / h >= 0.45 && w / h <= 1.3;
export function realDimensions(p: Physical, spineRatio?: number): Dims {
  const [w, h] = saneSize(p.widthMm, p.heightMm) ? [p.widthMm, p.heightMm] : [128, 188];
  const height = mm(h);
  return { height, coverWidth: mm(w), thickness: Math.max(REAL_SPINE_MIN, spineRatio ? height * spineRatio : mm(thicknessMm(p.pages))) };
}

// Measured jacket templates, converted from the 853px reference to 390DU.
// Both the onboarding shelf and the comparison shelf use these proportions.
export const REFERENCE_JACKETS: Record<string, Dims> = Object.fromEntries([
  ['b01', 149.7, 28.2, 114], ['b02', 170, 36, 118], ['b03', 170, 38, 119],
  ['b04', 169, 35, 118], ['b05', 169, 34, 115], ['b17', 162, 39.1, 117],
  ['b06', 148.5, 29, 116], ['b07', 161.4, 38, 133], ['b08', 157, 32, 113],
  ['b09', 158, 32, 114], ['b10', 158, 45, 115], ['b18', 163, 37, 116],
  ['b11', 151, 33, 118], ['b12', 161, 41.7, 122], ['b13', 156.8, 34.2, 120],
  ['b14', 142, 33.6, 114], ['b15', 146, 33.7, 113], ['b16', 147.2, 35, 122],
].map(([id, height, thickness, coverWidth]) => [id, { height, thickness: Number(thickness) - 1.2, coverWidth }])) as Record<string, Dims>;
