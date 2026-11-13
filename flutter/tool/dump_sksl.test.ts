// 지금 앱(../../app)의 셰이더 생성기와 빛 모델에서 Flutter 쪽이 쓸 것을 뽑는다(gen_shaders.sh가 jest로 돌린다):
//   build/sksl/*.sksl  — 빛 셰이더 소스(→ sksl_to_glsl.dart가 GLSL로)
//   assets/bake_case.json — 맞추기 값과 줄 하나 굽기 입력(두 앱이 같은 값을 구워 시간·화소를 견준다)
// 이식 중에는 빛의 출처를 하나로 둔다: 같은 식·같은 값이 두 앱에 들어가야 A/B 비교가 뜻이 있다.
// 관문(S23 측정)을 지나면 생성기와 빛 모델을 Dart로 옮기고 이 파일은 지운다.
// 줄 구성(벽·틀 안쪽 면·판·책 면)은 지금 앱 함수를 그대로 부른다(ui/shelf/ShelfPlank·ui/SceneLight).
// 두 파일은 Skia·Reanimated를 불러오지만 줄 구성에는 쓰지 않아, 무엇이든 받아 주는 빈 모듈로 바꿔 끼운다
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

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { bakeSource, bookSource, gridSource, litSource, tabSource } from '@/ui/scene-light-sksl';
import { boxOf, ENV_NX, ENV_NY, GRID_N, GRID_PASSES, lightSet, packBoxes, withCovers, type Env } from '@/domain/light-model';
import { SHELF_THICK } from '@/domain/geometry';
import { type Book3 } from '@/domain/book3';
import { frameParts, FRONT_AREA, FRONT_KEY, rowEnv, TOP_AREA, TOP_KEY, wallArea } from '@/ui/shelf/ShelfPlank';
import { areaItem, BAKE_TEXEL, bookItems, type BakeItem } from '@/ui/SceneLight';
import { FRAME_ON } from '@/scene-config/skin';
import { bookEref, bookSref, DESIGN, EREF, SPEC_K, SREF } from '@/domain/light-model';
import { MAT_UNIFORMS } from '@/domain/surface-pattern';
import { surfaceMats, surfaces } from '@/scene-config/lighting';

const ROOT = join(__dirname, '..');
const SKSL = join(ROOT, 'build', 'sksl');
const ASSETS = join(ROOT, 'assets');

// 움푹 파인 책장에서 틀 면이 위 줄과 겹치는 높이(ui/shelf/ShelfScene FRAME_OVERLAP, 내보내지 않는 값이라 다시 적는다)
const FRAME_OVERLAP = 1;
function write(dir: string, name: string, text: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text, 'utf8');
}

const v3 = (v: Vec3) => [v.x, v.y, v.z];
type Vec3 = { x: number; y: number; z: number };
const itemJson = (it: BakeItem) => ({ key: it.key, O: v3(it.O), U: v3(it.U), V: v3(it.V), w: it.w, h: it.h, n: v3(it.n), self: it.self });

test('dump sksl + bake case', () => {
  const srcs: Record<string, string> = { grid: gridSource(), bake: bakeSource(), lit: litSource(), book: bookSource(), tab: tabSource() };
  for (const [name, src] of Object.entries(srcs)) write(SKSL, `${name}.sksl`, src);

  // ---- 줄 여섯(지금 앱이 실제 굽는 줄과 면 수·칸 수를 맞춘다: 로그의 5·26·21·19·31·20면) ----
  // 책 수가 다른 줄을 만들어 같은 양을 굽게 한다. 기댄 책(돌아간 상자)도 줄마다 하나씩 둔다
  const book = (x: number, T = 30, H = 174, W = 120): Book3 => ({ id: `b${x}`, dims: { T, H, W }, roll: 0, yaw: 0, t: { x, y: 0, z: 0 } });

  // 지금 앱 ui/shelf/ShelfScene 한 줄의 굽기 목록과 같은 차례: 벽 → 틀 안쪽 면 → 판 윗면·앞면 → 책 면(보이는 면만)
  function rowOf(nBooks: number, space: number, top = false, last = false) {
    if (!FRAME_ON) throw new Error('틀 없는 스킨의 줄(맨 윗줄 HEAD_DU·판 밑 벽)은 아직 뽑지 않는다');
    const books: Book3[] = [];
    let x = 20;
    for (let i = 0; i < nBooks; i++) {
      const T = 22 + (i % 4) * 7;
      const H = space - 16 - (i % 3) * 12;
      const W = 110 + (i % 3) * 10;
      const b = book(x, T, H, W);
      // 줄마다 마지막 책은 기대어 둔다(돌아간 상자: 셰이더에서 가장 무거운 쪽)
      books.push(i === nBooks - 1 ? { ...b, roll: -8 } : b);
      x += T + 1;
    }
    const list = withCovers(books.map((b, i) => boxOf(b, i % 2 ? [0.5, 0.08, 0.05] : [0.05, 0.12, 0.42])));
    const bx = packBoxes(list, books.map((b) => b.id));
    const env: Env = rowEnv(space, top);
    const roofed = top && FRAME_ON;
    const backY1 = space + SHELF_THICK;
    const items: BakeItem[] = [areaItem('wall', wallArea(-SHELF_THICK, backY1), env, bx)];
    for (const part of frameParts(-SHELF_THICK, roofed ? space : space + FRAME_OVERLAP, roofed ? space : null)) items.push(areaItem(part.key, part.area, env, bx));
    items.push(areaItem(TOP_KEY, TOP_AREA, env, bx), areaItem(FRONT_KEY, FRONT_AREA, env, bx));
    books.forEach((b, i) => items.push(...bookItems(b.id, b, env, bx, i)));
    return { nBooks, space, top, last, env: [env.side ? 2 : 1, env.floor, env.ceil], nBox: list.length, box: bx.v, items: items.map(itemJson) };
  }

  // 값 맞는지 보는 작은 줄(맨 뒤): CPU(CanvasKit)로도 구울 수 있을 만큼 작게. 시간 재기에는 넣지 않는다
  function probeRow() {
    const r = rowOf(3, 190);
    return { ...r, probe: true, items: r.items.slice(0, 5).map((it) => ({ ...it, w: 24, h: 18 })) };
  }

  // 줄 여섯: 책 수 0 · 5 · 4 · 4 · 7 · 4(맨 윗줄은 천장이 있다)
  const rows = [
    rowOf(0, 190, true),
    rowOf(5, 190),
    rowOf(4, 205),
    rowOf(4, 205),
    rowOf(7, 215),
    rowOf(4, 205, false, true),
    probeRow(),
  ];

  const cal = lightSet().u as Record<string, number | number[]>;
  // 맞추기 값은 Dart 상수로도 쓴다(앱이 JSON 없이 굽게). light-model calibrate를 옮기기 전까지 여기서 받는다
  const calDart = Object.keys(cal).sort().map((k) => {
    const v = cal[k];
    const a = typeof v === 'number' ? [v] : v;
    return a.length === 1 ? `const double ${k} = ${a[0]};` : `const ${k} = C3(${a.map((x) => (Number.isInteger(x) ? `${x}.0` : x)).join(', ')});`;
  }).join('\n');
  write(join(ROOT, 'lib', 'gen'), 'light_uniforms.g.dart', `// 지금 앱의 빛 맞추기 값(light-model lightSet().u). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것.
// 재질 색(시안 색)에서 거꾸로 구한 반사율·카메라 기준 빛이라, 빛 설정이나 스킨이 바뀌면 다시 만들어야 한다
// ignore_for_file: constant_identifier_names
library;

import '../domain/vec3.dart';

${calDart}
`);
  const caseJson = {
    note: '지금 앱의 빛 모델에서 뽑은 줄 여섯의 굽기 입력(flutter/tool/dump_sksl.test.ts). 손으로 고치지 말 것',
    gridPasses: GRID_PASSES,
    gridN: GRID_N,
    envNx: ENV_NX,
    envNy: ENV_NY,
    bakeTexel: BAKE_TEXEL,
    cal,
    rows,
  };
  write(ASSETS, 'bake_case.json', `${JSON.stringify(caseJson)}\n`);

  // 장면 그리기에 쓰는 값(재질 색·대표 자리 빛·반사광·표면 재질). light-model calibrate·surface-pattern을 옮기기 전까지 여기서 받는다
  const c3 = (v: readonly number[]) => `C3(${v.map((x) => (Number.isInteger(x) ? `${x}.0` : x)).join(', ')})`;
  const nums = (v: readonly number[]) => `[${v.map((x) => (Number.isInteger(x) ? `${x}.0` : x)).join(', ')}]`;
  const matOf = (name: keyof typeof MAT_UNIFORMS) => {
    const m = MAT_UNIFORMS[name];
    return `Mat(${nums(m.mRough)}, ${nums(m.mBump)}, ${nums(m.mGrain)}, ${nums(m.mGsize)})`;
  };
  const surf = (k: 'wall' | 'plank' | 'frame') => `Surface(${c3(DESIGN[k])}, ${c3(EREF[k])}, ${c3(SREF[k])}, ${matOf(surfaceMats[k])}, 0x${surfaces[k].slice(1).toUpperCase()})`;
  write(join(ROOT, 'lib', 'gen'), 'scene_uniforms.g.dart', `// 장면을 그리는 데 쓰는 값(재질 색 DESIGN · 대표 자리 빛 EREF · 반사광 SREF · 표면 재질 materials · 보이는 색 surfaces).
// tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것. 빛 설정이나 스킨이 바뀌면 다시 만들어야 한다
library;

import '../domain/vec3.dart';

/// 표면 재질 uniform(거칠기·법선 무늬·반사율 무늬·무늬 크기)
class Mat {
  const Mat(this.rough, this.bump, this.grain, this.gsize);
  final List<double> rough;
  final List<double> bump;
  final List<double> grain;
  final List<double> gsize;
}

/// 한 부품: 재질 색(반사율) · 대표 자리 빛 · 반사광 · 표면 · 보이는 색
class Surface {
  const Surface(this.albedo, this.eref, this.sref, this.mat, this.color);
  final C3 albedo;
  final C3 eref;
  final C3 sref;
  final Mat mat;
  final int color;
}

/// 책 장정 하나: 대표 자리 빛 · 반사광 · 거울 반사 세기 · 장정 표면 · 속지 표면 · 속지 반사광
class BookSurface {
  const BookSurface(this.eref, this.sref, this.specK, this.mat, this.pages, this.srefPaper);
  final C3 eref;
  final C3 sref;
  final double specK;
  final Mat mat;
  final Mat pages;
  final C3 srefPaper;
}

const bookFine = BookSurface(${c3(bookEref('fine'))}, ${c3(bookSref('fine'))}, ${SPEC_K.fine}, ${matOf('fine')}, ${matOf('pages')}, ${c3(SREF.paper)});

const wallSurface = ${surf('wall')};
const plankSurface = ${surf('plank')};
const frameSurface = ${surf('frame')};
`);

  expect(rows.length).toBe(7);
  const cells = rows.reduce((s2, r) => s2 + r.items.reduce((t, it) => t + it.w * it.h, 0), 0);
  console.log(`[dump] ${Object.entries(srcs).map(([n, s2]) => `${n} ${s2.split('\n').length}줄`).join(', ')}`);
  console.log(`[case] 줄 ${rows.length}개(맨 뒤는 값 확인용), 면 ${rows.reduce((t, r) => t + r.items.length, 0)}개 ${cells}칸, 상자 ${rows.map((r) => r.nBox).join('/')}`);
});
