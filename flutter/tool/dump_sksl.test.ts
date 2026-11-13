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

  // ---- 줄 하나: 책 네 권(하나는 기댄 책), 줄 높이 space ----
  const space = 190;
  const book = (x: number, T = 30, H = 174, W = 120): Book3 => ({ id: `b${x}`, dims: { T, H, W }, roll: 0, yaw: 0, t: { x, y: 0, z: 0 } });
  const lean: Book3 = { id: 'lean', dims: { T: 22, H: 140, W: 100 }, roll: -8, yaw: 0, t: { x: 172, y: 0, z: 0 } };
  const books = [book(76), book(100), book(123, 22, 120), lean];
  const list = withCovers(books.map((b, i) => boxOf(b, i % 2 ? [0.5, 0.08, 0.05] : [0.05, 0.12, 0.42])));
  const bx = packBoxes(list, books.map((b) => b.id));
  const env: Env = FRAME_ON ? { floor: 0, ceil: space, side: true } : { floor: 0, ceil: space };

  // 벽(화면에 보이는 가로 범위: 원근으로 벽은 화면보다 조금 넓다, ShelfPlank WALL_X0·WALL_X1)
  const wallD = 1 + SHELF_DEPTH / VIEW_DIST;
  const wx0 = VIEW_CX + (-SHELF.sideMargin - SCENE_PAD - VIEW_CX) * wallD;
  const wx1 = VIEW_CX + (DESIGN_WIDTH - SHELF.sideMargin + SCENE_PAD - VIEW_CX) * wallD;
  const items: ReturnType<typeof area>[] = [];
  items.push(area({ x: wx0, y: space + SHELF_THICK, z: SHELF_DEPTH }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, wx1 - wx0, space + 2 * SHELF_THICK, { x: 0, y: 0, z: -1 }));
  // 판 윗면 · 앞면
  items.push(area({ x: SHELF_X0, y: 0, z: SHELF_DEPTH }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, SHELF_X1 - SHELF_X0, SHELF_DEPTH + 70, { x: 0, y: 1, z: 0 }));
  items.push(area({ x: SHELF_X0, y: 0, z: -70 }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, SHELF_X1 - SHELF_X0, SHELF_THICK, { x: 0, y: 0, z: 1 }));
  // 책 면(ui/SceneLight bookItems와 같다: 보이는 면만 고르는 것은 빼고 모두 넣는다)
  const faces: FaceId[] = ['front', 'back', 'spine', 'fore', 'head', 'tail'];
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

  const cal = lightSet().u as Record<string, number | number[]>;
  const caseJson = {
    note: '지금 앱의 빛 모델에서 뽑은 줄 하나 굽기 입력(flutter/tool/dump_sksl.test.ts). 손으로 고치지 말 것',
    gridPasses: GRID_PASSES,
    gridN: GRID_N,
    envNx: ENV_NX,
    envNy: ENV_NY,
    bakeTexel: BAKE_TEXEL,
    env: [env.side ? 2 : 1, env.floor, env.ceil],
    nBox: list.length,
    box: bx.v,
    cal,
    items,
  };
  write(ASSETS, 'bake_case.json', `${JSON.stringify(caseJson)}\n`);

  expect(items.length).toBeGreaterThan(5);
  const cells = items.reduce((s, it) => s + it.w * it.h, 0);
  console.log(`[dump] ${Object.entries(srcs).map(([n, s]) => `${n} ${s.split('\n').length}줄`).join(', ')}`);
  console.log(`[case] 면 ${items.length}개 ${cells}칸, 상자 ${list.length}개, 격자 ${6 * GRID_N}x${list.length * GRID_N + 3 * ENV_NY} × ${GRID_PASSES}번`);
});
