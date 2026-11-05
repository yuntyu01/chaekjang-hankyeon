import { BOARD_MAX_SCALE, BOARD_MIN_SCALE, boardBookIds, boardPageSlide, boardResized, boardZoomAt, BOARD_CARD_W, BOARD_MAX_W, BOARD_MIN_W, dotWindow, boardBounds, boardCardSize, boardClamp, boardFit, boardFreeSpot, boardRotOf, boardSpots } from '../bookmark-board';

const at = (n: number) => `2026-10-${String(n).padStart(2, '0')}T00:00:00.000Z`;
const mk = (n: number, more: object = {}) => ({ id: `m${n}`, text: '천천히 읽어야 보이는 문장이 있다.', createdAt: at(n), ...more });
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

describe('갈피 보드 자동 배치', () => {
  it('자동으로 놓인 갈피끼리 겹치지 않고 빠지지 않는다', () => {
    const spots = boardSpots(Array.from({ length: 30 }, (_, i) => mk(i + 1, i % 3 === 0 ? { text: '긴 문장 '.repeat(30) } : {})));
    expect(spots).toHaveLength(30);
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(overlap(spots[i], spots[j])).toBe(false);
  });
  it('갈피가 늘어도 이미 놓인 갈피는 움직이지 않는다', () => {
    const a = boardSpots([mk(1), mk(2), mk(3)]);
    const b = boardSpots([mk(1), mk(2), mk(3), mk(4), mk(5)]);
    for (const s of a) expect(b.find((o) => o.id === s.id)).toEqual(s);
  });
  it('한 장을 손으로 옮겨도 다른 갈피는 그 자리에 있다', () => {
    const a = boardSpots([mk(1), mk(2), mk(3), mk(4)]);
    const b = boardSpots([mk(1), mk(2, { boardX: 900, boardY: 900, boardRot: 1 }), mk(3), mk(4)]);
    for (const id of ['m1', 'm3', 'm4']) expect(b.find((o) => o.id === id)).toEqual(a.find((o) => o.id === id));
    expect(b.find((o) => o.id === 'm2')).toMatchObject({ x: 900, y: 900, rot: 1, placed: true });
  });
  it('새 갈피는 손으로 옮겨 둔 갈피를 덮지 않는다', () => {
    const first = boardSpots([mk(1)])[0];
    const spots = boardSpots([mk(1, { boardX: first.x + 250, boardY: first.y + 200 }), mk(2), mk(3)]);
    const moved = spots.find((s) => s.id === 'm1')!;
    for (const s of spots) if (s.id !== 'm1') expect(overlap(s, moved)).toBe(false);
  });
  it('기울기는 갈피마다 정해져 있고 크지 않다', () => {
    expect(boardRotOf('abc')).toBe(boardRotOf('abc'));
    for (let i = 0; i < 50; i++) expect(Math.abs(boardRotOf(`b${i}`))).toBeLessThanOrEqual(3.2);
  });
  it('사진 갈피는 인화지 크기, 긴 글은 줄 수 한도까지만 커진다', () => {
    expect(boardCardSize({ text: '', photoUri: 'x', photoRatio: 1.5 }).h).toBeLessThan(boardCardSize({ text: '', photoUri: 'x', photoRatio: 0.9 }).h);
    expect(boardCardSize({ text: '가'.repeat(900) }).h).toBe(boardCardSize({ text: '가'.repeat(2000) }).h);
  });
});

describe('갈피 보드 보기', () => {
  const spots = boardSpots(Array.from({ length: 12 }, (_, i) => mk(i + 1)));
  const VW = 390;
  const VH = 620;
  it('전체 보기: 모든 갈피가 화면 안에 들어오고 원래 크기보다 키우지 않는다', () => {
    const v = boardFit(spots, VW, VH);
    const b = boardBounds(spots);
    expect(v.s).toBeLessThanOrEqual(1);
    expect(b.x0 * v.s + v.x).toBeGreaterThanOrEqual(0);
    expect(b.x1 * v.s + v.x).toBeLessThanOrEqual(VW);
    expect(b.y1 * v.s + v.y).toBeLessThanOrEqual(VH);
    expect(boardFit([spots[0]], VW, VH).s).toBe(1);
  });
  it('전체 보기: 아래 버튼 줄이 덮는 자리에는 갈피를 두지 않는다', () => {
    const b = boardBounds(spots);
    const BAR = 94;
    const v = boardFit(spots, VW, VH, BAR);
    expect(b.y1 * v.s + v.y).toBeLessThanOrEqual(VH - BAR);
    expect(b.y0 * v.s + v.y).toBeGreaterThanOrEqual(0);
    // 카드 몇 장뿐이면 크기를 줄이지 않고 남은 자리 가운데에
    const few = spots.slice(0, 1);
    const w = boardFit(few, VW, VH, BAR);
    const fb = boardBounds(few);
    expect(w.s).toBe(1);
    expect(fb.y1 + w.y).toBeLessThanOrEqual(VH - BAR);
  });
  it('이동·확대 한도: 배율은 범위 안, 갈피가 화면에서 사라지지 않는다', () => {
    const b = boardBounds(spots);
    expect(boardClamp({ x: 0, y: 0, s: 99 }, b, VW, VH).s).toBe(BOARD_MAX_SCALE);
    expect(boardClamp({ x: 0, y: 0, s: 0.01 }, b, VW, VH).s).toBe(BOARD_MIN_SCALE);
    const far = boardClamp({ x: 99999, y: 99999, s: 1 }, b, VW, VH);
    expect(far.x + b.x0).toBeLessThanOrEqual(VW);
    expect(far.y + b.y0).toBeLessThanOrEqual(VH);
    const back = boardClamp({ x: -99999, y: -99999, s: 1 }, b, VW, VH);
    expect(back.x + b.x1).toBeGreaterThanOrEqual(0);
  });
  it('빈 자리: 지금 보이는 곳에서 다른 갈피와 겹치지 않는 곳', () => {
    const v = boardFit(spots.slice(0, 2), VW, VH);
    const size = { w: 216, h: 130 };
    const p = boardFreeSpot(spots.slice(0, 2), v, VW, VH, size);
    for (const s of spots.slice(0, 2)) expect(overlap({ ...p, ...size }, s)).toBe(false);
  });
  it('빈 곳이 없으면 가운데', () => {
    const v = { x: 0, y: 0, s: 1 };
    const wall = [{ x: 195, y: 310, w: 2000, h: 2000 }];
    expect(boardFreeSpot(wall, v, VW, VH, { w: 216, h: 130 })).toEqual({ x: 195, y: 310 });
  });
});

describe('옆 책으로 넘기기', () => {
  const lib = {
    books: { a: {}, b: {}, c: {} },
    bookmarks: {
      m1: { myBookId: 'a', createdAt: '2026-11-01' },
      m2: { myBookId: 'b', createdAt: '2026-11-03' },
      m3: { myBookId: 'a', createdAt: '2026-11-02' },
      m4: { myBookId: 'gone', createdAt: '2026-11-04' },
    },
  } as unknown as Parameters<typeof boardBookIds>[0];

  it('책 순서는 최근 갈피 순이고 지운 책은 뺀다', () => {
    expect(boardBookIds(lib, 'a')).toEqual(['b', 'a']);
  });
  it('갈피가 없는 책으로 열어도 그 책이 들어간다', () => {
    expect(boardBookIds(lib, 'c')).toEqual(['c', 'b', 'a']);
  });

  const wide = { x0: 0, x1: 1000 }; // 화면 360보다 넓다
  it('보드가 화면에 다 들어오면 가로 끌기는 전부 넘기기다', () => {
    expect(boardPageSlide(40, -30, 0.5, { x0: 0, x1: 500 }, 360)).toEqual({ x: 40, left: -30 });
  });
  it('보드가 더 넓으면 끝에 닿을 때까지 보드가 움직이고 남은 만큼만 넘긴다', () => {
    // x 범위: 360-16-1000=-656 ~ 16
    expect(boardPageSlide(0, -100, 1, wide, 360)).toEqual({ x: -100, left: 0 });
    expect(boardPageSlide(-650, -20, 1, wide, 360)).toEqual({ x: -656, left: -14 });
    expect(boardPageSlide(10, 20, 1, wide, 360)).toEqual({ x: 16, left: 14 });
  });
  it('범위 밖에 있던 보드는 튀어 들어오지 않는다', () => {
    expect(boardPageSlide(100, 20, 1, wide, 360)).toEqual({ x: 100, left: 20 });
    expect(boardPageSlide(100, -20, 1, wide, 360)).toEqual({ x: 80, left: 0 });
  });
  it('점은 많으면 지금 칸을 가운데 두고 잘린다', () => {
    expect(dotWindow(3, 2, 7)).toEqual({ from: 0, to: 3 });
    expect(dotWindow(20, 0, 7)).toEqual({ from: 0, to: 7 });
    expect(dotWindow(20, 10, 7)).toEqual({ from: 7, to: 14 });
    expect(dotWindow(20, 19, 7)).toEqual({ from: 13, to: 20 });
  });
});

describe('카드 크기 바꾸기', () => {
  const text = '가'.repeat(46);
  it('기본 폭은 그대로이고 넓히면 줄이 줄어 낮아진다', () => {
    const base = boardCardSize({ text });
    expect(base.w).toBe(BOARD_CARD_W);
    const wide = boardCardSize({ text, boardW: 400 });
    expect(wide.w).toBe(400);
    expect(wide.h).toBeLessThan(base.h);
    expect(boardCardSize({ text, boardW: 160 }).h).toBeGreaterThan(base.h);
  });
  it('범위 밖 폭은 잘린다', () => {
    expect(boardCardSize({ text, boardW: 9999 }).w).toBe(BOARD_MAX_W);
    expect(boardCardSize({ text, boardW: 1 }).w).toBe(BOARD_MIN_W);
  });
  it('사진은 폭에 맞춰 커진다', () => {
    const small = boardCardSize({ text: '', photoUri: 'x', photoRatio: 1 });
    const big = boardCardSize({ text: '', photoUri: 'x', photoRatio: 1, boardW: 396 });
    expect(big.h - small.h).toBe(180);
  });
  it('폭을 바꿔도 왼쪽 위 모서리는 그대로다', () => {
    const size = boardCardSize({ text });
    const spot = { id: 'a', ...size, x: 100, y: 200, rot: 2, placed: true };
    const r = boardResized({ text }, spot, 320);
    const next = boardCardSize({ text, boardW: r.boardW });
    expect(r.boardX - next.w / 2).toBeCloseTo(100 - size.w / 2);
    expect(r.boardY - next.h / 2).toBeCloseTo(200 - size.h / 2);
    expect(r.boardRot).toBe(2);
  });
  it('폭을 바꾼 카드는 보드 범위에도 반영된다', () => {
    const [s] = boardSpots([mk(1, { boardX: 0, boardY: 0, boardW: 400 })]);
    expect(s.w).toBe(400);
    expect(boardBounds([s]).x1).toBe(200);
  });
  it('보드를 넓혀도 기준점은 화면에서 그대로다', () => {
    const v = { x: 50, y: 80, s: 0.8 };
    const n = boardZoomAt(v, 0.5, 200, 300);
    expect(n.s).toBeCloseTo(0.4);
    const boardX = (200 - v.x) / v.s;
    expect(n.x + boardX * n.s).toBeCloseTo(200);
  });
});
