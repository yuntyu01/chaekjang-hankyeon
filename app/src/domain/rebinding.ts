// 재장정(앱 장정): 책 정보 → 앱이 입힐 장정 파라미터(BookArt). 화면·네트워크와 무관한 순수 함수.
// - 같은 입력 → 같은 출력(시간·무작위 없음. generatedAt은 호출자가 넘긴다).
// - 썸네일은 색 추출에만 쓴다. 화면에 그리지 않고, 결과 색은 앱 팔레트 범위로 보정한다.
// - 렌더러(ui/book3d/art.tsx)는 이 결과를 Book.art(색·모티프·조판 변형)로 받아 벡터로 그린다.
import { contrast, rgbHex, TITLE_DARK, TITLE_LIGHT } from './color';
import { MOTIF_SLOTS, type MotifSlotId } from './motif-slots';
import type { HeightClass, ThicknessClass } from './types';

export const REBIND_VERSION = 1;

// 팔레트 범위(지시서 2): 채도 25~55%, 명도 35~80%
export const SAT_RANGE = [0.25, 0.55] as const;
export const LIGHT_RANGE = [0.35, 0.8] as const;
export const MIN_CONTRAST = 4.5;

export type LayoutVariant = 'spine_a' | 'spine_b' | 'spine_c';
export const LAYOUT_VARIANTS: LayoutVariant[] = ['spine_a', 'spine_b', 'spine_c'];
export type BindingKind = '양장' | '무선' | '문고';

export type PaletteEntry = { hex: string; weight: number }; // weight: 썸네일에서 차지하는 비중(합 1에 가깝게)

export type RebindInput = {
  isbn?: string;
  title: string;
  authors?: string[];
  publisher?: string;
  publishedYear?: number;
  pageCount?: number;
  heightMm?: number;
  widthMm?: number;
  binding?: BindingKind;
  category?: string; // KDC 번호("813.7") 또는 분류 이름("국내도서>소설/시/희곡>한국소설")
  seriesTitle?: string;
  palette?: PaletteEntry[]; // 썸네일 상위 색(extractPalette). 없으면 themeColor
  themeColor?: string; // 서버가 뽑아 준 주조색(팔레트가 없을 때)
};

export type BookArtParams = {
  baseColor: string;
  inkColor: string;
  accentColor: string;
  motifId: MotifSlotId;
  layoutVariant: LayoutVariant;
  heightClass: HeightClass;
  thicknessClass: ThicknessClass;
  generatedAt: string;
  version: number;
};

// 사용자 오버라이드(user_books). 있으면 BookArt 값 대신 쓴다.
export type ArtOverride = { baseColor?: string; motifId?: string; layout?: LayoutVariant };

// ---------- 색 ----------
export type HSL = { h: number; s: number; l: number }; // h 0~360, s·l 0~1

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToHsl(hex: string): HSL {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

export function hslToHex({ h, s, l }: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 흰·검·회색(무채색): 채도가 낮거나 아주 밝거나 아주 어두움
export function isAchromatic(hex: string) {
  const { s, l } = hexToHsl(hex);
  return s < 0.14 || l > 0.92 || l < 0.1;
}

// 문자열 해시(FNV-1a + 마지막 섞기). 비슷한 제목도 고르게 흩어진다.
export function hash32(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// 전부 무채색일 때: 아이보리 / 먹 / 회청 중 제목 해시로
const NEUTRALS = ['#CDBF9F', '#4A4F57', '#6F7F8F'];

// 썸네일 상위 색 → 기준색. 흰·검·회색이 70%를 넘으면 2순위 유채색, 전부 무채색이면 중립 3색 중 해시.
export function pickSourceColor(palette: PaletteEntry[] | undefined, themeColor: string | undefined, seed: string): string {
  const list = (palette ?? []).filter((p) => /^#[\da-f]{3}([\da-f]{3})?$/i.test(p.hex)).sort((a, b) => b.weight - a.weight);
  if (!list.length) return themeColor && /^#[\da-f]{6}$/i.test(themeColor) ? themeColor : NEUTRALS[hash32(seed) % NEUTRALS.length];
  const total = list.reduce((a, p) => a + p.weight, 0) || 1;
  const achromaticShare = list.filter((p) => isAchromatic(p.hex)).reduce((a, p) => a + p.weight, 0) / total;
  const chromatic = list.filter((p) => !isAchromatic(p.hex));
  if (!chromatic.length) return NEUTRALS[hash32(seed) % NEUTRALS.length];
  if (isAchromatic(list[0].hex) && achromaticShare > 0.7) return chromatic[0].hex;
  return list[0].hex;
}

// 팔레트 범위로 보정(형광·원색이 와도 선반 톤 유지)
export function tameToPalette(hex: string): string {
  const c = hexToHsl(hex);
  return hslToHex({ h: c.h, s: clamp(c.s, SAT_RANGE[0], SAT_RANGE[1]), l: clamp(c.l, LIGHT_RANGE[0], LIGHT_RANGE[1]) });
}

// 글자색: 먹/밝은 색 중 대비가 큰 쪽. 4.5:1에 못 미치면 바탕 명도를 팔레트 범위 안에서 밀어 맞춘다.
export function inkFor(base: string): { base: string; ink: string } {
  const best = (b: string) => (contrast(TITLE_DARK, b) >= contrast(TITLE_LIGHT, b) ? TITLE_DARK : TITLE_LIGHT);
  let ink = best(base);
  if (contrast(ink, base) >= MIN_CONTRAST) return { base, ink };
  const c = hexToHsl(base);
  // 더 가까운 쪽(어둡게 → 밝은 글자, 밝게 → 먹색)으로 0.01씩
  for (let d = 0.01; d <= 0.5; d += 0.01) {
    for (const dir of [-1, 1]) {
      const l = clamp(c.l + dir * d, LIGHT_RANGE[0], LIGHT_RANGE[1]);
      const b = hslToHex({ ...c, l });
      const i = best(b);
      if (contrast(i, b) >= MIN_CONTRAST) return { base: b, ink: i };
    }
  }
  return { base, ink }; // 범위 안에서는 항상 찾아지지만 안전장치
}

// 띠·모티프 색: 바탕의 보색 계열을 톤 다운(채도 낮추고 명도는 바탕에서 한 단 멀리)
export function accentFor(base: string): string {
  const c = hexToHsl(base);
  const l = c.l > 0.58 ? c.l - 0.26 : c.l + 0.3;
  return hslToHex({ h: (c.h + 165) % 360, s: clamp(c.s * 0.8, 0.22, 0.4), l: clamp(l, 0.25, 0.86) });
}

// 같은 시리즈는 같은 색 계열: 시리즈 제목에서 색상각을 정하고 권마다 명도만 조금 달리한다.
export function seriesBase(seriesTitle: string, volumeSeed: string): string {
  const h = hash32(seriesTitle);
  const hue = (h % 360 + 360) % 360;
  const l = 0.46 + ((hash32(volumeSeed) % 7) - 3) * 0.015;
  return hslToHex({ h: hue, s: 0.34 + ((h >>> 9) % 10) * 0.01, l });
}

// 색 5개 추천(확인 화면): 보정된 기본색 + 같은 색상각의 명도·채도 변형 + 보색 계열. 모두 팔레트 범위 안.
export function suggestColors(base: string): string[] {
  const c = hexToHsl(tameToPalette(base));
  const mk = (h: number, s: number, l: number) => inkFor(tameToPalette(hslToHex({ h: (h + 360) % 360, s, l }))).base;
  const out = [
    inkFor(tameToPalette(base)).base,
    mk(c.h, c.s, clamp(c.l - 0.14, 0.35, 0.8)),
    mk(c.h, c.s, clamp(c.l + 0.16, 0.35, 0.8)),
    mk(c.h + 30, c.s, c.l),
    mk(c.h + 180, c.s * 0.9, c.l),
  ];
  return [...new Set(out)];
}

// 고를 수 있는 책 색(이름 포함). 선반 톤을 지키도록 팔레트 범위(채도 25~55%·명도 35~80%)로 보정하고 글자 대비 4.5:1을 맞춘다.
const COLOR_SEEDS: [string, string][] = [
  ['샌드', '#CDBF9F'], ['크림', '#E2D4B4'], ['살구', '#EBB99A'], ['코랄', '#E0937F'], ['로즈', '#D49A9E'], ['먼지분홍', '#D6ADAA'],
  ['와인', '#9A4F57'], ['테라코타', '#B5694A'], ['머스터드', '#D4A94C'], ['카멜', '#B58B5C'], ['초콜릿', '#6E4B3A'], ['올리브', '#8A8F5A'],
  ['세이지', '#A9B995'], ['민트', '#9CCBB8'], ['숲', '#527A54'], ['청록', '#4D8A8A'], ['하늘', '#8DB5D6'], ['파랑', '#5877AE'],
  ['남색', '#3F5280'], ['슬레이트', '#6B7F92'], ['라벤더', '#A9A3CE'], ['보라', '#7B6B9E'], ['자두', '#80526F'], ['먹색', '#4A4F57'],
];
export const BOOK_COLORS: { name: string; hex: string }[] = COLOR_SEEDS.map(([name, hex]) => ({ name, hex: inkFor(tameToPalette(hex)).base }));

// ---------- 모티프 ----------
// 분류 → 후보군 → 제목 해시로 하나. 후보는 모티프 슬롯 30개 안에서 고른다(자산이 없는 이름은 슬롯에 없다).
export type Genre = 'novel' | 'poem' | 'essay' | 'science' | 'history' | 'thought' | 'society' | 'art' | 'tech' | 'child' | 'general';

const GENRE_MOTIFS: Record<Genre, MotifSlotId[]> = {
  novel: ['sprig', 'moon', 'wave', 'bird', 'window', 'lantern'],
  poem: ['feather', 'flower', 'wildflower', 'rain', 'crescent'],
  essay: ['leaf', 'cloud', 'cotton', 'teacup', 'shell'],
  science: ['star', 'constellation', 'sun', 'key', 'snow'],
  history: ['key', 'letter', 'lantern', 'mountain', 'pine'],
  thought: ['candle', 'moon', 'mountain', 'window', 'ripple'],
  society: ['window', 'key', 'letter', 'sun', 'cloud'],
  art: ['tulip', 'camellia', 'flower', 'feather', 'teacup'],
  tech: ['key', 'star', 'constellation', 'sun'],
  child: ['cat', 'bird', 'mushroom', 'cotton', 'sun'],
  general: MOTIF_SLOTS.map((m) => m.id),
};

const KEYWORDS: [Genre, RegExp][] = [
  // '시/희곡'은 그 이름 하나일 때만 시. YES24 분류는 두 단계("국내도서>소설/시/희곡")라 합친 이름은 소설로 읽는다(대부분 소설)
  ['poem', /시집|동시|^시$|^시\/희곡$|>시$/],
  ['child', /그림책|동화|어린이|유아|청소년/],
  ['novel', /소설|희곡|장편|단편|판타지|추리|스릴러|SF/i],
  ['essay', /에세이|수필|산문|여행|일기/],
  ['science', /과학|물리|화학|수학|천문|생물|우주|뇌/],
  ['history', /역사|전쟁|왕조|고대|조선|문명/],
  ['thought', /철학|종교|심리|명상|불교|기독교|인문/],
  ['society', /사회|정치|경제|경영|법|교육|사회과학/],
  ['art', /예술|미술|음악|사진|영화|건축|디자인/],
  ['tech', /기술|공학|컴퓨터|프로그래밍|IT|코딩/i],
];

// KDC 백의 자리(첫 숫자) → 분야. 8xx는 문학이라 세분(811 시, 814 수필, 그 외 소설·희곡)
export function genreOf(category: string | undefined, title = ''): Genre {
  const cat = (category ?? '').trim();
  const kdc = /^(\d{3})(?:\.\d+)?$/.exec(cat);
  if (kdc) {
    const n = kdc[1];
    if (n.startsWith('81') && n[2] === '1') return 'poem';
    if (n.startsWith('81') && n[2] === '4') return 'essay';
    switch (n[0]) {
      case '1': case '2': return 'thought';
      case '3': return 'society';
      case '4': return 'science';
      case '5': return 'tech';
      case '6': return 'art';
      case '8': return 'novel';
      case '9': return 'history';
    }
  }
  // 분류 경로(">")는 가장 안쪽 항목부터 본다("소설/시/희곡>한국소설"이 시로 읽히지 않게)
  const parts = cat.split('>').map((x) => x.trim()).filter(Boolean).reverse();
  for (const part of parts) for (const [g, re] of KEYWORDS) if (re.test(part)) return g;
  for (const [g, re] of KEYWORDS) if (g !== 'poem' && re.test(title)) return g;
  return 'general';
}

export function pickMotif(category: string | undefined, title: string, seed = ''): MotifSlotId {
  const group = GENRE_MOTIFS[genreOf(category, title)];
  return group[hash32(`${title}|${seed}`) % group.length];
}

// ---------- 조판 변형·크기 ----------
export function layoutFor(seriesTitle: string | undefined, seed: string): LayoutVariant {
  return LAYOUT_VARIANTS[hash32(seriesTitle ? `series:${seriesTitle}` : `book:${seed}`) % LAYOUT_VARIANTS.length];
}

// 기존 규칙(library.ts와 동일): 높이·쪽수 등급
export const heightClassOf = (h: number): HeightClass => (h < 180 ? 'short' : h < 215 ? 'medium' : 'tall');
export const thicknessClassOf = (p: number): ThicknessClass => (p < 220 ? 'thin' : p < 420 ? 'medium' : 'thick');

// 책등에 저자를 쓸지: 두께가 얇으면 생략(지시서 3)
export const showAuthorOnSpine = (thickness: ThicknessClass) => thickness !== 'thin';

// 책등 조판 변형이 렌더러에 주는 값(Book.art에 펼쳐 넣는다)
export function layoutArt(v: LayoutVariant): { titleTop?: number; motifScale?: number; motifBottom?: number } {
  switch (v) {
    case 'spine_a':
      return {};
    case 'spine_b':
      return { titleTop: 0.16, motifScale: 0.92 };
    case 'spine_c':
      return { titleTop: 0.11, motifBottom: 0.92 };
  }
}

// ---------- 본체 ----------
export function buildBookArt(input: RebindInput, now = ''): BookArtParams {
  const seed = input.isbn || input.title;
  const series = input.seriesTitle?.trim() || undefined;
  const source = series ? seriesBase(series, seed) : pickSourceColor(input.palette, input.themeColor, seed);
  const { base, ink } = inkFor(tameToPalette(source));
  const height = input.heightMm ?? 188;
  const pages = input.pageCount ?? 250;
  return {
    baseColor: base,
    inkColor: ink,
    accentColor: accentFor(base),
    motifId: pickMotif(input.category, input.title, series ?? ''),
    layoutVariant: layoutFor(series, seed),
    heightClass: heightClassOf(height),
    thicknessClass: thicknessClassOf(pages),
    generatedAt: now,
    version: REBIND_VERSION,
  };
}

// 사용자가 고른 바탕색에 맞는 글자색·강조색(바탕은 그대로 두고 글자색만 대비 큰 쪽으로)
export function tonesFor(base: string): { inkColor: string; accentColor: string } {
  return { inkColor: contrast(TITLE_DARK, base) >= contrast(TITLE_LIGHT, base) ? TITLE_DARK : TITLE_LIGHT, accentColor: accentFor(base) };
}

// 오버라이드 적용: 색을 바꾸면 글자색도 대비를 다시 맞춘다(사용자가 고른 색은 바꾸지 않고 글자만 맞춘다).
export function applyOverride(art: BookArtParams, o: ArtOverride | undefined): BookArtParams {
  if (!o) return art;
  let { baseColor, inkColor, accentColor } = art;
  if (o.baseColor && /^#[\da-f]{6}$/i.test(o.baseColor)) {
    baseColor = o.baseColor;
    ({ inkColor, accentColor } = tonesFor(baseColor));
  }
  const motifId = o.motifId && MOTIF_SLOTS.some((m) => m.id === o.motifId) ? (o.motifId as MotifSlotId) : art.motifId;
  return { ...art, baseColor, inkColor, accentColor, motifId, layoutVariant: o.layout ?? art.layoutVariant };
}

// ---------- 썸네일 색 추출(median cut) ----------
// rgba: 픽셀 RGBA 바이트 배열. 상위 n색과 비중을 돌려준다. 투명 픽셀은 건너뛴다.
export function extractPalette(rgba: ArrayLike<number>, n = 3): PaletteEntry[] {
  type Px = [number, number, number];
  const px: Px[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) if (rgba[i + 3] >= 128) px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  if (!px.length) return [];
  let boxes: Px[][] = [px];
  while (boxes.length < n) {
    // 색 폭×픽셀 수가 가장 큰 상자를 가장 긴 축의 중앙값에서 나눈다(같은 색뿐인 상자는 나누지 않는다)
    const spread = (b: Px[]) => [0, 1, 2].map((ch) => Math.max(...b.map((p) => p[ch])) - Math.min(...b.map((p) => p[ch])));
    const scored = boxes.map((b) => ({ b, r: spread(b) })).filter((e) => Math.max(...e.r) > 0).sort((a, c) => c.b.length * Math.max(...c.r) - a.b.length * Math.max(...a.r));
    if (!scored.length) break;
    const box = scored[0].b;
    boxes = boxes.filter((b) => b !== box);
    const range = scored[0].r;
    const axis = range.indexOf(Math.max(...range));
    box.sort((a, b) => a[axis] - b[axis]);
    // 중앙에서 가장 가까운 값 경계에서 자른다(같은 색 덩어리를 둘로 쪼개지 않는다)
    let mid = box.length >> 1;
    for (let d = 0; d < box.length; d++) {
      if (mid - d > 0 && box[mid - d - 1][axis] !== box[mid - d][axis]) { mid -= d; break; }
      if (mid + d < box.length && box[mid + d - 1][axis] !== box[mid + d][axis]) { mid += d; break; }
    }
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes
    .filter((b) => b.length)
    .map((b) => {
      const avg = [0, 1, 2].map((ch) => b.reduce((a, p) => a + p[ch], 0) / b.length);
      return { hex: rgbHex(avg[0], avg[1], avg[2]), weight: b.length / px.length };
    })
    .sort((a, b) => b.weight - a.weight);
}
