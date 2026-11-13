// 책장 배치 물리(자리·쌓기·표지 전시·기대기·넘어짐·미끄러짐)를 더 많은 책장으로 뽑는다(gen_shaders.sh가 jest로 돌린다).
// 지금 앱의 예시 책장 전부(처음 예시·시안·재질 견본·조작 계산으로 만든 물리 예시)와 QA 실사 서재(백업) 배치의 computeShelf 결과.
// Flutter 쪽은 test/layout_matches_app_test.dart가 layout_cases.json과 함께 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { computeShelf, withLeans } from '@/domain/shelf-scene';
import { setTilt } from '@/domain/layout-engine';
import { SHELF_USABLE_WIDTH } from '@/domain/geometry';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '@/domain/onboarding-sample';
import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from '@/domain/mockup-sample';
import { MAT_REAL_BOOKS, MAT_REAL_LAYOUT, MAT_SIDE_BOOKS, MAT_SIDE_LAYOUT } from '@/domain/material-sample';
import { REAL_FRONT_BEFORE } from '@/domain/real-sample';
import { physDemo } from '@/domain/phys-sample';
import type { Book as AppBook, BookPlacement, ShelfLayout } from '@/domain/types';

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

const bookJson = (b: AppBook) => ({ id: b.id, title: b.title, themeColor: b.themeColor, dims: b.dims, physical: b.physical });
function layoutCase(name: string, books: AppBook[], layout: ShelfLayout) {
  const map = Object.fromEntries(books.map((b) => [b.id, b]));
  return {
    name,
    books: books.map(bookJson),
    layout,
    frames: Object.fromEntries(layout.shelves.map((sh) => [sh.id, computeShelf(layout, map, sh.id).frames.map((f) => ({
      bookId: f.bookId, pose: f.pose, tilt: f.tilt, stackIndex: f.stackIndex, leanOn: f.leanOn ?? null, leanFailed: !!f.leanFailed,
      fell: f.fell ?? null, slide: f.slide ?? null, box: f.box,
    }))])),
  };
}


// 받침을 잃은 책(넘어짐·더 기울기·바닥에 눕기·발 미끄러짐): 지금 앱 lean.test의 도미노 줄들. 받침을 뺀 직후(저장된 기대기만 남은 배치)와 다시 푼 뒤 둘 다
const tbook = (id: string, height: number, thickness: number): AppBook => ({
  id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7, art: { motif: 'leaf' },
  dims: { height, thickness, coverWidth: Math.round(height * 7) / 10 },
} as AppBook);
const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] } as ShelfLayout);
const drop = (l: ShelfLayout, id: string): ShelfLayout => ({ ...l, placements: l.placements.filter((p) => p.bookId !== id) });
function dominoCases() {
  const out: ReturnType<typeof layoutCase>[] = [];
  const pair = (name: string, bs: AppBook[], start: ShelfLayout, gone: string) => {
    const map = Object.fromEntries(bs.map((b) => [b.id, b]));
    const before = drop(withLeans(start, map), gone);
    out.push(layoutCase(`${name}-lost`, bs, before), layoutCase(`${name}-settled`, bs, withLeans(before, map)));
  };
  const A = tbook('A', 180, 40), B = tbook('B', 150, 28), C = tbook('C', 120, 34), D = tbook('D', 160, 30);
  pair('domino', [A, B, C], layoutOf(place('A', 0, 60), place('C', 1, 120), place('B', 2, 120 + 34 + 30, -7)), 'C');
  pair('lie-down', [C, D], layoutOf(place('C', 0, 150), place('D', 1, 150 + 34 + 30, -7)), 'C');
  const S = tbook('S', 50, 20), Z = tbook('Z', 130, 25), W = SHELF_USABLE_WIDTH;
  pair('slip-right', [D, C, S, Z], layoutOf(place('D', 0, 100, 7), place('C', 1, 160), place('S', 2, 230), place('Z', 3, 260)), 'C');
  pair('slip-left', [D, C, S, Z], layoutOf(place('Z', 0, W - 285), place('S', 1, W - 250), place('C', 2, W - 194), place('D', 3, W - 130, -7)), 'C');
  pair('foot-blocked', [D, C, S, Z], layoutOf(place('Z', 0, 75), place('D', 1, 100, 7), place('C', 2, 160), place('S', 3, 230)), 'C');
  const eb = [tbook('e', 143.4, 30), tbook('s', 160, 33), tbook('n', 175, 36), tbook('m', 150, 32)];
  const emap = Object.fromEntries(eb.map((b) => [b.id, b]));
  const r = setTilt(layoutOf(place('e', 0, 0), place('s', 1, 35), place('n', 2, 148), place('m', 3, 184)), emap, 'e', 7);
  if (r.ok) pair('shelf-edge', eb, r.layout, 's');
  // 무작위 줄(lean.test와 같은 씨앗): 받침을 빼면 넘어지는 줄 앞 10개
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let n = 0;
  for (let trial = 0; trial < 240 && n < 10; trial++) {
    const bs: AppBook[] = [];
    const ps: BookPlacement[] = [];
    let x = 5 + rnd() * 40;
    for (let i = 0; i < 5; i++) {
      const id = `r${i}`;
      const T = Math.round((8 + rnd() * 30) * 10) / 10;
      bs.push(tbook(id, Math.round(70 + rnd() * 120), T));
      if (x + T > W) break;
      ps.push(place(id, ps.length, Math.round(x * 100) / 100, rnd() < 0.45 ? (rnd() < 0.5 ? -7 : 7) : 0));
      x += T + (rnd() < 0.4 ? 0 : rnd() * 45);
    }
    if (ps.length < 3) continue;
    const map = Object.fromEntries(bs.map((b) => [b.id, b]));
    const l = withLeans(layoutOf(...ps), map);
    for (const v of l.placements) {
      const before = drop(l, v.bookId);
      if (!computeShelf(before, map, 's').frames.some((f) => f.fell)) continue;
      out.push(layoutCase(`random${trial}-lost-${v.bookId}`, bs, before), layoutCase(`random${trial}-settled-${v.bookId}`, bs, withLeans(before, map)));
      n++;
      break;
    }
  }
  return out;
}

test('dump shelf physics cases', () => {
  const [physBooks, physLayout] = physDemo();
  const cases = [
    layoutCase('sample', SAMPLE_BOOKS, SAMPLE_LAYOUT),
    layoutCase('mockup', MOCKUP_BOOKS, MOCKUP_LAYOUT),
    layoutCase('mat-side', MAT_SIDE_BOOKS, MAT_SIDE_LAYOUT),
    layoutCase('mat-real', MAT_REAL_BOOKS, MAT_REAL_LAYOUT),
    layoutCase('real-front-before', REAL_FRONT_BEFORE[0], REAL_FRONT_BEFORE[1]),
    layoutCase('phys', physBooks, physLayout),
    ...dominoCases(),
  ];
  const dir = join(__dirname, '..', 'test', 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'physics_cases.json'), `${JSON.stringify({ note: '지금 앱 예시 책장 전부의 computeShelf 결과(tool/dump_physics.test.ts). 손으로 고치지 말 것', layoutCases: cases })}\n`);
  const all = cases.flatMap((c) => Object.values(c.frames).flat());
  console.log(`[dump] physics ${cases.length} cases, ${all.length} frames, fell ${all.filter((f) => f.fell).length}, slide ${all.filter((f) => f.slide).length}, leanOn ${all.filter((f) => f.leanOn).length}, leanFailed ${all.filter((f) => f.leanFailed).length}, horizontal ${all.filter((f) => f.pose === 'horizontal').length}`);
});
