import { readPeriod } from '../book-share';
import { keepAll } from '@/ui/keep-all';


describe('책 공유 카드', () => {
  it('읽은 기간: 같은 해면 끝은 월.일만, 해를 넘기면 끝도 해까지', () => {
    expect(readPeriod('2026-10-12', '2026-11-05')).toBe('2026.10.12 — 11.05');
    expect(readPeriod('2025-12-30', '2026-01-04')).toBe('2025.12.30 — 2026.01.04');
    expect(readPeriod('2026-10-12', undefined, true)).toBe('2026.10.12부터');
    expect(readPeriod(undefined, '2026-11-05')).toBe('2026.11.05 완독');
    expect(readPeriod()).toBeUndefined();
  });
  it('낱말 단위 줄바꿈: 낱말 안 글자 사이에만 단어 이음표, 띄어쓰기는 그대로', () => {
    const t = keepAll('여러 번  다시');
    expect(t.replace(/⁠/g, '')).toBe('여러 번  다시');
    expect(t.split('⁠').length - 1).toBe(2); // 여·러, 다·시
    expect(keepAll('')).toBe('');
  });
});
