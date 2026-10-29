// 재질 무늬(scene-config/lighting materials의 결·미세 높이)를 셰이더 입력으로 묶고, 셰이더(scene-light-sksl materialCode)와 같은 식을 JS로도 둔다
// (테스트·통계: 결의 평균이 1인지, 미세 높이의 기울기 RMS가 재질 값인지, 화소보다 작은 무늬가 평균으로 줄어드는지).
// 면 좌표 (u, v)는 DU, 화소가 덮는 면 길이 fu·fv도 DU.
import { materials, type SurfaceMaterial } from '@/scene-config/lighting';

import { mm } from './geometry';

// 격자점 해시(0~1). 셰이더와 같은 식(사인 없이: 단정밀도에서도 고르다)
export function hash12(x: number, y: number) {
  const fr = (v: number) => v - Math.floor(v);
  let a = fr(x * 0.1031);
  let b = fr(y * 0.1031);
  let c = fr(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fr((a + b) * c);
}
// 값 잡음(격자 값 −1~1, 3차 보간)과 그 기울기: [값, ∂/∂x, ∂/∂y]
export function vnoise(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const wx = fx * fx * (3 - 2 * fx);
  const wy = fy * fy * (3 - 2 * fy);
  const dwx = 6 * fx * (1 - fx);
  const dwy = 6 * fy * (1 - fy);
  const a = hash12(ix, iy) * 2 - 1;
  const b = hash12(ix + 1, iy) * 2 - 1;
  const c = hash12(ix, iy + 1) * 2 - 1;
  const d = hash12(ix + 1, iy + 1) * 2 - 1;
  const k = a - b - c + d;
  return [a + (b - a) * wx + (c - a) * wy + k * wx * wy, dwx * (b - a + k * wy), dwy * (c - a + k * wx)];
}
// 값 잡음 기울기 한 성분의 RMS: 미세 높이 진폭을 재질의 기울기 RMS에 맞출 때 나눈다(격자 칸 256개를 칸마다 8×8 점으로)
export const VN_GRAD_RMS = (() => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < 128; i++)
    for (let j = 0; j < 128; j++) {
      const g = vnoise(i / 8 + 0.0625, j / 8 + 0.0625);
      s += g[1] * g[1] + g[2] * g[2];
      n += 2;
    }
  return Math.sqrt(s / n);
})();

export const GRAIN_KIND = { none: 0, fiber: 1, weave: 2, sheets: 3, wood: 4 } as const;
// 셰이더 입력: mRough = (거칠기 r, 기울기 RMS), mBump = (1/크기 u, 1/크기 v, 진폭, 천 올이면 1), mGrain = (종류, 세기 1, 세기 2, 접장 틈 폭), mGsize = (크기 1, 크기 2)
// 접장 사이 틈 폭(속지 sheets): 낱장 1.5장(0.1mm × 1.5)
export const SHEET_GAP = mm(0.15);
// 미세 높이 진폭: 값 잡음은 높이 H(DU)로 E|∇h|² = H²·g²·(1/su² + 1/sv²)이 slope²이 되게, 천 올(h = H·sin(ku)·sin(kv))은 기울기 진폭 H·k = √2·slope
export type MatUniforms = { mRough: number[]; mBump: number[]; mGrain: number[]; mGsize: number[] };
export function matUniforms(m: SurfaceMaterial): MatUniforms {
  const b = m.bump;
  let bump = [1, 1, 0, 0];
  if (b && b.weave) bump = [1 / mm(b.size[0]), 1 / mm(b.size[1]), Math.SQRT2 * b.slope, 1];
  else if (b) {
    const iu = 1 / mm(b.size[0]);
    const iv = 1 / mm(b.size[1]);
    bump = [iu, iv, b.slope / (VN_GRAD_RMS * Math.hypot(iu, iv)), 0];
  }
  const g = m.grain;
  return {
    mRough: [m.roughness, b ? b.slope : 0],
    mBump: bump,
    mGrain: [GRAIN_KIND[g.kind], g.contrast[0], g.contrast[1], g.kind === 'sheets' ? SHEET_GAP : 0],
    mGsize: [mm(g.size[0]), mm(g.size[1])],
  };
}
export const MAT_UNIFORMS = Object.fromEntries(Object.entries(materials).map(([k, m]) => [k, matUniforms(m)])) as Record<keyof typeof materials, MatUniforms>;

// 무늬가 보이는 몫: 무늬 크기가 화소 2개 아래면 0, 4개 위면 1(그 사이 부드럽게)
export function seenOf(size: number, fp: number) {
  const x = Math.min(1, Math.max(0, (size / Math.max(fp, 1e-9) - 2) / 2));
  return x * x * (3 - 2 * x);
}
// 주기 pulse(한 주기 1 중 끝쪽 q 폭이 1인 띠)의 0~x 적분
function pulseInt(x: number, q: number) {
  const fx = x - Math.floor(x);
  return Math.floor(x) * q + Math.min(q, Math.max(0, fx - (1 - q)));
}
// 화소 한 칸 [x − w/2, x + w/2]에 걸친 띠 넓이 비(주기 1, 띠 폭 q, 화소 폭 w: 주기 단위)
export function pulseCover(x: number, q: number, w: number) {
  if (w < 1e-6) return x - Math.floor(x) >= 1 - q ? 1 : 0;
  return (pulseInt(x + w / 2, q) - pulseInt(x - w / 2, q)) / w;
}

// 결(반사율 배수 f)의 가장 큰 값: 반사율 × 이 값이 1을 넘지 않아야 한다(받은 빛보다 많이 되비추는 점은 없다). matSample의 kind별 식에서
export function grainPeak(M: MatUniforms) {
  const [kind, c1, c2, gap] = M.mGrain;
  const [, s2] = M.mGsize;
  if (kind === GRAIN_KIND.fiber || kind === GRAIN_KIND.weave) return 1 + c1 + c2;
  if (kind === GRAIN_KIND.sheets) return 1 + c1 + (c2 * gap) / s2;
  if (kind === GRAIN_KIND.wood) return 1 + c1 * 0.25 + c2;
  return 1;
}

// 한 점의 재질 표본: 미세 높이의 기울기(면 u·v 방향, 법선을 n − su·U − sv·V로 기울인다), 반사율 배수 f, 거칠기 r(그리지 못한 높이 몫 포함).
// 셰이더 materialCode matSample과 같은 식
export function matSample(u: number, v: number, fu: number, fv: number, M: MatUniforms) {
  const [r0, slope] = M.mRough;
  const [iu, iv, amp, weave] = M.mBump;
  let su = 0;
  let sv = 0;
  let seen = 0;
  if (amp > 0) {
    if (weave > 0.5) {
      const k = 2 * Math.PI * iu;
      seen = seenOf(0.5 / iu, fu) * seenOf(0.5 / iv, fv);
      su = amp * Math.cos(k * u) * Math.sin(k * v) * seen;
      sv = amp * Math.sin(k * u) * Math.cos(k * v) * seen;
    } else {
      seen = seenOf(1 / iu, fu) * seenOf(1 / iv, fv);
      const g = vnoise(u * iu, v * iv);
      su = amp * g[1] * iu * seen;
      sv = amp * g[2] * iv * seen;
    }
  }
  const a = r0 * r0;
  const r = Math.sqrt(Math.sqrt(a * a + 2 * slope * slope * (1 - seen * seen)));
  const [kind, c1, c2, gap] = M.mGrain;
  const [s1, s2] = M.mGsize;
  const fm = Math.max(fu, fv);
  let f = 1;
  if (kind === GRAIN_KIND.fiber) {
    f += c1 * vnoise(u / s1, v / s1)[0] * seenOf(s1, fm) + c2 * vnoise(u / s2 + 17, v / s2 + 31)[0] * seenOf(s2, fm);
  } else if (kind === GRAIN_KIND.weave) {
    const k = (2 * Math.PI) / s1;
    f += c1 * Math.cos(k * u) * Math.cos(k * v) * seenOf(s1 / 2, fm) + c2 * vnoise(u / s2 + 17, v / s2 + 31)[0] * seenOf(s2, fm);
  } else if (kind === GRAIN_KIND.sheets) {
    // 묶음 결: 두께 방향(u)으로 s1 크기, 가장자리 길이(v)로 30배 길게 이어지는 밝기 차(값 잡음은 칸 하나가 부드럽게 이어져 칸 두 배 크기로 보이는지 본다)
    // + 접장 사이 틈(간격 s2마다 조금씩 어긋난 자리, 폭 gap: 화소 안 넓이 비로)
    f += c1 * vnoise(u / s1 + 13, v / (30 * s1))[0] * seenOf(2 * s1, fu);
    const w = gap;
    const k0 = Math.floor(u / s2);
    let cover = 0;
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const b = (k + 0.5 + 0.35 * (hash12(k, 3) * 2 - 1)) * s2;
      const lo = Math.max(b - w / 2, u - fu / 2);
      const hi = Math.min(b + w / 2, u + fu / 2);
      cover += Math.max(0, hi - lo);
    }
    f -= c2 * (Math.min(1, cover / Math.max(fu, 1e-6)) - w / s2);
  } else if (kind === GRAIN_KIND.wood) {
    // 나이테(판 길이 u 방향으로 이어진 늦재 띠, 폭 0.25주기): 결이 천천히 굽이친다. 화소 안 넓이 비로
    const warp = vnoise(u / (40 * s1), v / (4 * s1) + 5)[0] * 1.5;
    const q = 0.25;
    f -= c1 * (pulseCover(v / s1 + warp, q, fv / s1) - q);
    f += c2 * vnoise(u / s2 + 11, (v * 6) / s2)[0] * seenOf(s2 / 6, fv);
  }
  return { su, sv, f, r, seen };
}
