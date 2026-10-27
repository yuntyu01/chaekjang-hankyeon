import { ApiError, createApiClient } from '../api-client';

describe('api client', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the token and JSON body and returns the response', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    const api = createApiClient('https://example.test');
    await expect(api('POST', '/sync/push', 'token', { count: 0 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/sync/push', {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: '{"count":0}',
    });
  });

  it('preserves server errors for retry decisions', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: 'missing_reference', message: 'missing' } }) } as Response);
    const api = createApiClient('https://example.test');
    await expect(api('POST', '/sync/push', 'token')).rejects.toMatchObject({ status: 409, code: 'missing_reference', message: 'missing' } satisfies Partial<ApiError>);
  });

  it('handles an empty response and a non-JSON error', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new Error('not JSON'); } } as unknown as Response);
    const api = createApiClient('https://example.test');
    await expect(api('PUT', '/file', null)).resolves.toBeUndefined();
    await expect(api('GET', '/file', null)).rejects.toMatchObject({ status: 503, code: 'http', message: '서버 응답 503' });
  });
});
