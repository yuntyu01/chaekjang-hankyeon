// 책 몸체 구조(판 두 장·책등 띠·속지 묶음·판 끝 여유)는 책 좌표에서 정해 같은 카메라로 투영한다(domain/book-parts, face-geometry).
// 속지 면은 판 끝보다 sq 안쪽 평면에 있어, 앞 면에 가려지는 부분은 카메라가 정한다. 둥근 모서리는 투영 윤곽을 깎을 뿐 상자 밖으로 나가지 않는다.
import { EDGE_R, pageFace, rigOf, SQUARE } from '../book-parts';
import { corners, facing, fromPlaced, frontBook3, toWorld, type Book3 } from '../book3';
import { hull } from '../box';
import { camAt, project, viewAt } from '../camera';
import { faceVisible, pageGeom, silhouette } from '../../ui/book3d/face-geometry';

const px = { s: 3, tx: 0, ty: 0 };
const dims = { T: 22, H: 150, W: 100 };
const standing: Book3 = { id: 'a', dims, roll: 0, yaw: 0, t: { x: 0, y: 0, z: 0 } };

type P = { x: number; y: number };
const screen = (cam: ReturnType<typeof camAt>, b: Book3, v: { x: number; y: number; z: number }) => {
  const q = project(cam, toWorld(b, v));
  return { x: q.x * px.s, y: q.y * px.s };
};

function inside(p: P, poly: P[]) {
  // 볼록 다각형(반시계든 시계든) 안쪽 또는 경계 위
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-6) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

describe('책 몸체 구조', () => {
  it('판 두 장은 두께 방향 양끝, 속지는 그 사이에서 판 끝보다 sq 안쪽', () => {
    const { bd, sp, sq } = rigOf(dims);
    expect(sq).toBe(SQUARE);
    const head = pageFace(dims, 'head');
    expect(head.rims).toHaveLength(3); // 앞·뒤 판 끝, 책등 띠 끝
    expect(head.page.O).toEqual({ x: bd, y: dims.H - sq, z: sp });
    expect(head.page.w).toBeCloseTo(dims.T - 2 * bd, 9);
    expect(head.page.h).toBeCloseTo(dims.W - sq - sp, 9);
    const fore = pageFace(dims, 'fore');
    expect(fore.rims).toHaveLength(2);
    expect(fore.page.O.z).toBeCloseTo(dims.W - sq, 9);
    expect(fore.page.h).toBeCloseTo(dims.H - 2 * sq, 9);
  });

  it('세운 책 머리: 들어간 속지는 앞쪽 sq/ky(머리 높이에서 본 기울기)만큼 책등 뒤로 숨고, 8°에서는 더 많이 보인다', () => {
    for (const deg of [3, 8]) {
      const cam = camAt(deg);
      const g = pageGeom(cam, standing, 'head', px);
      expect(g.ok).toBe(true);
      const { sp, sq } = rigOf(dims);
      // 이 깊이(책등 면 z = 0부터)까지는 책등 윗모서리보다 아래로 투영된다. 원근 카메라라 머리 높이에서 본 기울기(눈높이 - 머리) / 거리
      const kyHead = viewAt(cam, toWorld(standing, { x: dims.T / 2, y: dims.H, z: 0 })).ky;
      const hiddenTo = sq / kyHead;
      const spineTop = screen(cam, standing, { x: dims.T / 2, y: dims.H, z: 0 }).y;
      const pageAt = (z: number) => screen(cam, standing, { x: dims.T / 2, y: dims.H - sq, z }).y;
      expect(pageAt(hiddenTo - 1)).toBeGreaterThan(spineTop); // 화면 아래(= 책등 면 뒤)
      expect(pageAt(Math.min(dims.W - sq, hiddenTo + 1))).toBeLessThan(spineTop);
      // 속지 조각 행렬의 원점 = 들어간 평면의 앞 왼쪽 모서리(원근 카메라의 행렬은 동차라 마지막 성분으로 나눈다)
      expect(g.pageM[2] / g.pageM[8]).toBeCloseTo(screen(cam, standing, { x: rigOf(dims).bd, y: dims.H - sq, z: sp }).x, 6);
      expect(g.pageM[5] / g.pageM[8]).toBeCloseTo(screen(cam, standing, { x: rigOf(dims).bd, y: dims.H - sq, z: sp }).y, 6);
    }
    // 더 내려다보면(8°) 숨는 깊이가 짧다
    const kyAt = (deg: number) => viewAt(camAt(deg), toWorld(standing, { x: dims.T / 2, y: dims.H, z: 0 })).ky;
    expect(SQUARE / kyAt(8)).toBeLessThan(SQUARE / kyAt(3));
  });

  it('안쪽 벽은 카메라 쪽을 향한 것만 그린다(사선 kx > 0: 왼쪽 판 안쪽 면)', () => {
    const cam = camAt(3);
    const g = pageGeom(cam, standing, 'head', px);
    // 왼쪽(뒤표지) 판 안쪽 면(법선 +x)만 보이고, 오른쪽 판 안쪽 면·책등 띠 안쪽 면(법선 +z, 뒤를 향함)은 안 보인다
    const shown = g.walls.filter((w) => w.length);
    expect(shown).toHaveLength(1);
    const xs = shown[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(screen(cam, standing, { x: dims.T / 2, y: dims.H, z: 0 }).x);
  });

  it('눕힌 책 끝면: 두께 방향이 세로가 되어 판 끝은 위·아래에 놓인다', () => {
    const cam = camAt(8);
    const lying = [90, -90]
      .map((roll): Book3 => ({ id: 'b', dims, roll, yaw: 0, t: { x: 0, y: 0, z: 0 } }))
      .find((b) => ['head', 'tail'].some((f) => facing(cam, b, f as 'head' | 'tail') > 0.002))!;
    const f = facing(cam, lying, 'head') > 0.002 ? 'head' : 'tail';
    const g = pageGeom(cam, lying, f, px);
    expect(g.ok).toBe(true);
    // 판 끝 두 개(앞·뒤 판)의 가운데가 화면 세로로 떨어져 있다
    const mid = (pts: P[]) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
    const a = mid(g.rims[0]);
    const b = mid(g.rims[1]);
    expect(Math.abs(a.y - b.y)).toBeGreaterThan(Math.abs(a.x - b.x));
  });

  it('둥근 윤곽은 투영 상자(8 꼭짓점의 볼록 껍질) 안에만 있다: 그리는 모양이 충돌 상자를 넘지 않는다', () => {
    const poses: Book3[] = [
      standing,
      { ...standing, roll: 7 },
      { ...standing, roll: -12 },
      { ...standing, roll: 90 },
      { ...standing, yaw: 90 },
      { ...standing, yaw: 90, pitch: 14 },
      { ...standing, roll: 90, spin: 20 },
    ];
    for (const deg of [3, 8]) {
      const cam = camAt(deg);
      for (const b of poses) {
        const box = hull(corners(b).map((c) => {
          const q = project(cam, c);
          return { x: q.x * px.s, y: q.y * px.s };
        }));
        const sil = silhouette(cam, b, px);
        expect(sil.length).toBeGreaterThanOrEqual(box.length);
        for (const p of sil) expect(inside(p, box)).toBe(true);
        // 모서리에서 깎인 거리는 공통 반지름을 넘지 않는다
        for (const c of box) {
          const nearest = Math.min(...sil.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
          expect(nearest).toBeLessThanOrEqual(EDGE_R * px.s + 1e-6);
        }
      }
    }
  });

  it('얇은 윗면 띠(표지 전시 책, 기본 4°에서 몇 px)가 있어도 위 모서리는 반지름 r로 둥글다(꼭짓점마다 깎으면 1~2px로 줄던 것)', () => {
    const cam = camAt(3);
    const b = fromPlaced({ bookId: 'f', pose: 'front', size: { w: 100, h: 150, d: 22 }, x: 10, y: 0, z: 0, angle: 0 });
    const box = hull(corners(b).map((c) => {
      const q = project(cam, c);
      return { x: q.x * px.s, y: q.y * px.s };
    }));
    const sil = silhouette(cam, b, px);
    const r = EDGE_R * px.s;
    // 앞면 위 끝과 얇은 띠를 한 모서리로 본 왼쪽 위 모서리(외곽 상자의 모서리)에서 윤곽까지 r(√2−1): 직각 모서리를 반지름 r로 둥글린 거리
    const corner = { x: Math.min(...box.map((p) => p.x)), y: Math.min(...box.map((p) => p.y)) };
    const cut = Math.min(...sil.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)));
    expect(cut).toBeGreaterThanOrEqual(r * (Math.SQRT2 - 1) * 0.9);
    // 둥근 부분은 왼쪽 변·윗변을 따라 r 안팎에서 시작한다(띠 두께 몇 px로 줄지 않는다)
    const left = sil.filter((p) => Math.abs(p.x - corner.x) < 0.01);
    expect(Math.min(...left.map((p) => p.y)) - corner.y).toBeGreaterThanOrEqual(r * 0.9);
  });

  it('선반 위 정지 자세(fromPlaced)에서도 같은 규칙: 윤곽 아래 끝이 바닥(판 윗면)을 넘지 않는다', () => {
    const cam = camAt(3);
    const b = fromPlaced({ bookId: 'c', pose: 'spine', size: { w: 22, h: 150, d: 100 }, x: 10, y: 0, z: 0, angle: 0 });
    const sil = silhouette(cam, b, px);
    // 바닥 앞 모서리(y = 0, z = 0)는 화면 y = 0. 윤곽은 그보다 아래로 내려가지 않는다(판을 뚫지 않는다)
    expect(Math.max(...sil.map((p) => p.y))).toBeLessThanOrEqual(1e-6);
  });

  it('뒤로 젖힌 표지 책의 꼬리는 들려 있어 그린다(받침에 닿은 아래 면만 뺀다)', () => {
    const cam = camAt(3);
    // 31° 젖힘: 뒤쪽 아래 모서리만 선반에 닿고 앞 끝은 T·sin31만큼 들린다
    const leaning = frontBook3('f', dims, 50, 0, 31);
    expect(faceVisible(cam, leaning, 'tail')).toBe(true);
    const g = pageGeom(cam, leaning, 'tail', px);
    expect(g.ok).toBe(true);
    expect(g.opening.length).toBeGreaterThanOrEqual(3);
    // 똑바로 선 책·바닥에 누운 책의 아래 면은 받침에 닿아 있어 빼던 그대로
    expect(faceVisible(cam, frontBook3('f', dims, 50, 0, 0), 'tail')).toBe(false);
    expect(faceVisible(cam, frontBook3('f', dims, 50, 0, 90), 'back')).toBe(false);
  });
});
