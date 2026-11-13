// 같은 굽기 입력(assets/bake_case.json)을 지금 앱의 셰이더(SkSL)로 CanvasKit에 구워 자국을 찍는다.
// Flutter 앱이 찍는 [flpix] 와 견주면 두 앱의 빛 계산이 같은지 숫자로 확인할 수 있다(gen_shaders.sh 뒤에 돌린다).
// CanvasKit은 CPU라 시간은 견줄 수 없다. 값만 본다.
import { readFileSync } from 'fs';
import { join } from 'path';

import { bakeSource, gridSource } from '@/ui/scene-light-sksl';

const CASE = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'bake_case.json'), 'utf8')) as {
  gridPasses: number; gridN: number; envNx: number; envNy: number;
  cal: Record<string, number[]>;
  rows: { env: number[]; nBox: number; box: number[]; items: { O: number[]; U: number[]; V: number[]; n: number[]; w: number; h: number; self: number }[] }[];
};

const GUTTER = 1;
const ATLAS_W = 512;

// lib/ui/bake.dart packAtlas와 같다(선반 쌓기)
function packAtlas(items: { w: number; h: number }[]) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].h - items[a].h);
  let w = ATLAS_W;
  for (const it of items) w = Math.max(w, it.w + 2 * GUTTER);
  const at: { x: number; y: number }[] = items.map(() => ({ x: 0, y: 0 }));
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const it = items[i];
    const fw = it.w + 2 * GUTTER;
    if (x + fw > w) { x = 0; y += shelf; shelf = 0; }
    at[i] = { x: x + GUTTER, y: y + GUTTER };
    x += fw;
    shelf = Math.max(shelf, it.h + 2 * GUTTER);
  }
  return { at, w, h: y + shelf };
}

let CK: any;
beforeAll(async () => {
  const dir = join(require.resolve('canvaskit-wasm/package.json'), '..', 'bin', 'full');
  // jest-expo가 바꿔 둔 TextDecoder는 utf-16을 못 읽는다(CanvasKit이 쓴다)
  (global as any).TextDecoder = require('util').TextDecoder;
  CK = await require(join(dir, 'canvaskit.js'))({ locateFile: (f: string) => join(dir, f) });
}, 120000);

function effectOf(src: string) {
  const err: string[] = [];
  const e = CK.RuntimeEffect.Make(src, (m: string) => err.push(m));
  if (!e) throw new Error(err.join('\n'));
  return e;
}

// 이름 → 값(셰이더가 선언한 차례대로 평평하게)
function uniformArray(effect: any, values: Record<string, number | number[]>) {
  const out: number[] = [];
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const v = values[name];
    if (v === undefined) throw new Error(`missing uniform ${name}`);
    const slot = effect.getUniform(i).slot;
    const next = i + 1 < effect.getUniformCount() ? effect.getUniform(i + 1).slot : effect.getUniformFloatCount();
    const want = next - slot;
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length !== want) throw new Error(`uniform ${name}: ${arr.length} != ${want}`);
    out.push(...arr);
  }
  return Float32Array.from(out);
}

const linear = (img: any) => img.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Linear, CK.MipmapMode.None);

test('두 앱의 굽기 값 비교용 자국', () => {
  const gridFx = effectOf(gridSource());
  const bakeFx = effectOf(bakeSource());
  const black = () => CK.Shader.MakeColor(Float32Array.of(0.5, 0.5, 0.5, 1), CK.ColorSpace.SRGB);

  // 맨 뒤의 값 확인용 줄만(CPU는 느리다)
  for (let ri = CASE.rows.length - 1; ri < CASE.rows.length; ri++) {
    const r = CASE.rows[ri];
    const common = {
      env: r.env, box: r.box, nBox: r.nBox,
      gridOn: 0, gridNx: r.nBox > 0 || r.env[0] > 1.5 ? CASE.envNx : 1,
      ...CASE.cal,
    };
    // 빛 격자
    const GW = 6 * CASE.gridN;
    const GH = r.nBox * CASE.gridN + 3 * CASE.envNy;
    const gsurf = CK.MakeSurface(GW, GH);
    const gpaint = new CK.Paint();
    let grid: any = null;
    for (let k = 0; k < CASE.gridPasses; k++) {
      const uni = uniformArray(gridFx, { ...common, gridOn: grid ? 1 : 0 });
      gpaint.setShader(gridFx.makeShaderWithChildren(uni, [grid ? linear(grid) : black()]));
      gsurf.getCanvas().drawRect(CK.XYWHRect(0, 0, GW, GH), gpaint);
      grid = gsurf.makeImageSnapshot();
    }
    // 면 굽기
    const pack = packAtlas(r.items);
    const surf = CK.MakeSurface(pack.w, pack.h);
    const canvas = surf.getCanvas();
    const paint = new CK.Paint();
    r.items.forEach((it, i) => {
      const uni = uniformArray(bakeFx, {
        ...common, gridOn: 1,
        O: it.O, Ux: it.U, Vy: it.V, tN: it.n, cells: [it.w, it.h], selfIdx: it.self,
      });
      paint.setShader(bakeFx.makeShaderWithChildren(uni, [linear(grid)]));
      canvas.save();
      canvas.translate(pack.at[i].x, pack.at[i].y);
      canvas.drawRect(CK.XYWHRect(-GUTTER, -GUTTER, it.w + 2 * GUTTER, it.h + 2 * GUTTER), paint);
      canvas.restore();
    });
    const img = surf.makeImageSnapshot();
    const px = img.readPixels(0, 0, { width: pack.w, height: pack.h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < px.length; i += 4) { sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; }
    const n = px.length / 4;
    const picks: string[] = [];
    for (let k = 1; k <= 8; k++) {
      const i = Math.floor((n * k) / 9) * 4;
      picks.push(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    }
    console.log(`[ckpix] row ${ri} ${pack.w}x${pack.h} mean ${(sr / n).toFixed(2)},${(sg / n).toFixed(2)},${(sb / n).toFixed(2)} at ${picks.join(' ')}`);
  }
  expect(CASE.rows.length).toBe(7);
}, 600000);
