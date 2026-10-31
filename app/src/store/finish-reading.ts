import { libraryStore } from './library-store';
import { readingStore, type FinishDraft } from './reading-store';

// 기록이 디스크에 저장되기 전에는 복구용 초안을 지우지 않는다. 재시도 시에도 같은 세션 id를 쓴다.
// startPage: 이번 독서를 시작한 쪽, pagesRead: 도달한 쪽(예전과 같은 뜻). 둘 다 있을 때만 화면이 분량을 센다
export async function saveFinishedReading(draft: FinishDraft, options: { startPage?: number; pagesRead?: number; memo?: string }) {
  // 회차 확보(처음 읽는 책이면 1회차·읽는 중)와 세션 연결을 한 번에 기록한다(domain addSessionTo)
  libraryStore.addSession({ id: draft.id, myBookId: draft.myBookId, startedAt: draft.startedAt, endedAt: draft.endedAt, durationMs: draft.durationMs, ...options });
  await libraryStore.flushPending();
  await readingStore.clearPending();
}

// 다른 책 읽기: 지금까지의 독서를 그 책(또는 책 없음)의 기록으로 저장하고, 새 책으로 타이머를 새로 시작한다.
// 앞 책에서 잰 시간이 새 책으로 옮겨 가지 않는다. 쪽수·메모는 나중에 기록 수정에서 적을 수 있다
export async function saveAndStartOther(nextBookId?: string) {
  const draft = readingStore.finish();
  if (!draft) return null;
  if (draft.durationMs >= 1000) await saveFinishedReading(draft, { startPage: draft.startPage });
  else await readingStore.clearPending();
  const page = nextBookId ? libraryStore.get().lib.books[nextBookId]?.currentPage : undefined;
  readingStore.start(nextBookId, page);
  return draft.id;
}
