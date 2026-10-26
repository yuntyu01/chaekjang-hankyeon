// 끄는 동안 미리보기의 넘어짐 붙잡기(preview-hold): 넘어짐이 바뀌는 미리보기는 손가락이 HOLD_DU 넘게 가거나 멈춘 뒤에만 받아들인다.
import type { ShelfLayout } from '@/domain/types';
import { fallSig, HOLD_DU, stepHold, type Hold } from '@/ui/shelf/preview-hold';

const base: ShelfLayout = {
  version: 2,
  shelves: [{ id: 's', order: 0 }],
  placements: [
    { bookId: 'a', shelfId: 's', order: 0, pose: 'spine', tilt: 0 },
    { bookId: 'b', shelfId: 's', order: 1, pose: 'spine', tilt: 7 },
    { bookId: 'c', shelfId: 's', order: 2, pose: 'spine', tilt: 0 },
  ],
  drawer: [],
} as ShelfLayout;

describe('fallSig', () => {
  it('끄는 책 말고 자세가 바뀐 책과 새로 서랍에 들어간 책', () => {
    const next = {
      ...base,
      placements: base.placements.filter((p) => p.bookId !== 'c').map((p) => (p.bookId === 'b' ? { ...p, pose: 'horizontal' as const } : p.bookId === 'a' ? { ...p, pose: 'horizontal' as const } : p)),
      drawer: ['c'],
    } as ShelfLayout;
    expect(fallSig(base, next, 'a')).toBe('b:horizontal,c:drawer');
    expect(fallSig(base, base, 'a')).toBe('');
    expect(fallSig(base, null, 'a')).toBe('');
  });
});

describe('stepHold', () => {
  const run = (h: Hold, steps: [string, number][]) => {
    const shown: string[] = [];
    let cur = h;
    for (const [sig, x] of steps) {
      const r = stepHold(cur, sig, x);
      cur = r.hold;
      shown.push(cur.sig);
    }
    return shown;
  };

  it('같은 넘어짐이면 바로 받아들인다', () => {
    expect(stepHold({ sig: '', at: 0 }, '', 0.5)).toEqual({ take: true, hold: { sig: '', at: 0.5 } });
  });

  it('1DU 안에서 켜졌다 꺼지는 넘어짐은 보이지 않는다', () => {
    expect(run({ sig: '', at: 0 }, [['', 0.5], ['b:horizontal', 1], ['', 1.5], ['b:horizontal', 2], ['', 2.5]])).toEqual(['', '', '', '', '']);
  });

  it('마지막으로 받아들인 자리에서 HOLD_DU를 넘게 이어지면 받아들인다', () => {
    const steps: [string, number][] = [['', 0]];
    for (let x = 0.5; x <= HOLD_DU; x += 0.5) steps.push(['b:horizontal', x]);
    const shown = run({ sig: '', at: 0 }, steps);
    expect(shown[shown.length - 2]).toBe('');
    expect(shown[shown.length - 1]).toBe('b:horizontal');
  });

  it('손가락이 멈춰 있으면(rest) 바로 받아들인다', () => {
    expect(stepHold({ sig: '', at: 0 }, 'b:horizontal', 1, true)).toEqual({ take: true, hold: { sig: 'b:horizontal', at: 1 } });
  });
});
