import { coverTitleLayout, COVER_LINE_H, COVER_SPACE, COVER_TRACK } from '../title-layout';

describe('cover print area with unusually long titles', () => {
  it.each([
    '아주 긴 제목의 책도 마지막 단어까지 편안하게 읽을 수 있는지 확인하는 어느 독서가의 조용한 오후',
    '띄어쓰기가없는매우긴제목도책표지밖으로벗어나서잘리지않고온전하게남아야한다',
  ])('keeps the full text inside the cover: %s', (title) => {
    const result = coverTitleLayout(title, 103, 152);
    const width = (line: string) => [...line].reduce((sum, ch) => sum + (ch === ' ' ? COVER_SPACE : 0.91 + COVER_TRACK), 0) * result.fontSize;
    expect(result.lines.join(' ')).toBe(title);
    expect(Math.max(...result.lines.map(width))).toBeLessThanOrEqual(103 * 0.86);
    expect(result.fontSize * result.lines.length * COVER_LINE_H).toBeLessThanOrEqual(152 * 0.3);
  });
});
