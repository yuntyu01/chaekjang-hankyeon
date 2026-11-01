// 이미 등록한 책의 책 색을 표지 왼쪽 가장자리 색으로 한 번 맞춘다(2026-11-01 사용자 '책등 색도 표지 색으로'). 앱을 켠 뒤 뒤에서 돈다.
// 못 읽은 표지(오프라인 등)는 판본 표시를 올리지 않아 다음 시작 때 다시 한다. 색을 다 뽑은 뒤 한 번에 저장해 책장이 한 번만 다시 그려진다.
import { coverAtSize } from '@/domain/cover-url';
import { pendingCoverEdges } from '@/domain/library';
import { coverEdgeColor } from '@/services/cover-palette';
import { libraryStore } from '@/store/library-store';

export async function backfillCoverEdges() {
  const edges: { editionId: string; color: string }[] = [];
  for (const p of pendingCoverEdges(libraryStore.get().lib)) {
    const color = await coverEdgeColor(coverAtSize(p.coverUri, 'L'));
    if (color) edges.push({ editionId: p.editionId, color });
  }
  libraryStore.applyCoverEdges(edges);
}
