// 이미 등록한 책을 한 번 맞춘다(2026-11-01): 책 색 = 표지 왼쪽 가장자리 색, 두께 = YES24 책등 사진 비율. 앱을 켠 뒤 뒤에서 돈다.
// 못 읽은 표지(오프라인 등)는 표시를 남기지 않아 다음 시작 때 다시 한다. 다 뽑은 뒤 한 번에 저장해 책장이 한 번만 다시 그려진다.
import { coverAtSize } from '@/domain/cover-url';
import { pendingCoverEdges } from '@/domain/library';
import { coverEdgeColor } from '@/services/cover-palette';
import { shelfBooks } from '@/store/boot';
import { libraryStore } from '@/store/library-store';
import { placementStore } from '@/store/placement-store';
import { measureSpineRatios } from '@/services/spine-ratio';

export async function backfillCoverEdges() {
  const edges: { editionId: string; color: string }[] = [];
  for (const p of pendingCoverEdges(libraryStore.get().lib)) {
    const color = await coverEdgeColor(coverAtSize(p.coverUri, 'L'));
    if (color) edges.push({ editionId: p.editionId, color });
  }
  libraryStore.applyCoverEdges(edges);
  const lib = libraryStore.get().lib;
  const measured = await measureSpineRatios(Object.values(lib.books).map((b) => lib.editions[b.editionId]?.coverUri));
  if (measured) placementStore.syncBooks(shelfBooks(libraryStore.get().lib));
}
