// 장정 재질 색(순수): 받은 장정 띠(reference-bindings)에서 넓은 재질 색만 뽑는다. 띠 양 끝의 빛(시안 그림의 밝고 어두운 가장자리)은 버린다:
// 빛은 그릴 때 빛 모델이 계산한다.
import profiles from '@/scene-config/reference-bindings.generated.json';

import { PHOTO_SATURATION } from '@/scene-config/lighting';

import { jacketColor } from './book-design';
import type { Book, BookSurface } from './types';

export type Binding = { colors: string[]; positions: number[]; horizontal: boolean };
const customBindings = new Map<string, Binding>();
const rgb = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const hex = (channels: number[]) => '#' + channels.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
// The measured strip includes the reference camera's bright/dark rim pixels.
// Keep only its broad material colour; live 3D lighting owns the edge roll.
function materialOnly(binding: Binding): Binding {
  const samples = binding.colors.map(rgb);
  const positions = Array.from({ length: 17 }, (_, i) => i / 16);
  const colors = positions.map(p => {
    const at = Math.max(0.12, Math.min(0.88, p));
    const out = [0, 0, 0];
    let total = 0;
    binding.positions.forEach((q, i) => {
      if (q < 0.1 || q > 0.9) return;
      const weight = Math.exp(-0.5 * ((q - at) / 0.055) ** 2);
      total += weight;
      samples[i].forEach((c, j) => { out[j] += c * weight; });
    });
    return hex(out.map(c => c / total));
  });
  return { colors, positions, horizontal: binding.horizontal };
}
export function referenceBinding(color: string): Binding | undefined {
  const key=color.toUpperCase();
  if (customBindings.has(key)) return customBindings.get(key);
  const original=(profiles as Record<string, Binding>)[key];
  if (original) {
    const material = materialOnly(original);
    customBindings.set(key, material);
    return material;
  }
  if (!/^#[0-9A-F]{6}$/.test(key)) return undefined;
  // Preserve a reader's chosen centre colour while borrowing the binding roll.
  const target=rgb(key);
  let closest: Binding | undefined, best=Infinity, base: number[]=[];
  for (const candidate of Object.values(profiles)) {
    const center=rgb(candidate.colors[Math.floor(candidate.colors.length/2)]);
    const distance=center.reduce((sum,c,i)=>sum+(c-target[i])**2,0);
    if (distance<best) { best=distance;closest=candidate;base=center; }
  }
  const binding={horizontal:closest!.horizontal,positions:closest!.positions,colors:closest!.colors.map(hex=>'#'+rgb(hex).map((c,i)=>Math.max(0,Math.min(255,Math.round(target[i]+c-base[i]))).toString(16).padStart(2,'0')).join(''))};
  const material = materialOnly(binding);
  customBindings.set(key,material);
  return material;
}

export function bindingSurfaceTone(color: string) {
  const material = referenceBinding(color);
  return material?.colors[Math.floor(material.colors.length / 2)] ?? color;
}


// 책 몸체(판·책등·판 끝)의 재질 색: 장정 색에서 뽑은 재질 띠의 가운데 색
export function bookTone(b: Book) {
  const tone = bindingSurfaceTone(jacketColor(b.cover?.edge ?? b.body?.face ?? b.themeColor));
  return b.coverArtUri || b.spineArtUri ? hex(saturated(rgb(tone), PHOTO_SATURATION)) : tone;
}

// 채도 행렬(휘도는 그대로 두고 회색 쪽으로): 입력 r·g·b의 행 3개. 표지 사진(art PhotoCover)과 책등 색이 같은 식을 쓴다
const LUMA = [0.2126, 0.7152, 0.0722];
export function saturationMatrix(s: number): number[][] {
  return [0, 1, 2].map((row) => LUMA.map((l, col) => l * (1 - s) + (row === col ? s : 0)));
}
export function saturated(c: number[], s: number): number[] {
  return saturationMatrix(s).map((m) => m[0] * c[0] + m[1] * c[1] + m[2] * c[2]);
}

// 면 전체에 곱할 빛 비율의 기준 색과 그림 표지 여부(BookLight). 실제 표지·책등 사진을 입힌 책은 픽셀마다 색이 달라 책 색 하나를 기준으로 삼지 않는다:
// 책 색이 표지 가장자리 색이라 검정에 가까우면 비율이 몇 배로 튀어 주황이 노랗게 날아가고, 순백이면 톤 곡선 끝이라 음영이 사라진다(2026-11-01 실측).
// 톤 곡선 직선 구간의 중간 회색을 기준으로 삼고, 반사광은 그림 표지처럼 따로 더한다
const PICTURE_ALBEDO: [number, number, number] = [0.5, 0.5, 0.5];
// material: 그 책의 표면. 실제 표지 사진을 입힌 책은 고른 재질이 없으면 무광 인쇄지(print)
export function bookLightRef(book: Book, linearOf: (hex: string) => [number, number, number]): { albedo: [number, number, number]; picture: boolean; material?: BookSurface } {
  if (book.coverArtUri || book.spineArtUri) return { albedo: PICTURE_ALBEDO, picture: true, material: book.art.material ?? 'print' };
  return { albedo: linearOf(bookTone(book)), picture: !!book.cover?.artworkId && !book.art.vectorCover, material: book.art.material };
}
