// 잠긴 칸 안에 흐리게 보이는 책(지금 앱 domain/locked-preview)을 뽑는다(gen_shaders.sh가 jest로 돌린다).
// 칸마다 책(색·크기)과 배치 계산이 끝난 상자(자세·자리)를 assets/locked_preview.json에 쓴다 → Flutter 책장이 같은 책을 그린다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { lockedPreview } from '@/domain/locked-preview';

jest.mock('@shopify/react-native-skia', () => mockStubModule());
jest.mock('react-native-reanimated', () => mockStubModule());
jest.mock('react-native-worklets', () => mockStubModule());
function mockStubModule() {
  const f: any = new Proxy(function () {}, {
    get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
    construct: () => f,
  });
  return f;
}

test('dump locked shelf preview', () => {
  const rows = [0, 1, 2].map((i) => {
    const p = lockedPreview(i);
    return {
      books: Object.values(p.books).map((b) => ({ id: b.id, themeColor: b.themeColor, heightClass: b.heightClass, thicknessClass: b.thicknessClass, coverAspectRatio: b.coverAspectRatio, dims: b.dims ?? null, physical: b.physical ?? null })),
      boxes: p.frames.map((f) => f.box),
    };
  });
  const dir = join(__dirname, '..', 'assets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'locked_preview.json'), `${JSON.stringify({ note: '지금 앱 잠긴 칸 흐린 책(tool/dump_locked.test.ts). 손으로 고치지 말 것', rows })}\n`);
  console.log(`[dump] locked rows ${rows.length} books ${rows.map((r) => r.books.length).join(',')}`);
});
