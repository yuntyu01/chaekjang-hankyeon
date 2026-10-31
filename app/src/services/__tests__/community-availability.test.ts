// 커뮤니티 사용 가능 판단: 서버 주소 없음 / 예전 서버(healthz에 community 없음) / 연결 실패(다음에 다시 확인) / 사용 가능
jest.mock('@/services/sync', () => ({ serverBase: 'http://server.test', serverToken: async () => 'tok' }));

type Avail = typeof import('../community');
const fresh = (): Avail => {
  let m!: Avail;
  jest.isolateModules(() => { m = require('../community') as Avail; });
  return m;
};
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);

afterEach(() => { (global as { fetch?: unknown }).fetch = undefined; });

it('예전 서버는 쓸 수 없음(가짜 피드 없음), 새 서버는 사용 가능', async () => {
  global.fetch = jest.fn(() => reply({ ok: true, books: 'yes24' })) as unknown as typeof fetch;
  expect(await fresh().communityAvailability()).toMatchObject({ ok: false, reason: 'old-server' });
  global.fetch = jest.fn(() => reply({ ok: true, community: true })) as unknown as typeof fetch;
  expect(await fresh().communityAvailability()).toEqual({ ok: true });
});

it('연결 실패는 기억하지 않고 다음에 다시 확인한다', async () => {
  const m = fresh();
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
  expect(await m.communityAvailability()).toMatchObject({ ok: false, reason: 'offline' });
  global.fetch = jest.fn(() => reply({ ok: true, community: true })) as unknown as typeof fetch;
  expect(await m.communityAvailability()).toEqual({ ok: true });
});

it('쓰기 오류 코드를 다음 행동으로 나눈다', () => {
  const { needsSocial, needsProfile, isNotFound } = require('../community') as Avail;
  const { ApiError } = require('../api-client') as typeof import('../api-client');
  expect(needsSocial(new ApiError(403, 'needs_social_account', ''))).toBe(true);
  expect(needsProfile(new ApiError(403, 'needs_profile', ''))).toBe(true);
  expect(isNotFound(new ApiError(404, 'not_found', ''))).toBe(true);
  expect(needsSocial(new Error('x'))).toBe(false);
});
