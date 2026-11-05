// 순백 벽지(#FFFFFF, 2026-11-05 사용자 '배경색을 책장에서도'): 톤 곡선이 끝없이 커지지 않고 벽 그늘과 다른 재질 색이 그대로 남는다
jest.mock('@/scene-config/palette', () => ({ ...jest.requireActual('@/scene-config/palette'), sceneColors: { wall: '#FFFFFF' } }));

import { ALBEDO, CAM, DESIGN, toneTarget } from '../light-model';

const srgb = (y: number) => 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);

describe('순백 벽지', () => {
  it('대표 자리에서 화면 255로 보이고 이득이 튀지 않는다', () => {
    for (const a of DESIGN.wall) expect(Math.round(srgb(toneTarget(a, 1, 0, 0)))).toBe(255);
    expect(CAM.gain).toBeLessThan(3);
  });
  it('받는 빛이 줄면 벽이 어두워지고(그늘이 남는다), 다른 재질 반사율도 0으로 눌리지 않는다', () => {
    for (const a of DESIGN.wall) expect(srgb(toneTarget(a, 0.5, 0, 0))).toBeLessThan(205);
    for (const v of ALBEDO.plank) expect(v).toBeGreaterThan(0.2);
    for (const v of ALBEDO.wall) expect(v).toBeLessThanOrEqual(1);
  });
});
