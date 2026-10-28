import { libraryStore } from './library-store';
import { readingStore, type FinishDraft } from './reading-store';

// 기록이 디스크에 저장되기 전에는 복구용 초안을 지우지 않는다. 재시도 시에도 같은 세션 id를 쓴다.
export async function saveFinishedReading(draft: FinishDraft, options: { pagesRead?: number; memo?: string }) {
  const book = draft.myBookId ? libraryStore.get().lib.books[draft.myBookId] : undefined;
  libraryStore.addSession({ id: draft.id, myBookId: draft.myBookId, startedAt: draft.startedAt, endedAt: draft.endedAt, durationMs: draft.durationMs, ...options });
  if (book?.status === 'want') libraryStore.setStatus(book.id, 'reading');
  await libraryStore.flushPending();
  await readingStore.clearPending();
}
