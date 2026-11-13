// 지금 앱(../../app)의 셰이더 생성기와 빛 모델에서 Flutter 쪽이 쓸 것을 뽑는다(gen_shaders.sh가 jest로 돌린다):
//   build/sksl/*.sksl  — 빛 셰이더 소스(→ sksl_to_glsl.dart가 GLSL로)
//   assets/bake_case.json — 맞추기 값과 줄 하나 굽기 입력(두 앱이 같은 값을 구워 시간·화소를 견준다)
// 이식 중에는 빛의 출처를 하나로 둔다: 같은 식·같은 값이 두 앱에 들어가야 A/B 비교가 뜻이 있다.
// 관문(S23 측정)을 지나면 생성기와 빛 모델을 Dart로 옮기고 이 파일은 지운다.
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { bakeSource, bookSource, gridSource, litSource, tabSource } from '@/ui/scene-light-sksl';
import { boxOf, ENV_NX, ENV_NY, GRID_N, GRID_PASSES, lightSet, packBoxes, withCovers, type Env } from '@/domain/light-model';
import { SHELF, SHELF_DEPTH, SHELF_THICK, SHELF_X0, SHELF_X1, DESIGN_WIDTH } from '@/domain/geometry';
import { VIEW_CX, VIEW_DIST } from '@/domain/camera';
import { lightPanel } from '@/domain/book-parts';
import { faceNormal, rot, toWorld, type Book3, type FaceId, type Vec3 } from '@/domain/book3';
import { FRAME_ON } from '@/scene-config/skin';
import { bookEref, bookSref, DESIGN, EREF, SPEC_K, SREF } from '@/domain/light-model';
import { MAT_UNIFORMS } from '@/domain/surface-pattern';
import { surfaceMats, surfaces } from '@/scene-config/lighting';

const ROOT = join(__dirname, '..');
const SKSL = join(ROOT, 'build', 'sksl');
const ASSETS = join(ROOT, 'assets');

// 굽는 칸 간격(ui/SceneLight BAKE_TEXEL). Skia를 들이지 않으려고 값만 다시 적는다
const BAKE_TEXEL = 2;
const SCENE_PAD = FRAME_ON ? 4 : 0;

function write(dir: string, name: string, text: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text, 'utf8');
}

// ui/shelf/ShelfPlank bakeArea와 같다: 면 위 칸 격자(O에서 U·V만큼씩, w × h 칸)
function area(O: Vec3, along: Vec3, across: Vec3, len: number, wid: number, n: Vec3) {
  const w = Math.max(1, Math.ceil(len / BAKE_TEXEL));
  const h = Math.max(1, Math.ceil(wid / BAKE_TEXEL));
  const su = len / w;
  const sv = wid / h;
  const m = (v: Vec3, k: number) => [v.x * k, v.y * k, v.z * k];
  return { O: [O.x, O.y, O.z], U: m(along, su), V: m(across, sv), w, h, n: [n.x, n.y, n.z], self: -1 };
}

test('dump sksl + bake case', () => {
  const srcs: Record<string, string> = { grid: gridSource(), bake: bakeSource(), lit: litSource(), book: bookSource(), tab: tabSource() };
  for (const [name, src] of Object.entries(srcs)) write(SKSL, `${name}.sksl`, src);

  // ---- 줄 여섯(지금 앱이 실제 굽는 줄과 면 수·칸 수를 맞춘다: 로그의 5·26·21·19·31·20면) ----
  // 책 수가 다른 줄을 만들어 같은 양을 굽게 한다. 기댄 책(돌아간 상자)도 줄마다 하나씩 둔다
  // 책 한 권에 굽는 면(지금 앱은 보이는 면만 고른다. 여기서는 네 면 고정)
  const faces: FaceId[] = ['cover', 'back', 'spine', 'fore'];
  const book = (x: number, T = 30, H = 174, W = 120): Book3 => ({ id: `b${x}`, dims: { T, H, W }, roll: 0, yaw: 0, t: { x, y: 0, z: 0 } });

  function rowOf(nBooks: number, space: number) {
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
    const env: Env = FRAME_ON ? { floor: 0, ceil: space, side: true } : { floor: 0, ceil: space };

    const items: ReturnType<typeof area>[] = [];
    // 벽(화면에 보이는 가로 범위: 원근으로 벽은 화면보다 조금 넓다, ShelfPlank WALL_X0·WALL_X1)
    const wallD = 1 + SHELF_DEPTH / VIEW_DIST;
    const wx0 = VIEW_CX + (-SHELF.sideMargin - SCENE_PAD - VIEW_CX) * wallD;
    const wx1 = VIEW_CX + (DESIGN_WIDTH - SHELF.sideMargin + SCENE_PAD - VIEW_CX) * wallD;
    items.push(area({ x: wx0, y: space + SHELF_THICK, z: SHELF_DEPTH }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, wx1 - wx0, space + 2 * SHELF_THICK, { x: 0, y: 0, z: -1 }));
    // 판 윗면 · 앞면
    items.push(area({ x: SHELF_X0, y: 0, z: SHELF_DEPTH }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, SHELF_X1 - SHELF_X0, SHELF_DEPTH + 70, { x: 0, y: 1, z: 0 }));
    items.push(area({ x: SHELF_X0, y: 0, z: -70 }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, SHELF_X1 - SHELF_X0, SHELF_THICK, { x: 0, y: 0, z: 1 }));
    // 책 면(ui/SceneLight bookItems와 같다: 보이는 면만 고르는 것은 빼고 책마다 네 면 — 앞·책등·머리·배)
    books.forEach((b, i) => {
      for (const f of faces) {
        const pn = lightPanel(b.dims, f);
        const w = Math.max(1, Math.ceil(pn.w / BAKE_TEXEL));
        const h = Math.max(1, Math.ceil(pn.h / BAKE_TEXEL));
        const turn = (v: Vec3) => rot(b.roll, b.yaw, v, b.spin ?? 0, b.pitch ?? 0);
        const U = turn(pn.U);
        const V = turn(pn.V);
        const O = toWorld(b, pn.O);
        const n = turn(faceNormal(f));
        items.push({ O: [O.x, O.y, O.z], U: [U.x / w, U.y / w, U.z / w], V: [V.x / h, V.y / h, V.z / h], w, h, n: [n.x, n.y, n.z], self: i });
      }
    });
    return { env: [env.side ? 2 : 1, env.floor, env.ceil], nBox: list.length, box: bx.v, items };
  }

  // 값 맞는지 보는 작은 줄(맨 뒤): CPU(CanvasKit)로도 구울 수 있을 만큼 작게. 시간 재기에는 넣지 않는다
  function probeRow() {
    const r = rowOf(3, 190);
    r.items = r.items.slice(0, 5).map((it) => ({ ...it, w: 24, h: 18 }));
    return r;
  }

  // 지금 앱 로그의 줄들: 5 · 26 · 21 · 19 · 31 · 20면 → 책 수 0 · 5 · 4 · 4 · 7 · 4 (면 = 3 + 책×4)
  const rows = [
    rowOf(0, 190),
    rowOf(5, 190),
    rowOf(4, 205),
    rowOf(4, 205),
    rowOf(7, 215),
    rowOf(4, 205),
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
