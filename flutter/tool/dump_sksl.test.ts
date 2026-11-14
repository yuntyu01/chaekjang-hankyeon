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

import { bakeSource, bookSource, gridSource, litSource, LOSS_G0, LOSS_RN, LOSS_RP, tabSource } from '@/ui/scene-light-sksl';
import { boxOf, ENV_NX, ENV_NY, GRID_N, GRID_PASSES, lightSet, packBoxes, withCovers, type Env } from '@/domain/light-model';
import { SHELF_THICK } from '@/domain/geometry';
import { type Book3 } from '@/domain/book3';
import { computeShelf } from '@/domain/shelf-scene';
import { receivedShadow3, REACH_L, REACH_R } from '@/domain/received3';
import { underCeil } from '@/domain/cast-shadow';
import { corners as corners3, fromPlaced as fromPlaced3 } from '@/domain/book3';
import { BOOK_MAX_H } from '@/domain/geometry';
import { REAL_BEFORE, REAL_BOOKS, REAL_FRONT_BOOKS, REAL_FRONT_LAYOUT, REAL_LAYOUT, REAL_SIDE_BOOKS, REAL_SIDE_LAYOUT } from '@/domain/real-sample';
import type { Book as AppBook, ShelfLayout } from '@/domain/types';
import { coverTitleLayout, lyingTitleLayout, spineTitleLayout } from '@/domain/title-layout';
import { displayInk, tabColors, titleInk } from '@/domain/color';
import { jacketColor } from '@/domain/book-design';
import { bindingSurfaceTone, bookTone } from '@/domain/binding-material';
import bindingProfiles from '@/scene-config/reference-bindings.generated.json';
import { frameParts, FRONT_AREA, FRONT_KEY, rowEnv, TOP_AREA, TOP_KEY, wallArea } from '@/ui/shelf/ShelfPlank';
import { areaItem, BAKE_TEXEL, bookItems, type BakeItem } from '@/ui/SceneLight';
import { FRAME_ON } from '@/scene-config/skin';
import { bookAlbedo, bookEref, bookSref, DESIGN, EREF, SKY_C, SPEC_K, SREF, TONE } from '@/domain/light-model';
import { MAT_UNIFORMS } from '@/domain/surface-pattern';
import { light, surfaceMats, surfaces } from '@/scene-config/lighting';
import { switchSkin } from '@/domain/light-model';
import { FRAME_SKINS, PLANK_SKINS, SKIN_CHOICE, WALL_SKINS, type SkinChoice } from '@/scene-config/skin';

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
    if (a.length !== 3) throw new Error(`맞추기 값 ${k}는 C3여야 한다(스킨 표가 C3만 담는다)`);
    return `C3 get ${k} => skinLight.u['${k}']!;`;
  }).join('\n');
  write(join(ROOT, 'lib', 'gen'), 'light_uniforms.g.dart', `// 지금 앱의 빛 맞추기 값(light-model lightSet().u). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것.
// 재질 색(시안 색)에서 거꾸로 구한 반사율·카메라 기준 빛이라 스킨마다 다르다: 지금 스킨(scene_config/skin.dart skinLight)의 값을 읽는다
// ignore_for_file: non_constant_identifier_names
library;

import '../domain/vec3.dart';
import '../scene_config/skin.dart' show skinLight;

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

  // ---- 책 그림 규칙(제목 조판·제목 색·재질 색): Dart 시험이 지금 앱 결과와 견준다 ----
  const titles = ['느린 계절', '여름의 숲', '어린 왕자', '문장 수집', '아주 보통의 하루', '좋은 문장은 이렇게 온다', '찰나의 마음', '고요한 우연',
    '아무튼, 독서', '너라는 계절', '우리가 빛의 속도로 갈 수 없다면', '코스모스', 'COSMOS', '82년생 김지영', '데미안', '불편한 편의점',
    '달러구트 꿈 백화점', '사피엔스', '소년이 온다', '이처럼 사소한 것들', '아주 아주 아주 아주 긴 제목이 들어가면 어떻게 되는지 보는 제목', '책'];
  const sizes = [[30, 132, 92], [41.75, 160, 110], [22, 140, 100], [55, 175, 128], [28, 200, 140]];
  const titleCases = titles.flatMap((title) => sizes.map(([T, H, W]) => ({
    title, T, H, W,
    spine: spineTitleLayout(title, H, T * 0.94, 0.88, 1.0),
    spine79: spineTitleLayout(title, H, T * 0.94, 0.79, 0.91),
    lying: lyingTitleLayout(title, H, T),
    cover: coverTitleLayout(title, W, H),
  })));
  const colors = ['#4B6080', '#CF886E', '#627260', '#FDD594', '#8CA5BA', '#FEF1DF', '#3D5F57', '#A7AF95', '#9FA568', '#819AB1',
    '#CE886F', '#8D4F4E', '#F4BF9C', '#191F28', '#FFFFFF', '#000000', '#7D9CC0', '#E3A857', '#5B8C7A', '#B57BA6', '#C0C0C0', '#123456'];
  const colorCases = colors.map((c) => ({
    color: c, jacket: jacketColor(c), titleInk: titleInk(c), displayInkNone: displayInk(undefined, c), displayInkLegacy: displayInk('#2F3944', c),
    displayInkCustom: displayInk('#AA3311', c), tone: bindingSurfaceTone(jacketColor(c)), tabs: tabColors(c, 'book-1'), tabsNone: tabColors(undefined, `k${c}`),
    photoTone: bookTone({ themeColor: c, coverArtUri: 'x' } as AppBook), albedo: bookAlbedo(bindingSurfaceTone(jacketColor(c))),
    albedoPhoto: bookAlbedo(bookTone({ themeColor: c, coverArtUri: 'x' } as AppBook)),
  }));
  write(join(ROOT, 'test', 'fixtures'), 'book_art_cases.json', `${JSON.stringify({ note: '지금 앱 함수 결과(tool/dump_sksl.test.ts). 손으로 고치지 말 것', titleCases, colorCases })}\n`);
  // ---- 배치(지금 앱 computeShelf): 실제 책 비교 책장 넷과 변형(위치 없는 예전 저장본·기대는 방향 뒤집기) ----
  const bookJson = (b: AppBook) => ({ id: b.id, title: b.title, themeColor: b.themeColor, dims: b.dims, physical: b.physical });
  const layoutCase = (name: string, books: AppBook[], layout: ShelfLayout) => {
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
  };
  const noPos = (l: ShelfLayout): ShelfLayout => ({ ...l, placements: l.placements.map(({ pos: _p, ...rest }) => rest) });
  const flipped = (l: ShelfLayout): ShelfLayout => ({ ...l, placements: l.placements.map((p) => (p.tilt ? { ...p, tilt: (-p.tilt) as 7 | -7 } : p)) });
  const layoutCases = [
    layoutCase('real', REAL_BOOKS, REAL_LAYOUT),
    layoutCase('real-front', REAL_FRONT_BOOKS, REAL_FRONT_LAYOUT),
    layoutCase('real-side', REAL_SIDE_BOOKS, REAL_SIDE_LAYOUT),
    layoutCase('real-before', REAL_BEFORE[0], REAL_BEFORE[1]),
    layoutCase('real-nopos', REAL_BOOKS, noPos(REAL_LAYOUT)),
    layoutCase('real-flipped', REAL_BOOKS, flipped(REAL_LAYOUT)),
  ];
  // ---- 책 면이 받는 창빛 그림자(received3): 실사 책장 줄마다 책마다(ui/shelf/ShelfMotion occludersIn과 같은 가리개 고르기) ----
  const ceil = BOOK_MAX_H + 15 + 10; // ui/shelf/metrics ROW_SPACE(움푹 파인 책장은 맨 윗줄도 천장이 있다)
  const xr = (b: Book3) => { const xs = corners3(b).map((c) => c.x); return { lo: Math.min(...xs), hi: Math.max(...xs) }; };
  const recvCases = layoutCases.filter((c) => c.name === 'real' || c.name === 'real-side').flatMap((c) => Object.entries(c.frames).flatMap(([shelfId, fs]) => {
    const bodies = fs.map((f) => fromPlaced3(f.box as never));
    return bodies.map((b) => {
      const me = xr(b);
      const occ = bodies.filter((o) => o.id !== b.id).map((o) => underCeil(o, ceil)).filter((o): o is Book3 => !!o).filter((o) => { const r = xr(o); return !(r.hi < me.lo - REACH_L || r.lo > me.hi + REACH_R); });
      const r = receivedShadow3(b, occ, 2);
      return { layout: c.name, shelfId, bookId: b.id, faces: r ? r.faces.map((f) => ({ f: f.f, bands: f.bands.map((band) => band.map((l) => ({ poly: l.poly.map((q) => [q.x, q.y, q.z]), sigma: l.sigma, w: l.w }))) })) : [] };
    });
  }));
  write(join(ROOT, 'test', 'fixtures'), 'received_cases.json', `${JSON.stringify({ note: '지금 앱 receivedShadow3 결과(tool/dump_sksl.test.ts). 손으로 고치지 말 것', ceil, recvCases })}\n`);

  write(join(ROOT, 'test', 'fixtures'), 'layout_cases.json', `${JSON.stringify({ note: '지금 앱 computeShelf 결과(tool/dump_sksl.test.ts). 손으로 고치지 말 것', layoutCases })}\n`);

  // 실제 책 비교 책장(지금 앱 real-sample): Flutter 앱이 비어 있을 때 넣는 보기 서재. 표지는 YES24에서 받는다
  const q = (v: unknown) => (v === undefined || v === null ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v));
  const realRows = REAL_BOOKS.map((b) => {
    const goods = Number(/goods\/(\d+)/.exec(b.coverArtUri ?? '')?.[1] ?? 0);
    return `  (id: ${q(b.id)}, title: ${q(b.title)}, author: ${q(b.author)}, publisher: ${q(b.publisher)}, goods: ${goods}, widthMm: ${b.physical!.widthMm}, heightMm: ${b.physical!.heightMm}, pages: ${b.physical!.pages}, spineRatio: ${b.dims!.thickness / b.dims!.height}, color: ${q(b.themeColor)}, ribbon: ${q(b.art.ribbon)}, ribbonCount: ${b.art.ribbonCount ?? 0}),`;
  }).join('\n');
  const realPlacements = REAL_LAYOUT.placements.map((p) => `  (bookId: ${q(p.bookId)}, shelfId: ${q(p.shelfId)}, order: ${p.order}, pose: ${q(p.pose)}, tilt: ${p.tilt}, stackId: ${q(p.stackId)}, stackOrder: ${q(p.stackOrder)}, depth: ${q(p.depth)}, pitch: ${q(p.pitch)}, spin: ${q(p.spin)}),`).join('\n');
  write(join(ROOT, 'lib', 'gen'), 'real_sample.g.dart', `// 실제 책 비교 책장(지금 앱 domain/real-sample). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
// spineRatio: 지금 앱이 그리는 두께/높이(책등 사진 비율에서 정한 실제 두께)
library;

const realSampleBooks = [
${realRows}
];

const realSampleShelves = [${REAL_LAYOUT.shelves.map((s) => `(id: ${q(s.id)}, order: ${s.order})`).join(', ')}];

const realSamplePlacements = [
${realPlacements}
];
`);

  // 책 반사율(되비침): 장정 색 → 실제 반사율(light-model bookAlbedo)에 쓰는 값
  const L = lightSet();
  write(join(ROOT, 'lib', 'gen'), 'book_light.g.dart', `// 책 장정 색 → 반사율(지금 앱 light-model bookAlbedo)에 쓰는 값. tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
library;

import '../domain/vec3.dart';
import '../scene_config/skin.dart' show skinLight;

/// 화면 톤 곡선(발끝·어깨)
const toneToe = ${TONE.toe};
const toneK = ${TONE.k};
const toneShoulder = ${TONE.shoulder};

/// 카메라 이득과 벽 대표 자리 빛(스킨마다)
double get camGain => skinLight.camGain;
C3 get erefWall => skinLight.erefWall;

/// 구운 하늘 가림 담기(scene-light-sksl lossEncode·lossDecode): 0을 가운데 G0로 양쪽 제곱근 곡선
const lossG0 = ${LOSS_G0};
const lossRP = ${LOSS_RP};
const lossRN = ${LOSS_RN};

/// 하늘 빛(skyIrr = SKYC · (AMB + SKYTILT·n))
const skyC = C3(${SKY_C.join(', ')});
const ambient = ${light.ambient};
const skyTilt = (${light.skyTilt.x}, ${light.skyTilt.y}, ${light.skyTilt.z});

/// 장정 재질마다 대표 자리 빛·반사광(고운 종이·린넨·무광·줄무늬 종이, 스킨마다)
Map<String, C3> get bookErefOf => skinLight.bookErefOf;
Map<String, C3> get bookSrefOf => skinLight.bookSrefOf;
`);

  // 화면 아이콘(지금 앱 ui/icons.ts가 가져오는 lucide 아이콘만): SVG 마크업 그대로. {c} 색, {w} 선 굵기
  {
    const appRoot = join(ROOT, '..', 'app');
    const iconsTs = require('fs').readFileSync(join(process.cwd(), 'src', 'ui', 'icons.ts'), 'utf8') as string;
    const entries = [...iconsTs.matchAll(/export \{ default as (\w+) \} from 'lucide-react-native\/icons\/([\w-]+)';/g)].map((m) => [m[1], m[2]]);
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const lines = entries.map(([name, file]) => {
      const src = require('fs').readFileSync(join(process.cwd(), 'node_modules', 'lucide-react-native', 'dist', 'esm', 'icons', `${file}.mjs`), 'utf8') as string;
      const node = (new Function(`return ${/const __iconData = (\{[\s\S]*?\n\});\n__iconData\.node;/.exec(src)![1]}`)() as { node: [string, Record<string, string | number>][] }).node;
      const body = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${esc(String(v))}"`).join(' ')}/>`).join('');
      return `  '${name}': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>',`;
    });
    void appRoot;
    write(join(ROOT, 'lib', 'gen'), 'lucide.g.dart', `// 지금 앱 ui/icons.ts가 쓰는 lucide 아이콘(ISC). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
library;

/// 이름 → SVG({c} 색, {w} 선 굵기)
const lucideSvg = <String, String>{
${lines.join('\n')}
};
`);
  }

  // 장정 재질 띠(reference-bindings): 책 색 → 재질 색에 쓴다. Dart 상수로
  write(join(ROOT, 'lib', 'gen'), 'reference_bindings.g.dart', `// 장정 재질 띠(지금 앱 scene-config/reference-bindings.generated.json). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
// ignore_for_file: constant_identifier_names
library;

/// 색(대문자 #RRGGBB) → 띠(색들·자리들·가로 여부)
const referenceBindingProfiles = <String, ({List<String> colors, List<double> positions, bool horizontal})>{
${Object.entries(bindingProfiles as Record<string, { colors: string[]; positions: number[]; horizontal: boolean }>).map(([k, b]) => `  '${k}': (colors: [${b.colors.map((c) => `'${c}'`).join(', ')}], positions: [${b.positions.map((x) => (Number.isInteger(x) ? `${x}.0` : x)).join(', ')}], horizontal: ${b.horizontal}),`).join('\n')}
};
`);

  // 장면 그리기에 쓰는 값(재질 색·대표 자리 빛·반사광·표면 재질). light-model calibrate·surface-pattern을 옮기기 전까지 여기서 받는다
  const c3 = (v: readonly number[]) => `C3(${v.map((x) => (Number.isInteger(x) ? `${x}.0` : x)).join(', ')})`;
  const nums = (v: readonly number[]) => `[${v.map((x) => (Number.isInteger(x) ? `${x}.0` : x)).join(', ')}]`;
  const matOf = (name: keyof typeof MAT_UNIFORMS) => {
    const m = MAT_UNIFORMS[name];
    return `Mat(${nums(m.mRough)}, ${nums(m.mBump)}, ${nums(m.mGrain)}, ${nums(m.mGsize)})`;
  };
  const surf = (k: 'wall' | 'plank' | 'frame') => `Surface(${c3(DESIGN[k])}, ${c3(EREF[k])}, ${c3(SREF[k])}, ${matOf(surfaceMats[k])}, 0x${surfaces[k].slice(1).toUpperCase()})`;
  write(join(ROOT, 'lib', 'gen'), 'scene_uniforms.g.dart', `// 장면을 그리는 데 쓰는 값(재질 색 DESIGN · 대표 자리 빛 EREF · 반사광 SREF · 표면 재질 materials · 보이는 색 surfaces).
// tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것. 빛 설정이 바뀌면 다시 만들어야 한다
library;

import '../domain/vec3.dart';
import '../scene_config/skin.dart' show skinLight;

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

// 스킨마다 다른 값(지금 스킨 scene_config/skin.dart skinLight에서 읽는다. 표는 skin_lights.g.dart)
BookSurface get bookFine => skinLight.bookFine;

/// 갈피 탭 종이(무광 종이): 대표 자리 빛 · 반사광 · 표면
({C3 eref, C3 sref, Mat mat}) get tabPaper => skinLight.tabPaper;

Surface get wallSurface => skinLight.wall;
Surface get plankSurface => skinLight.plank;
Surface get frameSurface => skinLight.frame;
`);

  // 스킨마다 빛 맞추기 값(지금 앱 light-calibration.generated의 표 → switchSkin): 스토어에서 실행 중에 스킨을 바꿀 때 쓴다.
  // 벽 있는 책장(틀 있음)만: Flutter는 옆 벽이 있어 떨어짐 물리를 뺐고, 틀 없는 책장은 카메라·판 모양이 달라 실행 중에 못 바꾼다
  {
    const start: SkinChoice = { ...SKIN_CHOICE };
    const entries: string[] = [];
    for (const plank of Object.keys(PLANK_SKINS) as SkinChoice['plank'][]) {
      for (const frame of Object.keys(FRAME_SKINS) as SkinChoice['frame'][]) {
        if (!FRAME_SKINS[frame]) continue;
        for (const wall of Object.keys(WALL_SKINS) as SkinChoice['wall'][]) {
          if (!switchSkin({ plank, frame, wall })) throw new Error(`스킨 맞추기 없음 ${plank},${frame},${wall}`);
          const L2 = lightSet();
          const u = L2.u as Record<string, number[]>;
          const ms = ['fine', 'linen', 'matte', 'laid'] as const;
          entries.push(`  '${plank},${frame},${wall}': SkinLight(
    u: {${Object.keys(u).sort().map((k) => `'${k}': ${c3(u[k])}`).join(', ')}},
    camGain: ${L2.gain},
    erefWall: ${c3(L2.eref.wall)},
    bookErefOf: {${ms.map((m) => `'${m}': ${c3(bookEref(m))}`).join(', ')}},
    bookSrefOf: {${ms.map((m) => `'${m}': ${c3(bookSref(m))}`).join(', ')}},
    bookFine: BookSurface(${c3(bookEref('fine'))}, ${c3(bookSref('fine'))}, ${SPEC_K.fine}, ${matOf('fine')}, ${matOf('pages')}, ${c3(SREF.paper)}),
    tabPaper: (eref: ${c3(bookEref('paper'))}, sref: ${c3(bookSref('paper'))}, mat: ${matOf('paper')}),
    wall: ${surf('wall')},
    plank: ${surf('plank')},
    frame: ${surf('frame')},
  ),`);
        }
      }
    }
    switchSkin(start);
    write(join(ROOT, 'lib', 'gen'), 'skin_lights.g.dart', `// 스킨(선반,틀,벽지)마다 빛 맞추기 값(지금 앱 light-calibration.generated → switchSkin → lightSet). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것.
// 벽 있는 책장만(${entries.length}가지). 스토어에서 스킨을 고르면 scene_config/skin.dart의 skinLight가 이 표에서 바뀐다
// ignore_for_file: non_constant_identifier_names
library;

import '../domain/vec3.dart';
import 'scene_uniforms.g.dart';

class SkinLight {
  const SkinLight({required this.u, required this.camGain, required this.erefWall, required this.bookErefOf, required this.bookSrefOf, required this.bookFine, required this.tabPaper, required this.wall, required this.plank, required this.frame});

  /// 셰이더 맞추기 값(light-model lightSet().u)
  final Map<String, C3> u;
  final double camGain;
  final C3 erefWall;
  final Map<String, C3> bookErefOf;
  final Map<String, C3> bookSrefOf;
  final BookSurface bookFine;
  final ({C3 eref, C3 sref, Mat mat}) tabPaper;
  final Surface wall;
  final Surface plank;
  final Surface frame;
}

const skinLights = <String, SkinLight>{
${entries.join('\n')}
};
`);
  }

  expect(rows.length).toBe(7);
  const cells = rows.reduce((s2, r) => s2 + r.items.reduce((t, it) => t + it.w * it.h, 0), 0);
  console.log(`[dump] ${Object.entries(srcs).map(([n, s2]) => `${n} ${s2.split('\n').length}줄`).join(', ')}`);
  console.log(`[case] 줄 ${rows.length}개(맨 뒤는 값 확인용), 면 ${rows.reduce((t, r) => t + r.items.length, 0)}개 ${cells}칸, 상자 ${rows.map((r) => r.nBox).join('/')}`);
});
