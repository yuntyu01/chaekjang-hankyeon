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

describe('앞표지 제목', () => {
  it('짧은 제목(월든)은 크게 한 줄', () => {
    const r = coverTitleLayout('월든', 116, 172);
    expect(r.lines).toEqual(['월든']);
    expect(r.fontSize).toBeGreaterThanOrEqual(17);
  });
  it('긴 제목(우리가 빛의 속도로 갈 수 없다면)은 단어를 깨지 않고 줄을 나눠 두 줄 때보다 크게', () => {
    const r = coverTitleLayout('우리가 빛의 속도로 갈 수 없다면', 103, 152);
    expect(r.lines.length).toBeGreaterThanOrEqual(2);
    expect(r.lines.join(' ')).toBe('우리가 빛의 속도로 갈 수 없다면');
    expect(r.fontSize).toBeGreaterThan(10.5);
  });
});

describe('책등 제목 크기는 길이에 따라', () => {
  it('짧은 제목은 크게, 긴 제목만 줄인다', () => {
    const short = spineTitleLayout('아몬드', 156, 26, 0.58);
    const long = spineTitleLayout('달러구트 꿈 백화점', 160, 27, 0.58);
    expect(short.fontSize).toBeGreaterThanOrEqual(12.5);
    expect(long.fontSize).toBeGreaterThanOrEqual(10);
    expect(long.fontSize).toBeLessThan(short.fontSize);
  });
});
