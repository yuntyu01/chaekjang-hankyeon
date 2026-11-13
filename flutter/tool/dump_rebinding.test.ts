// 재장정 색 규칙을 지금 앱 함수로 뽑는다(gen_shaders.sh가 jest로 돌린다): 색 변환·해시·기준색·팔레트 보정·글자색·장정 만들기·
// 표지 화소에서 책 색·갈피 색·띠 색·median cut·표지 색 칸. Flutter 쪽은 test/rebinding_matches_app_test.dart가 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import * as r from '@/domain/rebinding';

// 결정적 의사 난수(같은 그림)
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// 합성 표지: 색 덩어리 몇 개 + 잡티 + 투명 화소 조금
function cover(seed: number, w: number, h: number, blobs: [number, number, number, number][]) {
  const rnd = rng(seed);
  const px: number[] = [];
  for (let i = 0; i < w * h; i++) {
    let x = rnd();
    let c = blobs[blobs.length - 1];
    for (const b of blobs) { if (x < b[3]) { c = b; break; } x -= b[3]; }
    const j = () => Math.round((rnd() - 0.5) * 30);
    const cl = (v: number) => Math.max(0, Math.min(255, v));
    px.push(cl(c[0] + j()), cl(c[1] + j()), cl(c[2] + j()), rnd() < 0.02 ? 40 : 255);
  }
  return px;
}

test('dump rebinding rules', () => {
  const colors = ['#000000', '#FFFFFF', '#5276B3', '#C9A27E', '#E39E8A', '#3D5F57', '#F7E8D5', '#808080', '#FF0000', '#00FF66', '#123', '#EDEBE5', '#1D426B', '#8A8F5A'];
  const hsl = colors.map((c) => ({ c, hsl: r.hexToHsl(c), back: r.hslToHex(r.hexToHsl(c)), achro: r.isAchromatic(c), tame: r.tameToPalette(c), ink: r.inkFor(r.tameToPalette(c)), inkRaw: r.inkFor(c), accent: r.accentFor(c), tones: r.tonesFor(c), suggest: r.suggestColors(c) }));
  const strings = ['', '모순', '데미안', 'abc', '9788937460449', '😀책', 'series:해리 포터', 'book:x'];
  const hashes = strings.map((s) => ({ s, h: r.hash32(s), series: r.seriesBase(s || 'x', 'v1'), layout: r.layoutFor(s || undefined, 'seed') }));
  const palettes = [
    undefined,
    [{ hex: '#FFFFFF', weight: 0.8 }, { hex: '#5276B3', weight: 0.2 }],
    [{ hex: '#111111', weight: 0.5 }, { hex: '#EEEEEE', weight: 0.4 }],
    [{ hex: '#C9A27E', weight: 0.3 }, { hex: '#F0F0F0', weight: 0.7 }],
    [{ hex: 'bad', weight: 0.9 }, { hex: '#8FA695', weight: 0.1 }],
  ];
  const picks = palettes.flatMap((p) => [undefined, '#336699'].map((t) => ({ palette: p ?? null, theme: t ?? null, out: r.pickSourceColor(p, t, '모순') })));
  const cats = ['813.7', '811.6', '814.6', '120', '330', '470', '560', '660', '910', '국내도서>소설/시/희곡>한국소설', '국내도서>시/희곡>시', '시', '에세이', '어린이>동화', '', undefined];
  const genres = cats.flatMap((c) => ['채식주의자', '코스모스 우주 이야기', '시간의 역사'].map((t) => ({ c: c ?? null, t, g: r.genreOf(c, t), m: r.pickMotif(c, t, 's') })));
  const arts = [
    { title: '모순', pageCount: 308, heightMm: 188 },
    { title: '데미안', isbn: '9788937460449', category: '813.7', pageCount: 239, heightMm: 225 },
    { title: '해리 포터 1', seriesTitle: '해리 포터', pageCount: 400 },
    { title: '코스모스', coverColor: '#1A1A1A', pageCount: 719, heightMm: 224 },
    { title: '흰', palette: [{ hex: '#B0CFE4', weight: 0.6 }, { hex: '#FFFFFF', weight: 0.4 }], pageCount: 180, heightMm: 170 },
    { title: '구의 증명', themeColor: '#7FC8B0' },
  ].map((i) => ({ input: i, art: r.buildBookArt(i, '2026-11-14T00:00:00.000Z') }));
  const covers = [
    { seed: 1, w: 48, h: 72, blobs: [[240, 240, 240, 0.6], [30, 30, 30, 0.3], [180, 60, 80, 0.1]] },
    { seed: 2, w: 48, h: 72, blobs: [[20, 20, 22, 0.9], [200, 180, 40, 0.1]] },
    { seed: 3, w: 4, h: 144, blobs: [[120, 200, 170, 0.85], [250, 250, 250, 0.15]] },
    { seed: 4, w: 24, h: 36, blobs: [[230, 200, 200, 0.5], [40, 40, 80, 0.3], [200, 40, 40, 0.15], [255, 255, 255, 0.05]] },
    { seed: 5, w: 48, h: 72, blobs: [[245, 245, 245, 0.985], [120, 60, 160, 0.015]] },
    { seed: 6, w: 48, h: 72, blobs: [[128, 128, 128, 1]] },
  ] as const;
  const pixels = covers.map((c) => {
    const px = cover(c.seed, c.w, c.h, c.blobs.map((b) => [...b]) as [number, number, number, number][]);
    const palette = r.extractPalette(px, 6);
    return { ...c, px, dominant: r.dominantColorOf(px), accent: r.accentColorOf(px), edge: r.edgeColorOf(px), palette3: r.extractPalette(px, 3), palette, swatches: r.coverSwatches(palette) };
  });
  const dir = join(__dirname, '..', 'test', 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rebinding_cases.json'), `${JSON.stringify({ note: '지금 앱 재장정 색 규칙(tool/dump_rebinding.test.ts). 손으로 고치지 말 것', hsl, hashes, picks, genres, arts, pixels, bookColors: r.BOOK_COLORS })}\n`);
  console.log(`[dump] rebinding colors ${hsl.length} arts ${arts.length} pixels ${pixels.length}`);
});
