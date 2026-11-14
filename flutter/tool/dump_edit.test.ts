// 책장 편집(옮기기·끼우기·쌓기·기울이기·자세·돌리기·깊이·서랍·바꿔 놓기·표지 젖히기/돌리기/놓기)과 그 뒤 기대기 정리(withLeans)를
// 지금 앱으로 무작위로 이어 걸어 입력·연산·결과를 뽑는다(gen_shaders.sh가 jest로 돌린다). Flutter test/edit_matches_app_test.dart가 같은 연산을 다시 걸어 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import * as E from '@/domain/layout-engine';
import { resolveLeans } from '@/domain/shelf-scene';
import { bookHeight, bookThickness, frontWidth, SHELF_DEPTH, SHELF_FRONT, SHELF_USABLE_WIDTH } from '@/domain/geometry';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '@/domain/onboarding-sample';
import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from '@/domain/mockup-sample';
import { MAT_SIDE_BOOKS, MAT_SIDE_LAYOUT } from '@/domain/material-sample';
import { REAL_BOOKS, REAL_FRONT_BOOKS, REAL_FRONT_LAYOUT, REAL_LAYOUT, REAL_SIDE_BOOKS, REAL_SIDE_LAYOUT } from '@/domain/real-sample';
import { MAT_REAL_BOOKS, MAT_REAL_LAYOUT } from '@/domain/material-sample';
import { physDemo } from '@/domain/phys-sample';
import type { Book, ShelfLayout } from '@/domain/types';

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

const bookJson = (b: Book) => ({ id: b.id, title: b.title, dims: { height: bookHeight(b), thickness: bookThickness(b), coverWidth: frontWidth(b) } });
const r2 = (v: number) => Math.round(v * 100) / 100;

test('dump edit cases', () => {
  let seed = 20261114;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const [physBooks, physLayout] = physDemo();
  const bases: [string, Book[], ShelfLayout][] = [
    ['sample', SAMPLE_BOOKS, SAMPLE_LAYOUT],
    ['mockup', MOCKUP_BOOKS, MOCKUP_LAYOUT],
    ['mat-side', MAT_SIDE_BOOKS, MAT_SIDE_LAYOUT],
    ['real', REAL_BOOKS, REAL_LAYOUT],
    ['real-front', REAL_FRONT_BOOKS, REAL_FRONT_LAYOUT],
    ['phys', physBooks, physLayout],
    ['real-side', REAL_SIDE_BOOKS, REAL_SIDE_LAYOUT],
    ['mat-real', MAT_REAL_BOOKS, MAT_REAL_LAYOUT],
  ];
  const cases: unknown[] = [];
  const counts: Record<string, number> = {};
  for (const [name, list, layout0] of bases) {
    const books = Object.fromEntries(list.map((b) => [b.id, b]));
    let cur = resolveLeans(E.normalize(layout0), books).layout;
    const steps: unknown[] = [];
    for (let step = 0; step < 70; step++) {
      const placed = cur.placements.map((p) => p.bookId);
      const shelves = cur.shelves.map((s) => s.id);
      const fronts = cur.placements.filter((q) => q.pose === 'front' && !q.stackId).map((q) => q.bookId);
      const ops = ['move', 'moveX', 'stack', 'stack', 'tilt', 'tilt', 'pose', 'pose', 'spin', 'spin', 'depth', 'drawer', 'fromDrawer', 'swap', 'swapTarget', 'dropTarget', 'rotate', 'moveBy', 'toShelf', 'shift', 'shift', 'pullSupport', 'pullSupport'];
      if (fronts.length) ops.push('frontTilt', 'frontSpin', 'frontRelease', 'frontTilt', 'frontRelease');
      const op = pick(ops);
      // 연산마다 뜻이 있는 책을 고른다(눕힌 책 돌리기, 세운 책 기울이기, 쌓인 위 책 옮기기, 받치는 책 빼기)
      const of = (f: (q: (typeof cur.placements)[number]) => boolean) => cur.placements.filter(f).map((q) => q.bookId);
      const want = op === 'spin' ? of((q) => q.pose === 'horizontal') : op === 'tilt' ? of((q) => q.pose === 'spine') : op === 'shift' ? of((q) => !!q.stackId && (q.stackOrder ?? 0) > 0)
        : op === 'pullSupport' ? cur.placements.filter((q) => cur.placements.some((o) => o.lean?.on === q.bookId || (o.stackId && o.stackId === q.stackId && (o.stackOrder ?? 0) > (q.stackOrder ?? 0)))).map((q) => q.bookId) : [];
      const pool = want.length ? want : placed;
      const id = pick(pool.length ? pool : cur.drawer);
      const p = E.placementOf(cur, id);
      let args: Record<string, unknown> = { id };
      let r: { ok: boolean; reason?: string; layout?: ShelfLayout } | null = null;
      let extra: unknown = undefined;
      if (op === 'move' && p) {
        args = { id, shelfId: pick(shelves), index: Math.floor(rnd() * 8) };
        r = E.moveBook(cur, books, id, { kind: 'insert', shelfId: args.shelfId as string, index: args.index as number });
      } else if (op === 'moveX' && p) {
        args = { id, shelfId: pick(shelves), index: Math.floor(rnd() * 8), x: Math.round(rnd() * SHELF_USABLE_WIDTH * 2) / 2 };
        r = E.moveBook(cur, books, id, { kind: 'insert', shelfId: args.shelfId as string, index: args.index as number, x: args.x as number });
      } else if (op === 'stack' && p) {
        const target = cur.placements.filter((q) => q.pose === 'horizontal' && q.bookId !== id);
        if (!target.length) continue;
        const t = pick(target);
        args = { id, shelfId: t.shelfId, itemKey: t.stackId ?? t.bookId };
        r = E.moveBook(cur, books, id, { kind: 'stack', shelfId: t.shelfId, itemKey: (t.stackId ?? t.bookId) as string });
      } else if (op === 'tilt' && p) {
        args = { id, tilt: pick([-7, 0, 7]) };
        r = E.setTilt(cur, books, id, args.tilt as -7 | 0 | 7);
      } else if (op === 'pose' && p) {
        args = { id, pose: pick(['spine', 'horizontal', 'front']) };
        r = E.setPose(cur, books, id, args.pose as 'spine');
      } else if (op === 'spin' && p) {
        args = { id, deg: r2(rnd() * 90 - 45) };
        r = E.setSpin(cur, books, id, args.deg as number);
      } else if (op === 'depth' && p) {
        args = { id, z: r2(rnd() * (SHELF_DEPTH + SHELF_FRONT) - SHELF_FRONT) };
        r = E.setDepth(cur, books, id, args.z as number);
      } else if ((op === 'drawer' || op === 'pullSupport') && p) {
        r = E.moveToDrawer(cur, id, books);
      } else if (op === 'fromDrawer') {
        if (!cur.drawer.length) continue;
        args = { id: pick(cur.drawer) };
        r = E.placeFromDrawer(cur, books, args.id as string);
      } else if (op === 'swap' && p) {
        const items = E.shelfItems(cur, p.shelfId);
        args = { id, targetKey: pick(items).key };
        r = E.swapWith(cur, books, id, args.targetKey as string);
      } else if (op === 'swapTarget' && p) {
        args = { id, centerX: r2(rnd() * SHELF_USABLE_WIDTH) };
        const t = E.findSwapTarget(cur, books, id, args.centerX as number);
        extra = t;
        r = E.applySwapTarget(cur, books, id, t);
      } else if (op === 'dropTarget' && p) {
        const det = E.detach(cur, id, books);
        args = { id, shelfId: pick(shelves), centerX: r2(rnd() * SHELF_USABLE_WIDTH), width: r2(rnd() * 60) };
        const t = E.findDropTarget(det, books, args.shelfId as string, args.centerX as number, p.pose, args.width as number);
        extra = t;
        r = E.moveBook(cur, books, id, t);
      } else if (op === 'rotate' && p) {
        args = { id, dir: pick([-1, 1]) };
        r = E.rotateStep(cur, books, id, args.dir as -1 | 1);
      } else if (op === 'moveBy' && p) {
        args = { id, delta: pick([-1, 1]) };
        r = E.moveBy(cur, books, id, args.delta as -1 | 1);
      } else if (op === 'toShelf' && p) {
        args = { id, shelfId: pick(shelves) };
        r = E.moveToShelf(cur, books, id, args.shelfId as string);
      } else if (op === 'shift' && p) {
        args = { id, dx: r2(rnd() * 40 - 20) };
        r = E.shiftOnStack(cur, books, id, args.dx as number);
      } else if (op.startsWith('front')) {
        const fid = pick(fronts);
        const fs = E.frontStateOf(cur, books, fid);
        if (!fs) continue;
        if (op === 'frontTilt') {
          args = { id: fid, pitch: r2(rnd() * 25) };
          const t = E.frontTilt(cur, books, fid, fs.state, fs.qx, args.pitch as number);
          extra = t ? t.state : null;
          r = t ? { ok: true, layout: t.layout } : { ok: false, reason: 'null' };
        } else if (op === 'frontSpin') {
          args = { id: fid, spin: r2(rnd() * 180 - 90) };
          const t = E.frontSpin(cur, books, fid, fs.state, fs.qx, args.spin as number);
          extra = t ? t.state : null;
          r = t ? { ok: true, layout: t.layout } : { ok: false, reason: 'null' };
        } else {
          // 손을 놓기 전에 머리를 젖혀 둔 자세에서 놓는다(그냥 놓으면 대부분 그대로라)
          const pitch = r2(rnd() * 25);
          const t = E.frontTilt(cur, books, fid, fs.state, fs.qx, pitch);
          if (!t) continue;
          args = { id: fid, pitch };
          const out = E.frontRelease(t.layout, books, fid, t.state, fs.qx);
          r = out ? { ok: true, layout: out } : { ok: false, reason: 'null' };
        }
      } else continue;
      if (!r) continue;
      counts[op] = (counts[op] ?? 0) + 1;
      const rec: Record<string, unknown> = { op, args, before: cur, ok: r.ok, reason: r.ok ? undefined : r.reason, extra };
      if (r.ok && r.layout) {
        rec.after = r.layout;
        const lean = resolveLeans(r.layout, books);
        rec.leaned = lean.layout;
        rec.falls = lean.falls;
        cur = lean.layout;
      }
      steps.push(rec);
    }
    cases.push({ name, books: list.map(bookJson), steps });
  }
  const dir = join(__dirname, '..', 'test', 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'edit_cases.json'), `${JSON.stringify({ note: '지금 앱 편집 연산을 무작위로 이어 건 입력·결과(tool/dump_edit.test.ts). 손으로 고치지 말 것', cases })}\n`);
  console.log(`[dump] edit ${JSON.stringify(counts)}`);
});
