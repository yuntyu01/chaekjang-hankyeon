import { contrast, shade, titleInk, TITLE_DARK, TITLE_LIGHT } from '../color';
import { coverTitleLayout, layoutVerticalTitle, LYING_START, lyingTitleLayout, spineTitleLayout, titleOpacity, TITLE_SWAP } from '../title-layout';

describe('세로 제목 조판', () => {
  it('짧은 제목은 한 열', () => {
    expect(layoutVerticalTitle('모순', 90, 34, [13, 11])).toMatchObject({ fontSize: 13, columns: ['모순'] });
  });

  it('넓은 책은 단어 단위로 두 열까지 나눈다', () => {
    const r = layoutVerticalTitle('우리가 빛의 속도로 갈 수 없다면', 80, 48, [13, 11.5, 10]);
    expect(r.columns.length).toBeLessThanOrEqual(2);
  });

  it('좁은 책에서 너무 길면 최소 크기에서 말줄임하고 더 줄이지 않는다', () => {
    const r = layoutVerticalTitle('아주 아주 아주 긴 제목이 들어간 책', 70, 27, [11, 10, 9.5]);
    expect(r.fontSize).toBe(9.5);
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0].endsWith('⋯')).toBe(true);
  });
});

describe('색', () => {
  it('제목 색은 바탕 색에 대한 공통 규칙: 밝은 바탕엔 먹색, 어두운 바탕엔 따뜻한 밝은색', () => {
    for (const bg of ['#FBEDDD', '#F7E8D5', '#B5C7D7', '#F8C69F', '#E39E8A', '#F1E0C8']) expect(titleInk(bg)).toBe(TITLE_DARK);
    for (const bg of ['#1F3557', '#3D5F57', '#1D426B', '#893E41', '#BE5D47', '#244A70']) expect(titleInk(bg)).toBe(TITLE_LIGHT);
    // 고른 색은 늘 충분히 대비된다(중간 밝기 붉은 책등 포함)
    for (const bg of ['#FBEDDD', '#B5C7D7', '#E39E8A', '#BE5D47', '#3D5F57', '#1D426B']) expect(contrast(titleInk(bg), bg)).toBeGreaterThan(3.5);
    expect(shade('#808080', -0.5)).toBe('#404040');
  });
  it('시안 책장의 글자색: 중간 밝기의 붉은·푸른 책등은 밝은 글자, 연한 책은 따뜻한 갈색 먹', () => {
    // 문장 수집·느린 하루·여행의 이유·사람의 마음이란·데미안·고요한 우연
    for (const bg of ['#CE886F', '#8DA5B9', '#819AB1', '#475A78', '#647361', '#8F5654']) expect(titleInk(bg)).toBe(TITLE_LIGHT);
    // 모순·어린 왕자·작은 것들의 기쁨·너라는 계절·찰나의 마음
    for (const bg of ['#FDF0E0', '#FBD392', '#FDECD4', '#F0BDA0', '#F3B497']) expect(titleInk(bg)).toBe(TITLE_DARK);
    expect(TITLE_DARK).toBe('#4A403A');
  });
});


describe('책등 제목 자리', () => {
  it('얇은 책의 긴 제목은 그림을 밀어내고 잘리지 않는다', () => {
    for (const title of ['소년이 온다', '82년생 김지영', '여행의 이유', '달러구트 꿈 백화점']) {
      const r = spineTitleLayout(title, 143, 23, 0.5);
      expect(r.columns.some((c) => c.endsWith('⋯'))).toBe(false);
      expect(r.fontSize).toBeGreaterThanOrEqual(8.5);
      expect(r.artTop).toBeLessThanOrEqual(0.85);
    }
  });
  it('짧은 제목은 그림 자리를 그대로 둔다', () => {
    expect(spineTitleLayout('모순', 143, 23, 0.5).artTop).toBe(0.5);
  });
});

describe('책등 제목 열', () => {
  it('넓은 책등이어도 한 열에 들어가면 한 열로', () => {
    expect(spineTitleLayout('쇼코의 미소', 143, 35, 0.5).columns).toHaveLength(1);
  });
});

describe('책등 제목 한 열 우선', () => {
  it('눕혀 읽는 긴 제목(나미야 잡화점의 기적)도 한 열에 들어간다', () => {
    expect(spineTitleLayout('나미야 잡화점의 기적', 160, 30, 0.58).columns).toHaveLength(1);
  });
});

describe('앞표지 제목(장정 규칙)', () => {
  it('짧은 제목은 한 줄, 표지 폭에 맞추되 16DU를 넘지 않는다', () => {
    const r = coverTitleLayout('느린 계절', 102.9, 152.5);
    expect(r.lines).toEqual(['느린 계절']);
    expect(r.fontSize).toBeCloseTo(102.9 * 0.135, 0);
    expect(coverTitleLayout('월든', 116, 172)).toEqual({ lines: ['월든'], fontSize: 15.7 });
    expect(coverTitleLayout('월든', 160, 190).fontSize).toBe(16);
  });
  it('긴 제목은 단어를 깨지 않고 고르게 두 줄(시안과 같은 줄 나눔), 긴 줄이 표지 폭의 0.72를 넘지 않게', () => {
    const r = coverTitleLayout('우리가 빛의 속도로 갈 수 없다면', 103, 152);
    expect(r.lines).toEqual(['우리가 빛의 속도로', '갈 수 없다면']);
    expect(r.fontSize).toBeCloseTo(103 * 0.09, 0);
    expect(r.fontSize).toBeLessThan(coverTitleLayout('느린 계절', 103, 152).fontSize);
  });
});

describe('책등 제목(장정 규칙)', () => {
  it('글자는 책등 폭의 약 40%(시안 잉크 높이 ≈ 책 높이의 0.064), 읽을 수 있는 8.5DU 아래로는 줄이지 않는다', () => {
    expect(spineTitleLayout('모순', 188, 27.7, 0.5).fontSize).toBe(11);
    expect(spineTitleLayout('흰', 188, 21, 0.5).fontSize).toBe(9);
  });
  it('글자 간격은 시안처럼 글자 크기의 약 1.1배(짧은 제목 1.16), 긴 제목은 간격부터 줄인다', () => {
    expect(spineTitleLayout('데미안', 225, 24.6, 0.5).pitch).toBe(1.16);
    expect(spineTitleLayout('달러구트 꿈 백화점', 205, 27.5, 0.65).pitch).toBeLessThan(1.16);
  });
  it('짧은 제목은 둥글게 감싼 머리 아래 약 1/4에서 시작한다', () => {
    expect(spineTitleLayout('데미안', 225, 24.6, 0.9).textTop).toBe(0.255);
  });
});

describe('눕힌 책등 제목(가로 한 줄)', () => {
  // 길이 셈(조판 함수와 같은 규칙): 글자 1, 띄어쓰기 0.32, 자간 2%
  const span = (t: string, fs: number) => [...t].reduce((n, ch) => n + (ch === ' ' ? 0.32 : 1), 0) * 1.02 * fs;
  it('머리 쪽 끝에서 길이의 14%부터, 글자는 두께의 약 0.38(시안 더미 두 권 모두 잉크 약 10DU, 11DU 넘지 않음)', () => {
    const r = lyingTitleLayout('불편한 편의점', 156, 22.6);
    expect(r.start).toBe(LYING_START);
    expect(LYING_START).toBe(0.14);
    expect(r.text).toBe('불편한 편의점');
    expect(r.fontSize).toBeCloseTo(22.6 * 0.38, 1);
    expect(lyingTitleLayout('나미야 잡화점의 기적', 160, 36.4).fontSize).toBe(11);
  });
  it('한 줄이 책 길이(앞 14%·뒤 8% 빼고)를 넘지 않게 줄이고, 7.5DU 아래로는 줄이지 않고 말줄임', () => {
    for (const [title, h, t] of [['우리가 빛의 속도로 갈 수 없다면', 152.5, 31.3], ['나미야 잡화점의 기적', 133, 30], ['모순', 143, 29]] as const) {
      const r = lyingTitleLayout(title, h, t);
      expect(r.fontSize).toBeGreaterThanOrEqual(7.5);
      expect(span(r.text, r.fontSize)).toBeLessThanOrEqual(h * 0.78 + 1e-6);
    }
    const long = lyingTitleLayout('아주 아주 아주 아주 긴 제목이 들어간 아주 긴 책', 100, 24);
    expect(long.fontSize).toBe(7.5);
    expect(long.text.endsWith('⋯')).toBe(true);
    expect(span(long.text, long.fontSize)).toBeLessThanOrEqual(100 * 0.78 + 1e-6);
  });
  it('띄어쓰기는 하나로 모은다(앞뒤 공백 제거)', () => {
    expect(lyingTitleLayout('  아무튼,   서재 ', 133, 22).text).toBe('아무튼, 서재');
  });
  it('눕힌 책의 끝 장식 영역에는 긴 제목이 들어가지 않는다', () => {
    const r = lyingTitleLayout('좋은 문장은 이렇게 온다', 156, 36, 0.25);
    expect(r.text).toBe('좋은 문장은 이렇게 온다');
    expect(span(r.text, r.fontSize)).toBeLessThanOrEqual(156 * 0.61);
  });
});

describe('책등 제목 조판 바꾸기(세움 ↔ 눕힘)', () => {
  it('세로 조판이 사라진 뒤 가로 조판이 나타난다: 두 조판이 함께 보이는 각도가 없다', () => {
    expect(titleOpacity(0)).toEqual({ v: 1, h: 0 });
    expect(titleOpacity(-7)).toEqual({ v: 1, h: 0 }); // 기대기
    expect(titleOpacity(-90)).toEqual({ v: 0, h: 1 }); // 눕힘
    expect(titleOpacity(TITLE_SWAP.mid)).toEqual({ v: 0, h: 0 });
    for (let a = 0; a <= 90; a += 0.5) {
      const o = titleOpacity(-a);
      expect(o.v === 0 || o.h === 0).toBe(true);
      expect(o.v).toBeGreaterThanOrEqual(0);
      expect(o.h).toBeLessThanOrEqual(1);
    }
    // 바뀌는 구간 안에서 차례로 옅어지고 나타난다
    expect(titleOpacity(40).v).toBeGreaterThan(0);
    expect(titleOpacity(40).v).toBeLessThan(1);
    expect(titleOpacity(50).h).toBeGreaterThan(0);
    expect(titleOpacity(50).h).toBeLessThan(1);
  });
});

