import { inkFor, shade } from '../color';
import { layoutVerticalTitle } from '../title-layout';

describe('세로 제목 조판', () => {
  it('짧은 제목은 한 열', () => {
    expect(layoutVerticalTitle('모순', 90, 34, [13, 11])).toEqual({ fontSize: 13, columns: ['모순'] });
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
