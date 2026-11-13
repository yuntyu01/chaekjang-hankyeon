// 독서 끝내고 저장하기(지금 앱 store/finish-reading.ts): 기록이 디스크에 저장되기 전에는 복구용 초안을 지우지 않는다. 다시 해도 같은 세션 id
library;

import '../domain/reading.dart';
import 'library_model.dart';
import 'reading_store.dart';

/// startPage: 이번 독서를 시작한 쪽, pagesRead: 도달한 쪽. 둘 다 있을 때만 화면이 분량을 센다
Future<void> saveFinishedReading(FinishDraft draft, {num? startPage, num? pagesRead, String? memo}) async {
  await LibraryModel.instance.addSession(SessionInput(
    id: draft.id,
    myBookId: draft.myBookId,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    durationMs: draft.durationMs,
    startPage: startPage,
    pagesRead: pagesRead,
    memo: memo,
  ));
  await ReadingStore.instance.clearPending();
}

/// 다른 책 읽기: 지금까지의 독서를 그 책(또는 책 없음)의 기록으로 저장하고, 새 책으로 타이머를 새로 시작한다
Future<String?> saveAndStartOther(String? nextBookId) async {
  final rs = ReadingStore.instance;
  final draft = rs.finish();
  if (draft == null) return null;
  if (draft.durationMs >= 1000) {
    await saveFinishedReading(draft, startPage: draft.startPage);
  } else {
    await rs.clearPending();
  }
  final page = nextBookId == null ? null : LibraryModel.instance.lib.books[nextBookId]?.currentPage;
  rs.start(nextBookId, page);
  return draft.id;
}
