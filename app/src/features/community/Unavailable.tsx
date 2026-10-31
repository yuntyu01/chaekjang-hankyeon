// 커뮤니티를 쓸 수 없을 때(서버 없는 빌드·예전 서버·연결 실패): 이유와 다음 행동만. 예시 게시물을 실제처럼 채우지 않는다
import type { Availability } from '@/services/community';
import { Empty } from '@/ui/kit';

export function Unavailable({ a, onRetry }: { a: Extract<Availability, { ok: false }>; onRetry: () => void }) {
  const title = a.reason === 'no-server' ? '이 빌드에서는 커뮤니티를 쓸 수 없어요' : a.reason === 'old-server' ? '커뮤니티 준비 중이에요' : '커뮤니티에 연결하지 못했어요';
  return <Empty title={title} body={a.message} action={a.reason === 'no-server' ? undefined : '다시 시도'} onAction={onRetry} actionKind="secondary" />;
}
