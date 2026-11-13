// 갈피 종이·테이프의 섬유 경로와 갈피 색을 뽑는다(gen_shaders.sh가 jest로 돌린다).
// 지금 앱 BookmarkPaper·BookmarkTape를 그려 Path d 값을 그대로 모은다 → Flutter 쪽이 같은 씨앗에서 같은 경로를 만드는지
// test/bookmark_paper_matches_app_test.dart가 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

import { paperColors } from '@/domain/color';
import { quoteType } from '@/features/bookmark/BookmarkCard';
import { BookmarkPaper } from '@/features/bookmark/BookmarkPaper';
import { BookmarkTape } from '@/features/bookmark/BookmarkTape';
import { ymd } from '@/features/book/labels';
import { keepAll } from '@/ui/keep-all';

// 카드가 끌어오는 책 그림(Skia)·움직임은 쓰지 않는다
jest.mock('@shopify/react-native-skia', () => mockStubModule());
jest.mock('react-native-reanimated', () => mockStubModule());
jest.mock('react-native-worklets', () => mockStubModule());
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));
function mockStubModule() {
  const f: any = new Proxy(function () {}, {
    get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : f),
    apply: () => f,
    construct: () => f,
  });
  return f;
}
jest.mock('react-native-svg', () => {
  const { createElement: h } = jest.requireActual('react');
  const tag = (name: string) => (p: Record<string, unknown>) => h(name, p, p.children as never);
  return { __esModule: true, default: tag('Svg'), Svg: tag('Svg'), Defs: tag('Defs'), G: tag('G'), Path: tag('Path'), Rect: tag('Rect'), Pattern: tag('Pattern'), ClipPath: tag('ClipPath'), LinearGradient: tag('LinearGradient'), Stop: tag('Stop') };
});

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
function paths(tree: Node | Node[] | null): string[] {
  const out: string[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === 'string') return;
    if (n.type === 'Path' && typeof n.props.d === 'string') out.push(n.props.d);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of Array.isArray(tree) ? tree : tree ? [tree] : []) walk(n);
  return out;
}
function render(el: ReturnType<typeof createElement>) {
  let r: ReturnType<typeof create> | undefined;
  act(() => { r = create(el); });
  return r!.toJSON() as Node | Node[] | null;
}

test('dump bookmark paper', () => {
  const seeds = ['sample-front', 'sample-color', 'mark-1-front', '갈피-한글-tape', 'abc'];
  const paper = seeds.map((seed) => {
    const p = paths(render(createElement(BookmarkPaper, { color: '#FFFFFF', radius: 8, seed })));
    // 무늬마다: fine 두 번, broad 두 번, cloud 두 번, pulp 두 번(같은 d)
    return { seed, fine: p[0], broad: p[2], cloud: p[4], pulp: p[6] };
  });
  const tape = seeds.map((seed) => {
    const p = paths(render(createElement(BookmarkTape, { color: '#E0C0A0', seed, width: 39, height: 43, paperEdge: 16 })));
    // 오림 1 + 그림자 8 + 아래 그림자 4 + 그림자 1 + 면 1 → pulp, swirl×4, short×2, long×2, flecks, 윗선, torn×2, fringe
    return { seed, shape: p[0], pulp: p[15], swirl: p[16], short: p[20], long: p[22], flecks: p[24], torn: p[26], fringe: p[28] };
  });
  const accents = [undefined, '#5276B3', '#C9A27E', '#191919', '#F2F2F2', '#8FA695', '#E3A857', 'bad', '#aa5533'];
  const keys = ['b1', 'mybook-2', '채식주의자', ''];
  const colors = accents.flatMap((a) => keys.map((k) => ({ accent: a ?? null, key: k, ...paperColors(a, k) })));
  const quotes = ['짧은 문장', 'a'.repeat(36), 'a'.repeat(37), 'a '.repeat(80), 'a'.repeat(81), 'a'.repeat(160), 'a'.repeat(161)].map((t) => ({ text: t, ...quoteType(t) }));
  const dates = ['2026-11-05T12:30:00.000Z', '2026-01-09', ''].map((d) => ({ iso: d, ymd: ymd(d || undefined) }));
  const keep = ['어떤 문장은\n책을 덮은 뒤에도', 'a  b', ' 앞 뒤 '].map((t) => ({ text: t, out: keepAll(t) }));
  const dir = join(__dirname, '..', 'test', 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bookmark_cases.json'), `${JSON.stringify({ note: '지금 앱 갈피 종이·테이프 경로와 갈피 색(tool/dump_bookmark.test.ts). 손으로 고치지 말 것', paper, tape, colors, quotes, dates, keep }, null, 1)}\n`);
  console.log(`[dump] bookmark paper ${paper.length} tape ${tape.length} colors ${colors.length}`);
});
