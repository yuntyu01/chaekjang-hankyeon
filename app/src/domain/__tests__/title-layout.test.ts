import { inkFor, shade } from '../color';
import { coverTitleLayout, layoutVerticalTitle, spineTitleLayout } from '../title-layout';

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
  it('어두운 책엔 밝은 글자', () => {
    expect(inkFor('#1F3557')).toBe('#F6EEDD');
    expect(inkFor('#F1E9DA')).toBe('#2A2A2C');
    expect(shade('#808080', -0.5)).toBe('#404040');
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
  it('제목은 표지 폭의 약 9%로, 짧으면 한 줄', () => {
    const r = coverTitleLayout('월든', 116, 172);
    expect(r.lines).toEqual(['월든']);
    expect(r.fontSize).toBeCloseTo(116 * 0.088, 0);
  });
  it('한 줄이 표지 폭을 넘는 긴 제목은 단어를 깨지 않고 두 줄, 크기는 그대로(작게 두고 여백을 남긴다)', () => {
    const r = coverTitleLayout('우리가 빛의 속도로 갈 수 없다면', 103, 152);
    expect(r.lines).toHaveLength(2);
    expect(r.lines.join(' ')).toBe('우리가 빛의 속도로 갈 수 없다면');
    expect(r.fontSize).toBeLessThanOrEqual(11);
  });
});

describe('책등 제목(장정 규칙)', () => {
  it('글자는 책등 폭의 약 40%, 읽을 수 있는 8.5DU 아래로는 줄이지 않는다', () => {
    expect(spineTitleLayout('모순', 188, 27.7, 0.5).fontSize).toBe(11);
    expect(spineTitleLayout('흰', 188, 21, 0.5).fontSize).toBe(8.5);
  });
  it('짧은 제목은 넉넉한 간격(1.5배), 긴 제목은 간격부터 줄인다', () => {
    expect(spineTitleLayout('데미안', 225, 24.6, 0.5).pitch).toBe(1.5);
    expect(spineTitleLayout('달러구트 꿈 백화점', 205, 27.5, 0.65).pitch).toBeLessThan(1.5);
  });
});
