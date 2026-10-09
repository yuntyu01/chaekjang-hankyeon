import type { Book, CoverArt } from './types';

// The same printed jacket is used on the shelf, in the drawer and in every pose.
export const LANDSCAPES: Record<'night' | 'forest' | 'sunset', CoverArt> = {
  night: {
    image: require('../../assets/reference/bookshelf-original.png'), titleTop: 0.135, ink: '#F7E8CA', edge: '#4B6080',
    sourceRect: { x: 290, y: 321, width: 258, height: 369 }, printedTitle: '느린 계절',
    titleRect: { x: 65, y: 57, width: 146, height: 43, cleanX: 225 },
  },
  forest: {
    image: require('../../assets/reference/bookshelf-original.png'), titleTop: 0.275, ink: '#2F3944', edge: '#929D7B',
    sourceRect: { x: 67, y: 806, width: 291, height: 351 }, printedTitle: '여름의 숲',
    titleRect: { x: 97, y: 108, width: 129, height: 40, cleanX: 248 },
  },
  sunset: {
    image: require('../../assets/reference/bookshelf-original.png'), titleTop: 0.085, ink: '#2F3944', edge: '#F4BF9C',
    sourceRect: { x: 546, y: 1248, width: 267, height: 322 }, printedTitle: '우리가 빛의 속도로 갈 수 없다면',
    titleRect: { x: 53, y: 33, width: 185, height: 66, cleanX: 244 },
  },
};

// Upgrade the old sample palette without changing a reader's chosen custom color.
const LEGACY_COLORS: Record<string, string> = {
  '#3D5F57': '#627260', '#BE5D47': '#CF886E', '#1D426B': '#4B6080',
  '#5E6D5B': '#627260', '#CE886F': '#CF886E', '#FBD392': '#FDD594',
  '#88A4BA': '#8CA5BA', '#FDF0E0': '#FEF1DF',
  '#1E4260': '#4B6080', '#B4C8D6': '#8DA5B9', '#B5C7D7': '#819AB1',
  '#4E6B60': '#A7AF95', '#893E41': '#8D4F4E', '#E39E8A': '#F3B497',
  '#F8C69F': '#F0BDA0', '#DDAFAF': '#F4BF9C',
};

export function jacketColor(color: string) {
  return LEGACY_COLORS[color.toUpperCase()] ?? color;
}

// Binding belongs to the jacket material, so changing its tiny decoration does
// not suddenly open the paper head. The reference's green/light blue bindings
// close over the pages; the dark blue and burgundy bindings expose more paper.
export function jacketHeadReveal(book: Book) {
  const color = jacketColor(book.cover?.edge ?? book.body?.face ?? book.themeColor);
  if (color.toUpperCase() === '#4B6080') return 0.88;
  const n = parseInt(color.replace('#',''),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  if (g>r*1.04 && g>b*.97) return r<140 ? 0.02 : 0.24;
  if (b>r*1.08 && b>g*1.04) return r>135 ? 0.02 : r<100 ? 0.28 : 0.65;
  if (r>g*1.25 && r>b*1.25) return g<110 ? 0.65 : 0.02;
  return r>230 && g>225 ? 0.30 : 0.18;
}

export function landscapeFor(color: string): CoverArt {
  const hex = color.replace('#', '');
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (g > r * 1.02 && g > b * 0.95) return LANDSCAPES.forest;
  if (b > r * 1.02 || Math.max(r, g, b) < 145) return LANDSCAPES.night;
  return LANDSCAPES.sunset;
}

export function jacketFor(book: Book): CoverArt {
  return book.cover ?? landscapeFor(jacketColor(book.body?.face ?? book.themeColor));
}
