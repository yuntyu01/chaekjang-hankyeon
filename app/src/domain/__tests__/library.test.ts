// 내 서재 규칙: 읽기 상태와 회차(재독은 새 회차, 지난 기록은 그대로), 통계 기준(완독 권수·재독), 책장용 책 모양.
import { coverAtSize, isSpineImage } from '../cover-url';
import { bookLightRef, bookTone } from '../binding-material';
import { linearOf } from '../light-model';
import { ARTWORK_INK } from '../cover-artworks';
import { ensureShelves, pruneEmptyShelves } from '../layout-engine';
import { applyStatus, completions, defaultBinding, emptyLibrary, finishedYear, monthPeriod, pendingCoverEdges, periodStats, roundsOf, toShelfBook, withCoverEdges, yearPeriod, type Library, type Session } from '../library';
import { buildBookArt, edgeColorOf, REBIND_VERSION } from '../rebinding';
import { TITLE_LIGHT } from '../color';

function withBook(id = 'bk1'): Library {
  const lib = emptyLibrary();
  const t = '2026-03-01T09:00:00.000Z';
  lib.editions.ed1 = { id: 'ed1', title: '월든', authors: ['헨리 데이비드 소로'], source: 'manual', createdAt: t, updatedAt: t };
  const bd = defaultBinding(id, '월든', 0, t);
  lib.bindings[bd.id] = bd;
  lib.books[id] = { id, editionId: 'ed1', status: 'want', bindingId: bd.id, createdAt: t, updatedAt: t };
  return lib;
}

describe('읽기 상태와 회차', () => {
  it('읽는 중 → 완독 → 다시 읽기: 지난 회차는 그대로, 새 회차가 생긴다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'reading', '2026-03-02T10:00:00Z', '2026-03-02');
    expect(roundsOf(lib, 'bk1')).toHaveLength(1);
    lib = applyStatus(lib, 'bk1', 'read', '2026-03-20T10:00:00Z', '2026-03-20');
    const [r1] = roundsOf(lib, 'bk1');
    expect(r1).toMatchObject({ index: 1, startedAt: '2026-03-02', finishedAt: '2026-03-20' });
    lib = applyStatus(lib, 'bk1', 'reading', '2026-05-01T10:00:00Z', '2026-05-01');
    const rs = roundsOf(lib, 'bk1');
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual(r1);
    expect(rs[1]).toMatchObject({ index: 2, startedAt: '2026-05-01' });
    expect(rs[1].finishedAt).toBeUndefined();
  });

  it('보류했다가 다시 읽으면 같은 회차를 이어 간다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'reading', '2026-03-02T10:00:00Z', '2026-03-02');
    lib = applyStatus(lib, 'bk1', 'paused', '2026-03-05T10:00:00Z', '2026-03-05');
    lib = applyStatus(lib, 'bk1', 'reading', '2026-03-09T10:00:00Z', '2026-03-09');
    const rs = roundsOf(lib, 'bk1');
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ startedAt: '2026-03-02', paused: false });
  });

  it('읽기 전으로 되돌려도 완독 기록은 지우지 않는다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'read', '2026-03-20T10:00:00Z', '2026-03-20');
    lib = applyStatus(lib, 'bk1', 'want', '2026-03-21T10:00:00Z', '2026-03-21');
    expect(completions(lib, 'bk1')).toBe(1);
    expect(lib.books.bk1.status).toBe('want');
  });
});

describe('통계 기준', () => {
  it('같은 기간에 두 번 완독해도 1권, 재독은 따로 센다', () => {
    let lib = applyStatus(withBook(), 'bk1', 'read', '2026-03-10T10:00:00Z', '2026-03-10');
    lib = applyStatus(lib, 'bk1', 'reading', '2026-03-11T10:00:00Z', '2026-03-11');
    lib = applyStatus(lib, 'bk1', 'read', '2026-03-25T10:00:00Z', '2026-03-25');
    const st = periodStats(lib, monthPeriod(2026, 3));
    expect(st.completedCount).toBe(1);
    expect(st.rereads).toBe(1);
    expect(periodStats(lib, monthPeriod(2026, 4)).completedCount).toBe(0);
    expect(finishedYear(lib, 'bk1')).toBe(2026);
  });

  it('독서 시간은 저장한 세션의 실제 시간 합(일시정지 제외 값 그대로)', () => {
    const lib = withBook();
    const s = (id: string, start: string, ms: number): Session => ({ id, myBookId: 'bk1', startedAt: start, endedAt: start, durationMs: ms, createdAt: start, updatedAt: start });
    lib.sessions.a = s('a', '2026-03-03T12:00:00', 25 * 60000);
    lib.sessions.b = s('b', '2026-03-04T12:00:00', 10 * 60000);
    lib.sessions.c = s('c', '2026-04-01T12:00:00', 99 * 60000);
    const st = periodStats(lib, monthPeriod(2026, 3));
    expect(st.readMs).toBe(35 * 60000);
    expect(st.sessions.map((x) => x.id)).toEqual(['b', 'a']);
    expect(st.booksRead).toEqual(['bk1']);
    expect(periodStats(lib, yearPeriod(2026)).readMs).toBe(134 * 60000);
  });
});

describe('책장용 책 모양', () => {
  it('크기를 모르면 기본 크기로 그리지만 판본에는 비워 둔다', () => {
    const lib = withBook();
    const b = toShelfBook(lib, 'bk1')!;
    expect(b.physical).toEqual({ widthMm: 128, heightMm: 188, pages: 250 });
    expect(lib.editions.ed1.size).toBeUndefined();
    expect(lib.editions.ed1.pageCount).toBeUndefined();
    expect(b.themeColor).toBe(lib.bindings[lib.books.bk1.bindingId!].spineColor);
  });

  it('장정 재질은 책 모양까지 가고, 고르지 않았으면 비워 둔다(무광 종이)', () => {
    const lib = withBook();
    const bdId = lib.books.bk1.bindingId!;
    expect(lib.bindings[bdId].material).toBeUndefined();
    expect(toShelfBook(lib, 'bk1')!.art.material).toBeUndefined();
    lib.bindings[bdId] = { ...lib.bindings[bdId], material: 'cloth' };
    expect(toShelfBook(lib, 'bk1')!.art.material).toBe('cloth');
  });

  it('실제 표지가 있는 책은 정면 그림이 실제 표지(YES24는 L 크기), 기본 정면 그림을 고르면 그 그림이 앞선다', () => {
    const lib = withBook();
    const eId = lib.books.bk1.editionId;
    expect(toShelfBook(lib, 'bk1')!.coverArtUri).toBeUndefined(); // 표지 없는 책: 단색 정면
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'https://image.yes24.com/goods/176787/XL', coverSource: 'api' };
    expect(toShelfBook(lib, 'bk1')!.coverArtUri).toBe('https://image.yes24.com/goods/176787/L');
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'file:///photo.jpg', coverSource: 'photo' };
    expect(toShelfBook(lib, 'bk1')!.coverArtUri).toBe('file:///photo.jpg'); // 내가 찍은 사진은 그대로
    const bdId = lib.books.bk1.bindingId!;
    lib.bindings[bdId] = { ...lib.bindings[bdId], coverArtId: 'autumn-field' };
    expect(toShelfBook(lib, 'bk1')!.coverArtUri).toBeUndefined();
  });

  it('책등 그림은 YES24 책등, 기본 정면 그림을 골랐거나 색을 직접 바꾼 책은 책 색 + 제목', () => {
    const lib = withBook();
    const eId = lib.books.bk1.editionId;
    const bdId = lib.books.bk1.bindingId!;
    expect(toShelfBook(lib, 'bk1')!.spineArtUri).toBeUndefined(); // 표지 없는 책
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'https://image.yes24.com/goods/13137546/L', coverSource: 'api' };
    expect(toShelfBook(lib, 'bk1')!.spineArtUri).toBe('https://image.yes24.com/goods/13137546/SIDE/XL');
    const orig = lib.bindings[bdId];
    lib.bindings[bdId] = { ...orig, source: 'custom', spineColor: '#123456' };
    expect(toShelfBook(lib, 'bk1')!.spineArtUri).toBeUndefined();
    lib.bindings[bdId] = { ...orig, coverArtId: 'autumn-field' };
    expect(toShelfBook(lib, 'bk1')!.spineArtUri).toBeUndefined();
    lib.bindings[bdId] = orig;
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'file:///photo.jpg', coverSource: 'photo' };
    expect(toShelfBook(lib, 'bk1')!.spineArtUri).toBeUndefined(); // 내가 찍은 사진에는 책등이 없다
  });

  it('사진을 입힌 책은 빛 기준 색이 책 색과 상관없는 중간 회색 + 그림 표지(검정·순백 표지 색에서 사진 색이 왜곡되지 않게)', () => {
    const lib = withBook();
    const eId = lib.books.bk1.editionId;
    const bdId = lib.books.bk1.bindingId!;
    const plain = bookLightRef(toShelfBook(lib, 'bk1')!, linearOf);
    expect(plain.picture).toBe(false);
    expect(plain.albedo).toEqual(linearOf(bookTone(toShelfBook(lib, 'bk1')!)));
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'https://image.yes24.com/goods/1/L', coverSource: 'api' };
    for (const color of ['#0e0c08', '#ffffff']) {
      lib.bindings[bdId] = { ...lib.bindings[bdId], spineColor: color };
      expect(bookLightRef(toShelfBook(lib, 'bk1')!, linearOf)).toEqual({ albedo: [0.5, 0.5, 0.5], picture: true });
    }
  });

  it('책등 그림 판별: 좁고 긴 그림만 책등, 이미지 준비중(280×400)은 아니다', () => {
    expect(isSpineImage(36, 400)).toBe(true);
    expect(isSpineImage(64, 400)).toBe(true);
    expect(isSpineImage(280, 400)).toBe(false);
    expect(isSpineImage(0, 0)).toBe(false);
  });

  it('표지 가장자리 색: 아직 안 맞춘 검색 표지만 대상, 기본 장정만 바꾸고 고친 장정은 두며, 맞춘 뒤에는 다시 하지 않는다', () => {
    const lib = withBook();
    const eId = lib.books.bk1.editionId;
    const bdId = lib.books.bk1.bindingId!;
    expect(pendingCoverEdges(lib)).toEqual([]); // 표지 없는 책
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'file:///photo.jpg', coverSource: 'photo', art: { ...buildBookArt({ title: 'x' }), version: 1 } };
    expect(pendingCoverEdges(lib)).toEqual([]); // 내가 찍은 사진
    lib.editions[eId] = { ...lib.editions[eId], coverUri: 'https://image.yes24.com/goods/1/L', coverSource: 'api' };
    expect(pendingCoverEdges(lib)).toEqual([{ editionId: eId, coverUri: 'https://image.yes24.com/goods/1/L' }]);
    const motif = lib.editions[eId].art!.motifId;
    const custom = { ...lib, bindings: { ...lib.bindings, [bdId]: { ...lib.bindings[bdId], source: 'custom' as const, spineColor: '#123456' } } };
    expect(withCoverEdges(custom, [{ editionId: eId, color: '#101010' }], 't').bindings[bdId].spineColor).toBe('#123456');
    const done = withCoverEdges(lib, [{ editionId: eId, color: '#101010' }], 't');
    expect(done.bindings[bdId].spineColor).toBe('#101010');
    expect(done.bindings[bdId].inkColor).toBe(TITLE_LIGHT); // 어두운 책등에는 밝은 제목
    expect(done.editions[eId].art).toMatchObject({ baseColor: '#101010', motifId: motif, version: REBIND_VERSION });
    expect(toShelfBook(done, 'bk1')!.themeColor).toBe('#101010');
    expect(pendingCoverEdges(done)).toEqual([]);
  });

  it('새 책: 표지 가장자리 색이 있으면 길들이지 않고 그대로 책 색, 가장 넓은 색을 고른다', () => {
    expect(buildBookArt({ title: 'x', coverEdge: '#0A0A0A', seriesTitle: '시리즈' }).baseColor).toBe('#0A0A0A');
    const px = [...Array(30).fill([10, 10, 10, 255]).flat(), ...Array(10).fill([240, 240, 240, 255]).flat()];
    expect(edgeColorOf(px)).toBe('#0a0a0a');
    expect(edgeColorOf([])).toBeNull();
    expect(edgeColorOf(Array(40).fill([255, 255, 255, 255]).flat())).toBe('#ededed'); // 순백은 종이 흰색까지만(벽에 묻히지 않게)
  });

  it('coverAtSize: YES24 표지 주소만 크기를 바꾸고 다른 주소는 그대로', () => {
    expect(coverAtSize('https://image.yes24.com/goods/176787/L', 'XL')).toBe('https://image.yes24.com/goods/176787/XL');
    expect(coverAtSize('https://image.yes24.com/goods/176787/M', 'L')).toBe('https://image.yes24.com/goods/176787/L');
    expect(coverAtSize('https://books.google.com/x.jpg', 'XL')).toBe('https://books.google.com/x.jpg');
    expect(coverAtSize(undefined, 'XL')).toBeUndefined();
  });

  it('표지 그림을 고르면 정면에 그 그림을 입히고 책 색(책등·몸체)은 그대로, AI 표지 그림은 지우지 않고 가려 둔다', () => {
    const lib = withBook();
    const bdId = lib.books.bk1.bindingId!;
    const plain = toShelfBook(lib, 'bk1')!;
    expect(plain.cover).toBeUndefined();
    expect(plain.art.vectorCover).toBe(true);
    lib.bindings[bdId] = { ...lib.bindings[bdId], coverArtId: 'autumn-field', coverArtUri: 'file:///ai.png' };
    const b = toShelfBook(lib, 'bk1')!;
    expect(b.cover).toMatchObject({ artworkId: 'autumn-field', ink: ARTWORK_INK.dark, edge: lib.bindings[bdId].spineColor });
    expect(b.art.vectorCover).toBe(false);
    expect(b.themeColor).toBe(plain.themeColor);
    expect(bookTone(b)).toBe(bookTone(plain));
    expect(b.coverArtUri).toBeUndefined();
    expect(lib.bindings[bdId].coverArtUri).toBe('file:///ai.png');
    // 모르는 id(예전 앱·잘못된 값)는 단색 정면
    lib.bindings[bdId] = { ...lib.bindings[bdId], coverArtId: 'nope' as never };
    expect(toShelfBook(lib, 'bk1')!.cover).toBeUndefined();
  });

  it('기본 장정(재장정)은 입력이 같으면 같고 제목이 다르면 달라질 수 있다', () => {
    const a = defaultBinding('x', '월든', 0, '');
    const b = defaultBinding('y', '월든', 0, '');
    expect([a.spineColor, a.motif, a.layout]).toEqual([b.spineColor, b.motif, b.layout]);
    const titles = ['월든', '데미안', '어린 왕자', '채식주의자', '작별하지 않는다', '아무튼, 독서'];
    const variants = new Set(titles.map((t) => { const d = defaultBinding('x', t, 0, ''); return d.spineColor + d.motif; }));
    expect(variants.size).toBeGreaterThan(1);
  });
  it('사진 갈피는 사진 파일과 비율을 함께 저장한다', () => {
    const t = '2026-10-05T00:00:00.000Z';
    const lib = { ...emptyLibrary(), bookmarks: { m1: { id: 'm1', myBookId: 'bk1', text: '', photoUri: 'file:///p.jpg', photoRatio: 1.33, createdAt: t, updatedAt: t } } };
    expect(lib.bookmarks.m1.photoUri).toBe('file:///p.jpg');
    expect(JSON.parse(JSON.stringify(lib)).bookmarks.m1.photoRatio).toBe(1.33);
  });
});

describe('선반 수', () => {
  it('빈 책장은 선반 3개로 시작하고, 빈 선반 정리는 3개 밑으로 줄이지 않으며 책 있는 선반을 지우지 않는다', () => {
    const empty = ensureShelves({ version: 2, shelves: [], placements: [], drawer: [] });
    expect(empty.shelves).toHaveLength(3);
    const five = ensureShelves({ ...empty, shelves: [...empty.shelves, { id: 's4', order: 3 }, { id: 's5', order: 4 }], placements: [{ bookId: 'a', shelfId: 's5', order: 0, pose: 'spine', tilt: 0 }] });
    const pruned = pruneEmptyShelves(five);
    expect(pruned.shelves.map((s) => s.id)).toContain('s5');
    expect(pruned.shelves).toHaveLength(3);
    expect(pruned.placements[0].shelfId).toBe('s5');
    expect(pruneEmptyShelves(empty).shelves).toHaveLength(3);
  });
});
