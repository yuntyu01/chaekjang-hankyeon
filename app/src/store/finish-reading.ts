import { libraryStore } from './library-store';
import { readingStore, type FinishDraft } from './reading-store';

// 기록이 디스크에 저장되기 전에는 복구용 초안을 지우지 않는다. 재시도 시에도 같은 세션 id를 쓴다.
export async function saveFinishedReading(draft: FinishDraft, options: { pagesRead?: number; memo?: string }) {
  // 회차 확보(처음 읽는 책이면 1회차·읽는 중)와 세션 연결을 한 번에 기록한다(domain addSessionTo)
  libraryStore.addSession({ id: draft.id, myBookId: draft.myBookId, startedAt: draft.startedAt, endedAt: draft.endedAt, durationMs: draft.durationMs, ...options });
  await libraryStore.flushPending();
  await readingStore.clearPending();
}
