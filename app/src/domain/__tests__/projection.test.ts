// 공통 카메라 투영: 3D 좌표가 화면(책 그림 포함)까지 그대로 전달되는지. 눕힌 책 한 권으로 본다.
import { faceMatrix } from '@/ui/book3d/face-geometry';

import { corners, faceCorners, faceFrame, fromPlaced, lowest } from '../book3';
import { bookViewCam } from '../book-view';
import { facePanel } from '../book-parts';
import { project } from '../box';
import { camAt, VIEW_KX } from '../camera';
import { CAMERA, SHELF_DEPTH, SHELF_FRONT, VIEW_PITCH_MAX, VIEW_PITCH_MIN } from '../geometry';
import { normalize, placementOf, setSpin, type BookMap } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { shelfVertices } from '../shelf-geom';
import { computeShelf } from '../shelf-scene';
import type { ShelfLayout } from '../types';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));

// 3번째 선반에 나미야 한 권만(나머지는 서랍)
function lone(depth?: number): ShelfLayout {
  const p = SAMPLE_LAYOUT.placements.find((q) => q.bookId === 'b12')!;
  return normalize({
    ...SAMPLE_LAYOUT,
    placements: [{ ...p, stackId: undefined, stackOrder: undefined, pos: 120, depth }],
    drawer: SAMPLE_LAYOUT.placements.filter((q) => q.bookId !== 'b12').map((q) => q.bookId),
  });
}

function spineAt(layout: ShelfLayout) {
  const f = computeShelf(layout, books, 'shelf-3').frames.find((q) => q.bookId === 'b12')!;
  const b = fromPlaced(f.box!);
  const c = corners(b);
  // 책등 면 [아래 왼쪽(머리), 아래 오른쪽, 위 오른쪽, 위 왼쪽] 순서를 화면 x로 정리
  const pts = faceCorners('spine').map((i) => ({ w: c[i], s: project(CAMERA, c[i]) }));
  const bottom = pts.filter((q) => q.w.y < 0.01).sort((a, d) => a.s.x - d.s.x);
  return { b, pts, bottom };
}

describe('공통 카메라', () => {
  it('살짝 내려다보는 한 카메라: ky = tan(내려다보는 각)', () => {
    expect(VIEW_PITCH_MIN).toBeGreaterThan(0);
    // 기본 카메라(CAMERA)는 가장 얕은 3°. 꾸미기 보기 각(3°~8°)도 같은 식이고 사선 kx는 각과 무관
    expect(CAMERA.ky).toBeCloseTo(Math.tan((VIEW_PITCH_MIN * Math.PI) / 180), 12);
    for (const deg of [VIEW_PITCH_MIN, 5, VIEW_PITCH_MAX]) {
      expect(camAt(deg).ky).toBeCloseTo(Math.tan((deg * Math.PI) / 180), 12);
      expect(camAt(deg).kx).toBe(VIEW_KX);
    }
  });

  it('선반 판도 같은 카메라로 투영한 자리: 윗면 뒤 모서리(벽)·앞 모서리', () => {
    // 원점 = 책 기준선(판 윗면 z=0): 벽 쪽 모서리는 기준선 위(-)로 깊이 × ky, 앞 모서리는 아래(+)로 앞 길이 × ky
    const v = shelfVertices();
    for (const cam of [CAMERA, camAt(VIEW_PITCH_MAX)]) {
      expect(project(cam, v.LBT).y).toBeCloseTo(-SHELF_DEPTH * cam.ky, 9);
      expect(project(cam, v.LFT).y).toBeCloseTo(SHELF_FRONT * cam.ky, 9);
    }
  });
});

describe('눕힌 책 한 권 돌리기(-12 / 0 / +12)', () => {
  const at = (deg: number) => {
    const r = setSpin(lone(), books, 'b12', deg);
    const l = r.ok ? r.layout : lone();
    return { applied: placementOf(l, 'b12')!.spin ?? 0, ...spineAt(l) };
  };

  it('요청한 각도가 그대로 적용된다(주변 책 없음)', () => {
    for (const d of [-12, 0, 12]) expect(at(d).applied).toBe(d);
  });

  it('앞면 아래 모서리의 화면 높이 차이가 회전 방향에 따라 반대로 바뀌고, 차이 = 깊이 차 × ky', () => {
    const dy = (d: number) => {
      const { bottom } = at(d);
      const [l, r] = [bottom[0], bottom[bottom.length - 1]];
      expect(r.s.y - l.s.y).toBeCloseTo((l.w.z - r.w.z) * CAMERA.ky, 9);
      return r.s.y - l.s.y; // 오른쪽 끝이 아래(+)면 오른쪽이 앞으로 나온 것
    };
    expect(dy(0)).toBeCloseTo(0, 9);
    // 양 끝 깊이 차(약 33DU) × ky만큼: -12면 오른쪽 끝이 앞으로 → 화면에서 더 아래
    expect(dy(-12)).toBeGreaterThan(30 * CAMERA.ky);
    expect(dy(12)).toBeLessThan(-30 * CAMERA.ky);
    expect(dy(12)).toBeCloseTo(-dy(-12), 6);
  });

  it('책등 그림 네 모서리가 투영된 앞면 네 모서리에 정확히 붙는다(바운딩 박스 아님)', () => {
    const px = { s: 1080 / 390, tx: 33, ty: -40 };
    for (const d of [-12, 0, 12]) {
      const { b, pts } = at(d);
      const m = faceMatrix(b, 'spine', CAMERA, px);
      const fr = faceFrame(b.dims, 'spine');
      const map = (u: number, v: number) => ({ x: m[0] * u + m[1] * v + m[2], y: m[3] * u + m[4] * v + m[5] });
      const w = fr.w * px.s;
      const h = fr.h * px.s;
      // 그림 (0,0)=O, (w,0)=O+U, (0,h)=O+V
      const pic = [map(0, 0), map(w, 0), map(w, h), map(0, h)];
      const want = pic.map((q) => pts.some((p) => Math.abs(p.s.x * px.s + px.tx - q.x) < 1e-6 && Math.abs(p.s.y * px.s + px.ty - q.y) < 1e-6));
      expect(want).toEqual([true, true, true, true]);
    }
  });

  it('책은 선반 윗면(y=0)에 닿아 있다: 뜨거나 파고들지 않음', () => {
    for (const d of [-12, 0, 12]) expect(lowest(at(d).b)).toBeCloseTo(0, 9);
  });

  it('눕힌 표지의 원근 변환은 돌린 책에서도 그림과 몸체의 네 모서리가 일치한다', () => {
    const px = { s: 2.2, tx: 26, ty: 630 };
    for (const d of [-12, 0, 12]) {
      const { b } = at(d);
      const cam = bookViewCam(CAMERA, b);
      for (const face of ['spine', 'cover', 'back'] as const) {
        const matrix = faceMatrix(b, face, cam, px);
        const fr = facePanel(b.dims, face);
        const pts = faceCorners(face).map(i => project(cam, corners(b)[i]));
        for (const [u, v] of [[0, 0], [fr.w * px.s, 0], [fr.w * px.s, fr.h * px.s], [0, fr.h * px.s]]) {
          const den = matrix[6] * u + matrix[7] * v + matrix[8];
          const x = (matrix[0] * u + matrix[1] * v + matrix[2]) / den;
          const y = (matrix[3] * u + matrix[4] * v + matrix[5]) / den;
          expect(pts.some(p => Math.abs(p.x * px.s + px.tx - x) < 1e-6 && Math.abs(p.y * px.s + px.ty - y) < 1e-6)).toBe(true);
        }
      }
    }
  });

  it('눕힌 책의 모든 모서리는 선반·그림자와 같은 카메라를 쓴다', () => {
    for (const spin of [-12, 0, 12]) {
      const { b } = at(spin);
      const base = corners(b).map(p => project(CAMERA, p));
      const view = bookViewCam(CAMERA, b);
      const shown = corners(b).map(p => project(view, p));
      expect(Math.min(...shown.map(p => p.x))).toBeCloseTo(Math.min(...base.map(p => p.x)), 8);
      expect(Math.max(...shown.map(p => p.x))).toBeCloseTo(Math.max(...base.map(p => p.x)), 8);
      expect(shown).toEqual(base);
      // The cover remains parallel to the floor at precisely the book thickness.
      for (const p of corners(b).filter(p => Math.abs(p.y - b.dims.T) < 1e-6)) {
        const cover = project(view, p);
        const floor = project(CAMERA, { ...p, y: 0 });
        expect(cover.x).toBeCloseTo(floor.x, 8);
        expect(floor.y - cover.y).toBeCloseTo(b.dims.T, 8);
      }
    }
    for (const f of computeShelf(SAMPLE_LAYOUT, books, 'shelf-3').frames) {
      const b = fromPlaced(f.box);
      expect(bookViewCam(CAMERA, b)).toBe(CAMERA);
    }
  });
});

it('같은 높이에서 앞뒤로 옮기면 선반 윗면을 따라 화면 위치가 변한다', () => {
  const a = spineAt(lone(0)).bottom[0];
  const b = spineAt(lone(60)).bottom[0];
  expect(b.w.y).toBeCloseTo(a.w.y, 9);
  expect(b.w.z - a.w.z).toBeCloseTo(60, 6);
  expect(a.s.y - b.s.y).toBeCloseTo(60 * CAMERA.ky, 6); // 벽 쪽일수록 위
  expect(b.s.x - a.s.x).toBeCloseTo(60 * CAMERA.kx, 6);
});
