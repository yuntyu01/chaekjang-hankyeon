// 아직 안 잰 표지의 책등 사진 비율을 잰다. 못 읽은 것(오프라인 등)은 다음에 다시. 새로 잰 것이 있으면 true
import { needsSpineRatio, rememberSpineRatio } from '@/domain/cover-url';
import { coverSpineRatio } from '@/services/cover-palette';
import { saveSpineRatios } from '@/store/spine-ratio-store';

export async function measureSpineRatios(coverUris: (string | undefined)[]): Promise<boolean> {
  let changed = false;
  for (const uri of coverUris) {
    if (!uri || !needsSpineRatio(uri)) continue;
    const ratio = await coverSpineRatio(uri);
    if (ratio === null) continue;
    rememberSpineRatio(uri, ratio);
    changed = true;
  }
  if (changed) await saveSpineRatios();
  return changed;
}
