// 재질 무늬(domain/surface-pattern): 결은 평균 1(재질 색 그대로)이고 화소가 커져도 평균이 지켜지는지, 미세 높이의 기울기 RMS가 재질 값인지,
// 화소보다 작은 높이 몫이 거칠기로 옮겨 가는지(Toksvig), 결을 곱해도 반사율이 1을 넘지 않는지
import palette from '@/ui/art/reference-bindings.generated.json';
import { materials } from '@/ui/lighting';

import { bookAlbedo, ROUGH } from '../light-model';
import { GRAIN_KIND, MAT_UNIFORMS, matSample, VN_GRAD_RMS } from '../surface-pattern';

const NAMES = Object.keys(materials) as (keyof typeof materials)[];
// 고르게 흩은 표본 점(R2 저불일치 수열: 두 축이 서로 묶이지 않는다)
function points(n: number, span: number) {
  const a1 = 0.7548776662466927;
  const a2 = 0.5698402909980532;
  return Array.from({ length: n }, (_, i) => [((0.5 + a1 * i) % 1) * span + 3.1, ((0.5 + a2 * i) % 1) * span + 7.7]);
}

describe('재질 무늬', () => {
  it('값 잡음 기울기 RMS는 0보다 크고 유한하다', () => {
    expect(VN_GRAD_RMS).toBeGreaterThan(0.3);
    expect(VN_GRAD_RMS).toBeLessThan(3);
  });

  it.each(NAMES)('%s: 결의 평균은 1(화소가 작을 때도, 클 때도)', (name) => {
    const M = MAT_UNIFORMS[name];
    for (const fp of [1e-4, 0.3, 3]) {
      const pts = points(20000, 400);
      const mean = pts.reduce((s, [u, v]) => s + matSample(u, v, fp, fp, M).f, 0) / pts.length;
      expect(mean).toBeCloseTo(1, 2);
    }
  });

  it.each(NAMES.filter((n) => materials[n].bump))('%s: 다 보일 때 미세 높이의 기울기 RMS = 재질 값, 거칠기는 바탕 값', (name) => {
    const M = MAT_UNIFORMS[name];
    const m = materials[name];
    const pts = points(20000, 400);
    let s2 = 0;
    for (const [u, v] of pts) {
      const s = matSample(u, v, 1e-5, 1e-5, M);
      s2 += s.su * s.su + s.sv * s.sv;
      expect(s.r).toBeCloseTo(m.roughness, 6);
    }
    expect(Math.sqrt(s2 / pts.length) / m.bump!.slope).toBeCloseTo(1, 1);
  });

  it.each(NAMES)('%s: 화소가 무늬보다 훨씬 크면 법선 무늬는 없고 그 몫은 거칠기(멀리서 본 거칠기 ROUGH)에 들어 있다', (name) => {
    const s = matSample(12.3, 45.6, 1e3, 1e3, MAT_UNIFORMS[name]);
    expect(s.su).toBeCloseTo(0, 12);
    expect(s.sv).toBeCloseTo(0, 12);
    expect(s.r).toBeCloseTo(ROUGH[name], 9);
    expect(s.r).toBeGreaterThanOrEqual(materials[name].roughness);
  });

  it('결을 곱해도 반사율은 1을 넘지 않는다(장정 재질 × 가장 밝은 시안 장정 색)', () => {
    for (const name of ['paper', 'cloth', 'coated'] as const) {
      const [kind, c1, c2] = MAT_UNIFORMS[name].mGrain;
      const fmax = kind === GRAIN_KIND.none ? 1 : 1 + c1 + c2;
      for (const hex of Object.keys(palette)) expect(Math.max(...bookAlbedo(hex, ROUGH[name])) * fmax).toBeLessThanOrEqual(1);
    }
  });
});
