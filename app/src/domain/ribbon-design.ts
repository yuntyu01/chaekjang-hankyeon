import type { Book } from './types';

export function hasRibbon(book: Book): boolean {
  return book.art.ribbonVisible ?? ((book.quotes ?? 0) > 0);
}

export type RibbonDesign = { width: number; out: number; x: number; y: number };
export const DEFAULT_RIBBON: RibbonDesign = { width: 8.5, out: 12, x: 0, y: 0 };
// The four cloth strips in the reference have different lengths and insertion
// points. Use the same dimensions for drawing and transition occlusion.
const RIBBONS: Record<string, RibbonDesign> = {
  '#929778': { width: 8.05, out: 9.25, x: 0.685, y: -1.37 },
  '#EFC591': { width: 8.5, out: 12.9, x: -2.285, y: -2.285 },
  '#ECA676': { width: 8.96, out: 12.9, x: -2.057, y: 0.457 },
  '#8C9474': { width: 8.5, out: 9.7, x: 3.2, y: 1.83 },
};
export function ribbonDesign(book: Book): RibbonDesign {
  return RIBBONS[book.art.ribbon?.toUpperCase() ?? ''] ?? DEFAULT_RIBBON;
}
