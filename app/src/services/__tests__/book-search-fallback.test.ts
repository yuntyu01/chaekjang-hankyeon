// 검색 실패 구분(2026-11): 우리 서버만 닿지 않으면 보완 검색, 모두 닿지 않으면 '인터넷 연결 없음', 취소한 검색은 빈 결과
type Mod = typeof import('../book-search');
const load = (): Mod => {
  let m!: Mod;
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.test';
    m = require('../book-search') as Mod;
  });
  return m;
};
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const google = { items: [{ id: 'g1', volumeInfo: { title: '데미안', authors: ['헤르만 헤세'] } }] };

afterEach(() => { delete process.env.EXPO_PUBLIC_API_URL; jest.restoreAllMocks(); });

it('우리 서버에 닿지 않아도 Google Books로 찾는다', async () => {
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).startsWith('https://api.test')) throw new TypeError('Network request failed');
    return ok(google);
  }) as never;
  const r = await load().searchBooks('데미안');
  expect(r.ok && r.items.map((i) => i.title)).toEqual(['데미안']);
  expect(r.ok && r.provider).toBe('Google Books');
});

it('모든 곳에 닿지 않으면 인터넷 연결 없음', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as never;
  const r = await load().searchBooks('데미안');
  expect(r).toMatchObject({ ok: false, reason: 'network' });
});

it('취소한 검색은 늦게 온 결과 대신 빈 결과', async () => {
  const c = new AbortController();
  global.fetch = jest.fn(async () => { c.abort(); return ok({ items: [{ isbn13: '9788937460449', title: '데미안', provider: 'yes24' }] }); }) as never;
  const r = await load().searchBooks('데미안', c.signal);
  expect(r).toEqual({ ok: true, items: [] });
});
