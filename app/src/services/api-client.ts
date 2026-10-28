// 서버 JSON 요청과 오류 형식을 한곳에서 처리한다.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApiClient(base: string | undefined) {
  return async function api<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    if (!base) throw new Error('서버 주소가 설정되지 않았어요');
    const hasBody = body !== undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        let code = 'http';
        let message = `서버 응답 ${res.status}`;
        try {
          const json = (await res.json()) as { error?: { code?: string; message?: string } };
          code = json.error?.code ?? code;
          message = json.error?.message ?? message;
        } catch {
          // 서버가 JSON 오류 본문을 보내지 않을 수 있다.
        }
        throw new ApiError(res.status, code, message);
      }
      return (res.status === 204 ? undefined : await res.json()) as T;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('서버 응답 시간이 초과됐어요. 다시 시도해 주세요.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
