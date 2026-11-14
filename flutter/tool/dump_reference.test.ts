// 새 서재의 예시 책장(지금 앱 store/home-reference-install·domain/home-reference)을 뽑는다(gen_shaders.sh가 jest로 돌린다).
// 빈 서재에 지금 앱의 설치 과정(installReferenceHome)을 그대로 돌려 저장되는 책장 배치(shelf-layout JSON)와,
// 책장에만 보이는 표시 전용 예시 책(referenceHomeBooks: 시안 제목·책 색·갈피·재질·그림 표지 자리)을 assets/reference_home.json에 쓴다.
// 그림 표지 세 권(느린 계절·여름의 숲·우리가 빛의 속도로 갈 수 없다면)은 시안 원본(app/assets/reference/bookshelf-original.png)의
// 표지 자리(sourceRect)를 assets/reference/<이름>.png로 잘라 둔 것을 쓴다(잘라 낸 자리도 이 파일에 적는다)
import { writeFileSync } from 'fs';
import { join } from 'path';

jest.mock('@shopify/react-native-skia', () => mockStubModule());
jest.mock('react-native-reanimated', () => mockStubModule());
jest.mock('react-native-worklets', () => mockStubModule());
jest.mock('expo-audio', () => mockStubModule());
jest.mock('expo-video', () => mockStubModule());
function mockStubModule() {
  const f: any = new Proxy(function () {}, {
    get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
    construct: () => f,
  });
  return f;
}

test('dump reference home', async () => {
  const { installReferenceHome } = require('@/store/home-reference-install') as typeof import('@/store/home-reference-install');
  const { referenceHomeBooks } = require('@/domain/home-reference') as typeof import('@/domain/home-reference');
  const { LANDSCAPES } = require('@/domain/book-design') as typeof import('@/domain/book-design');
  const empty = { editions: {}, books: {}, bindings: {}, rounds: {}, sessions: {}, bookmarks: {} } as any;
  const kv = new Map<string, string>();
  const profile = await installReferenceHome(empty, { version: 2, shelves: [], placements: [], drawer: [] }, {
    getItem: async (k) => kv.get(k) ?? null,
    setItem: async (k, v) => void kv.set(k, v),
    saveLibrary: async () => undefined,
    hasSavedLayout: false,
  });
  const layout = JSON.parse(kv.get('shelf-layout')!);
  const books = referenceHomeBooks(empty, profile);
  const landscape = (printed?: string) => Object.entries(LANDSCAPES).find(([, c]) => c.printedTitle === printed)?.[0] ?? null;
  const out = Object.values(books).map((b) => ({
    id: b.id,
    title: b.title,
    themeColor: b.themeColor,
    heightClass: b.heightClass,
    thicknessClass: b.thicknessClass,
    coverAspectRatio: b.coverAspectRatio,
    dims: b.dims ?? null,
    titleTop: b.art.titleTop ?? null,
    ribbon: b.art.ribbon ?? null,
    // 보이는 갈피 장 수(예시 책은 문장이 없어도 시안처럼 갈피가 보인다: art.ribbonVisible·ribbonCount)
    ribbons: b.art.ribbonVisible ? (b.art.ribbonCount ?? 1) : 0,
    material: b.art.material ?? null,
    plainCover: !!b.art.plainCover,
    cover: b.cover?.sourceRect ? landscape(b.cover.printedTitle) : null,
  }));
  const covers = Object.fromEntries(Object.entries(LANDSCAPES).map(([k, c]) => [k, { sourceRect: c.sourceRect, printedTitle: c.printedTitle }]));
  writeFileSync(
    join(__dirname, '..', 'assets', 'reference_home.json'),
    `${JSON.stringify({ note: '지금 앱 새 서재 예시 책장(tool/dump_reference.test.ts). 손으로 고치지 말 것', key: 'home-reference:2026-10', profile, layout, books: out, covers }, null, 1)}\n`,
  );
  console.log(`[dump] reference home books ${out.length} placements ${layout.placements.length} shelves ${layout.shelves.length}`);
});
