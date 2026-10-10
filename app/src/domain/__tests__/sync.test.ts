import { emptyLibrary, type Library } from '../library';
import { buildPush, dirtyKey, fileIdOf, fullDirty, mergeRemote, type PullBody } from '../sync';

const DIR = 'file:///docs/images/';
const T1 = '2026-10-05T01:00:00.000Z';
const T2 = '2026-10-05T02:00:00.000Z';
const T3 = '2026-10-05T03:00:00.000Z';

const lib = (): Library => ({
  ...emptyLibrary(),
  editions: { ed1: { id: 'ed1', isbn13: '9788937462788', title: '채식주의자', authors: ['한강', '번역가'], size: { widthMm: 128, heightMm: 205 }, coverUri: `${DIR}cover_a.jpg`, coverSource: 'photo', source: 'photo', createdAt: T1, updatedAt: T1,
    art: { baseColor: '#6B7F92', inkColor: '#F7EEDC', accentColor: '#C9A46A', motifId: 'moon', layoutVariant: 'spine_b', heightClass: 'tall', thicknessClass: 'medium', generatedAt: T1, version: 1 } } },
  books: { bk1: { id: 'bk1', editionId: 'ed1', status: 'read', bindingId: 'bd1', createdAt: T1, updatedAt: T1 } },
  bindings: { bd1: { id: 'bd1', myBookId: 'bk1', spineColor: '#6B7F92', motif: 'moon', layout: 'spine_b', material: 'cloth', coverArtId: 'moon-lake', source: 'custom', status: 'ready', seed: 0, createdAt: T1, updatedAt: T1 } },
  bookmarks: { bm1: { id: 'bm1', myBookId: 'bk1', text: '', photoUri: `${DIR}page_x1.jpg`, photoRatio: 1.32, createdAt: T1, updatedAt: T1 } },
});
const emptyPull = (p: Partial<PullBody> = {}): PullBody => ({ rev: 1, more: false, editions: [], books: [], bindings: [], rounds: [], sessions: [], bookmarks: [], layout: null, ...p });

describe('올리기 변환', () => {
  it('사진 갈피·직접 찍은 표지는 파일 이름을 파일 id로 올린다', () => {
    const { body, count } = buildPush(lib(), fullDirty(lib()), DIR);
    expect(count).toBe(4);
    expect(body.bookmarks![0]).toMatchObject({ photoFileId: 'page_x1.jpg', text: '', photoRatio: 1.32 });
    expect(body.editions![0]).toMatchObject({ coverFileId: 'cover_a.jpg', coverSource: 'photo', widthMm: 128, heightMm: 205, authors: ['한강', '번역가'] });
    expect(body.editions![0].art).toMatchObject({ motifId: 'moon', layoutVariant: 'spine_b' });
    expect(body.bindings![0]).toMatchObject({ source: 'custom', layout: 'spine_b', material: 'cloth' });
  });
  it('삭제는 삭제 표시로, 이미 없고 삭제도 아닌 항목은 건너뛴다', () => {
    const dirty = { [dirtyKey('bookmarks', 'gone')]: { deleted: true, at: T2 }, [dirtyKey('rounds', 'ghost')]: { deleted: false, at: T2 } };
    const { body, count } = buildPush(lib(), dirty, DIR);
    expect(count).toBe(1);
    expect(body.bookmarks).toEqual([{ id: 'gone', deleted: true, updatedAt: T2 }]);
    expect(body.rounds).toEqual([]);
  });
  it('파일 id는 앱 보관 폴더 안 안전한 이름만', () => {
    expect(fileIdOf(`${DIR}a.jpg`, DIR)).toBe('a.jpg');
    expect(fileIdOf('file:///elsewhere/a.jpg', DIR)).toBeUndefined();
    expect(fileIdOf(`${DIR}../x.jpg`, DIR)).toBeUndefined();
    expect(fileIdOf(undefined, DIR)).toBeUndefined();
  });
});

describe('받은 변경 병합', () => {
  const remoteBookmark = (updatedAt: string, text = '서버') => ({ id: 'bm1', myBookId: 'bk1', text, photoFileId: 'page_x1.jpg', photoRatio: 1.32, createdAt: T1, updatedAt, deleted: false });
  it('서버가 더 새로우면 서버 값, 오래되면 이 기기 값을 유지', () => {
    const newer = mergeRemote(lib(), emptyPull({ bookmarks: [remoteBookmark(T2)] }), DIR);
    expect(newer.lib.bookmarks.bm1.text).toBe('서버');
    expect(newer.writes).toHaveLength(1);
    const same = mergeRemote(lib(), emptyPull({ bookmarks: [remoteBookmark(T1)] }), DIR);
    expect(same.lib.bookmarks.bm1.text).toBe('');
    expect(same.writes).toHaveLength(0);
  });
  it('같은 시각을 다른 표기(…:00Z / …:00.000Z)로 받아도 같은 시각으로 본다', () => {
    const m = mergeRemote(lib(), emptyPull({ bookmarks: [{ id: 'bm1', myBookId: 'bk1', text: '서버', createdAt: T1, updatedAt: '2026-10-05T01:00:00Z', deleted: false }] }), DIR);
    expect(m.writes).toHaveLength(0);
  });
  it('서버의 삭제 표시는 더 새로울 때만 지운다', () => {
    const gone = mergeRemote(lib(), emptyPull({ bookmarks: [{ id: 'bm1', deleted: true, updatedAt: T2 }] }), DIR);
    expect(gone.lib.bookmarks.bm1).toBeUndefined();
    expect(gone.erases).toEqual([{ kind: 'bookmarks', id: 'bm1' }]);
    const local = lib();
    local.bookmarks.bm1 = { ...local.bookmarks.bm1, updatedAt: T3 };
    expect(mergeRemote(local, emptyPull({ bookmarks: [{ id: 'bm1', deleted: true, updatedAt: T2 }] }), DIR).lib.bookmarks.bm1).toBeDefined();
  });
  it('다른 기기에서 만든 사진 갈피·표지: 받아 와야 할 파일과 로컬 주소', () => {
    const m = mergeRemote(emptyLibrary(), emptyPull({
      editions: [{ id: 'e9', title: '새 책', authors: ['저자'], widthMm: 120, heightMm: 190, coverFileId: 'cover_z.jpg', coverSource: 'photo', source: 'photo', updatedAt: T2, createdAt: T2, deleted: false }],
      bookmarks: [{ id: 'm9', myBookId: 'b9', text: '', photoFileId: 'page_z.jpg', photoRatio: 1.5, createdAt: T2, updatedAt: T2, deleted: false }],
    }), DIR);
    expect(m.lib.bookmarks.m9.photoUri).toBe(`${DIR}page_z.jpg`);
    expect(m.lib.editions.e9.coverUri).toBe(`${DIR}cover_z.jpg`);
    expect(m.files.sort()).toEqual(['cover_z.jpg', 'page_z.jpg']);
  });
  it('장정 재질: 세 값만 받고 모르는 값·빈 값은 없음(무광 종이)으로', () => {
    const bd = (material: string | null | undefined, id: string) => ({ id, myBookId: 'bk1', spineColor: '#6B7F92', motif: 'moon', material, source: 'custom', status: 'ready', createdAt: T1, updatedAt: T2, deleted: false });
    const m = mergeRemote(emptyLibrary(), emptyPull({ bindings: [bd('coated', 'a'), bd('metal', 'b'), bd(null, 'c'), bd(undefined, 'd')] }), DIR).lib;
    expect(m.bindings.a.material).toBe('coated');
    expect(m.bindings.b.material).toBeUndefined();
    expect(m.bindings.c.material).toBeUndefined();
    expect(m.bindings.d.material).toBeUndefined();
  });
  it('표지 그림 id: 아는 그림만 받고 모르는 값·빈 값은 없음(단색 정면)으로', () => {
    const bd = (coverArtId: string | null | undefined, id: string) => ({ id, myBookId: 'bk1', spineColor: '#6B7F92', motif: 'moon', coverArtId, source: 'custom', status: 'ready', createdAt: T1, updatedAt: T2, deleted: false });
    const m = mergeRemote(emptyLibrary(), emptyPull({ bindings: [bd('winter-forest', 'a'), bd('mars', 'b'), bd(null, 'c'), bd(undefined, 'd')] }), DIR).lib;
    expect(m.bindings.a.coverArtId).toBe('winter-forest');
    expect(m.bindings.b.coverArtId).toBeUndefined();
    expect(m.bindings.c.coverArtId).toBeUndefined();
    expect(m.bindings.d.coverArtId).toBeUndefined();
  });
  it('올렸다 받은 서재는 같은 모양으로 돌아온다(왕복)', () => {
    const original = lib();
    const wire = buildPush(original, fullDirty(original), DIR).body;
    const back = mergeRemote(emptyLibrary(), emptyPull({
      editions: wire.editions!.map((e) => ({ ...e, deleted: false })), books: wire.books!, bindings: wire.bindings!, bookmarks: wire.bookmarks!,
    }), DIR).lib;
    expect(back.editions.ed1).toMatchObject({ title: '채식주의자', authors: ['한강', '번역가'], size: { widthMm: 128, heightMm: 205 }, coverUri: `${DIR}cover_a.jpg` });
    expect(back.editions.ed1.art).toMatchObject({ baseColor: '#6B7F92', motifId: 'moon', layoutVariant: 'spine_b' });
    expect(back.bindings.bd1).toMatchObject({ source: 'custom', motif: 'moon', layout: 'spine_b', material: 'cloth', coverArtId: 'moon-lake' });
    expect(back.bookmarks.bm1).toMatchObject({ text: '', photoUri: `${DIR}page_x1.jpg`, photoRatio: 1.32 });
  });
});
