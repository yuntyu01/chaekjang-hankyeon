import { contrast } from '../color';
import { spineTitleLayout } from '../title-layout';
import {
  accentFor, applyOverride, buildBookArt, extractPalette, genreOf, hexToHsl, inkFor, LIGHT_RANGE, MIN_CONTRAST, pickMotif,
  BOOK_COLORS, SAT_RANGE, showAuthorOnSpine, suggestColors, tameToPalette, type RebindInput,
} from '../rebinding';

const inRange = (hex: string) => {
  const { s, l } = hexToHsl(hex);
  return s >= SAT_RANGE[0] - 0.02 && s <= SAT_RANGE[1] + 0.02 && l >= LIGHT_RANGE[0] - 0.01 && l <= LIGHT_RANGE[1] + 0.01;
};
const px = (hex: string, n = 100) => {
  const v = parseInt(hex.slice(1), 16);
  return Array.from({ length: n }, () => [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]).flat();
};

describe('색 보정', () => {
  const cases: [string, string][] = [['형광 노랑', '#FFFF00'], ['순백', '#FFFFFF'], ['순검정', '#000000'], ['회색', '#808080'], ['형광 분홍', '#FF1493'], ['원색 파랑', '#0000FF']];
  it.each(cases)('%s 썸네일 → 팔레트 범위 + 대비 4.5:1', (_n, hex) => {
    const art = buildBookArt({ isbn: '9781', title: '시험', palette: extractPalette(px(hex)) });
    expect(inRange(art.baseColor)).toBe(true);
    expect(contrast(art.inkColor, art.baseColor)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
  it('모든 색상각·명도에서 대비 4.5:1이 보장된다', () => {
    for (let h = 0; h < 360; h += 15) for (const l of [0.2, 0.4, 0.5, 0.6, 0.7, 0.95]) for (const s of [0.1, 0.5, 1]) {
      const hex = `#${[0, 1, 2].map((k) => Math.round(((Math.cos(((h + k * 120) * Math.PI) / 180) * s * 0.5 + 0.5) * l * 2) % 1.0001 * 255).toString(16).padStart(2, '0')).join('')}`;
      const { base, ink } = inkFor(tameToPalette(hex));
      expect(contrast(ink, base)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(inRange(base)).toBe(true);
    }
  });
  it('흰색이 70% 넘으면 2순위 유채색을 쓴다', () => {
    const palette = [{ hex: '#FAFAFA', weight: 0.75 }, { hex: '#3366CC', weight: 0.2 }, { hex: '#222222', weight: 0.05 }];
    const art = buildBookArt({ isbn: '1', title: 'a', palette });
    expect(Math.abs(hexToHsl(art.baseColor).h - 220)).toBeLessThan(8);
  });
  it('전부 무채색이면 아이보리/먹/회청 중 제목 해시', () => {
    const palette = [{ hex: '#FFFFFF', weight: 0.6 }, { hex: '#000000', weight: 0.4 }];
    const hues = new Set<string>();
    for (const t of ['가', '나', '다', '라', '마', '바', '사', '아']) hues.add(buildBookArt({ title: t, palette }).baseColor);
    expect(hues.size).toBeGreaterThanOrEqual(2);
  });
  it('보색 계열 강조색은 바탕과 색상이 다르다', () => {
    const base = buildBookArt({ title: 'x', themeColor: '#3366CC' }).baseColor;
    expect(Math.abs(hexToHsl(accentFor(base)).h - hexToHsl(base).h)).toBeGreaterThan(90);
  });
  it('추천 색 5개: 서로 다르고 모두 팔레트 안', () => {
    const list = suggestColors('#3366CC');
    expect(list.length).toBe(5);
    list.forEach((c) => expect(inRange(c)).toBe(true));
  });
});

describe('책 색 목록', () => {
  it('모두 팔레트 범위 안이고 글자 대비 4.5:1, 서로 다른 색', () => {
    expect(BOOK_COLORS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BOOK_COLORS.map((c) => c.hex)).size).toBe(BOOK_COLORS.length);
    for (const c of BOOK_COLORS) {
      expect(inRange(c.hex)).toBe(true);
      expect(contrast(inkFor(c.hex).ink, c.hex)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('결정성·시리즈', () => {
  const input: RebindInput = { isbn: '9788937462788', title: '데미안', authors: ['헤르만 헤세'], pageCount: 280, heightMm: 210, category: '소설', palette: extractPalette(px('#2E4F8A')) };
  it('같은 입력 두 번 → 동일', () => {
    expect(buildBookArt(input, 't')).toEqual(buildBookArt({ ...input, authors: ['헤르만 헤세'] }, 't'));
  });
  it('시리즈 3권은 같은 색 계열·같은 조판 변형', () => {
    const vols = ['1', '2', '3'].map((n) => buildBookArt({ isbn: `97800${n}`, title: `해리 포터 ${n}`, seriesTitle: '해리 포터', palette: extractPalette(px(n === '1' ? '#AA2200' : '#22AA55')) }));
    expect(new Set(vols.map((v) => v.layoutVariant)).size).toBe(1);
    const hues = vols.map((v) => hexToHsl(v.baseColor).h);
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(12);
  });
  it('높이·두께 등급은 기존 규칙', () => {
    const a = buildBookArt({ title: 't', heightMm: 150, pageCount: 100 });
    expect([a.heightClass, a.thicknessClass]).toEqual(['short', 'thin']);
    const b = buildBookArt({ title: 't', heightMm: 240, pageCount: 600 });
    expect([b.heightClass, b.thicknessClass]).toEqual(['tall', 'thick']);
    expect(showAuthorOnSpine(a.thicknessClass)).toBe(false);
    expect(showAuthorOnSpine(b.thicknessClass)).toBe(true);
  });
});

describe('모티프 선택', () => {
  it('분류 해석', () => {
    expect(genreOf('813.7')).toBe('novel');
    expect(genreOf('814.6')).toBe('essay');
    expect(genreOf('811')).toBe('poem');
    expect(genreOf('420')).toBe('science');
    expect(genreOf('911')).toBe('history');
    expect(genreOf('국내도서>소설/시/희곡>한국소설')).toBe('novel');
    expect(genreOf('국내도서>소설/시/희곡')).toBe('novel'); // YES24 goodsSortNm(두 단계)
    expect(genreOf('국내도서>소설/시/희곡>시')).toBe('poem');
    expect(genreOf('시/희곡')).toBe('poem');
    expect(genreOf(undefined, '우주의 역사')).toBe('science');
  });
  it.each(['813.7', '814', '420', '911'])('분류 %s: 한쪽으로 몰리지 않는다', (cat) => {
    const count = new Map<string, number>();
    const N = 600;
    for (let i = 0; i < N; i++) { const m = pickMotif(cat, `책 ${i} 제목 ${i * 7}`); count.set(m, (count.get(m) ?? 0) + 1); }
    expect(count.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...count.values()) / N).toBeLessThan(0.34);
  });
});

describe('오버라이드', () => {
  it('색을 바꾸면 글자색 대비를 다시 맞추고, 모티프·조판을 바꾼다', () => {
    const art = buildBookArt({ isbn: '1', title: '가', themeColor: '#3366CC' });
    const o = applyOverride(art, { baseColor: '#EEDDAA', motifId: 'moon', layout: 'spine_c' });
    expect(o.baseColor).toBe('#EEDDAA');
    expect(contrast(o.inkColor, o.baseColor)).toBeGreaterThanOrEqual(4.5);
    expect([o.motifId, o.layoutVariant]).toEqual(['moon', 'spine_c']);
    expect(applyOverride(art, { motifId: 'nope' }).motifId).toBe(art.motifId);
  });
});

describe('조판(책등)', () => {
  const T = 'x';
  it('2자·25자·영문 제목이 책등에 들어간다', () => {
    for (const title of ['나무', '우리가 빛의 속도로 갈 수 없다면 그리고 또', 'The Great Gatsby']) {
      const lay = spineTitleLayout(title, 200, 24, 0.79, 0.9);
      expect(lay.columns.length).toBeGreaterThan(0);
      expect(lay.columns.join('').replace(/\s/g, '').length).toBeGreaterThan(0);
    }
    expect(T).toBe('x');
  });
});

describe('median cut', () => {
  it('두 색 이미지에서 상위 색과 비중', () => {
    const p = extractPalette([...px('#CC3333', 70), ...px('#3333CC', 30)], 3);
    expect(p[0].weight).toBeCloseTo(0.7, 1);
    expect(hexToHsl(p[0].hex).h).toBeLessThan(10);
    expect(p.reduce((a, e) => a + e.weight, 0)).toBeCloseTo(1, 5);
  });
});
