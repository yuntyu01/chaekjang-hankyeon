// 아직 안 잰 표지의 갈피 색을 뽑는다. 못 읽은 것(오프라인 등)은 다음에 다시. 새로 잰 것이 있으면 true
import { coverAtSize, needsCoverAccent, rememberCoverAccent } from '@/domain/cover-url';
import { coverAccentColor } from '@/services/cover-palette';
import { saveCoverAccents } from '@/store/cover-accent-store';

export async function measureCoverAccents(coverUris: (string | undefined)[]): Promise<boolean> {
  let changed = false;
  for (const uri of coverUris) {
    if (!uri || !needsCoverAccent(uri)) continue;
    const accent = await coverAccentColor(coverAtSize(uri, 'M'));
    if (accent === undefined) continue;
    rememberCoverAccent(uri, accent ?? '');
    changed = true;
  }
  if (changed) await saveCoverAccents();
  return changed;
}
