// 종이 단면 구조(판 두 장·속지 묶음·종이 결)는 책 좌표에서 정해 투영한다: 세우기·눕히기 뒤에도 판은 두께 방향 양끝에,
// 종이 결은 판과 나란하게 따라간다. 판 사이 속지는 면 안에 있다.
import { sideFaceGeom } from '../../ui/book3d/face-geometry';
import { facing, type Book3 } from '../book3';

const px = { s: 3, tx: 0, ty: 0 };
const cam = { kx: 0.035, ky: Math.tan((8 * Math.PI) / 180) };
const dims = { T: 22, H: 150, W: 100 };

type P = { x: number; y: number };
// 두께 방향(속지 앞 모서리 inner[0] → inner[1]) 위의 위치. 판 두 장·속지가 이 축에서 판 | 속지 | 판 순서인지 본다
function alongThickness(g: ReturnType<typeof sideFaceGeom>) {
  const a = g.inner![0];
  const b = g.inner![1];
  const t = { x: b.x - a.x, y: b.y - a.y };
  const at = (p: P) => ((p.x - a.x) * t.x + (p.y - a.y) * t.y) / (t.x * t.x + t.y * t.y);
  return { hi: g.boardHi.map((l) => at(l[0])).sort((m, n) => m - n), inn: g.boardIn.map((l) => at(l[0])).sort((m, n) => m - n) };
}
const dir = (l: { x: number; y: number }[]) => {
  const dx = l[l.length - 1].x - l[0].x;
  const dy = l[l.length - 1].y - l[0].y;
  const n = Math.hypot(dx, dy) || 1;
  return { x: dx / n, y: dy / n };
};

describe('종이 단면 구조', () => {
  it('세운 책 머리: 판 두 장이 두께 방향 양끝, 속지는 그 사이·면 안, 종이 결은 판과 나란하다', () => {
    const b: Book3 = { id: 'a', dims, roll: 0, yaw: 0, t: { x: 0, y: 0, z: 0 } };
    const g = sideFaceGeom(cam, b, 'head', px, 0, true, 1);
    expect(g.ok).toBe(true);
    expect(g.boardHi).toHaveLength(2);
    expect(g.boardIn).toHaveLength(2);
    const o = alongThickness(g);
    expect(o.hi[0]).toBeLessThan(0);
    expect(o.hi[1]).toBeGreaterThan(1);
    expect(o.inn[0]).toBeCloseTo(0, 5);
    expect(o.inn[1]).toBeCloseTo(1, 5);
    // 세운 책 머리의 두께 방향은 화면 가로
    const t = dir([g.inner![0], g.inner![1]]);
    expect(Math.abs(t.x)).toBeGreaterThan(0.95);
    const d0 = dir(g.lines[0]);
    const d1 = dir(g.boardHi[0]);
    expect(Math.abs(d0.x * d1.y - d0.y * d1.x)).toBeLessThan(0.05);
  });

  it('눕힌 책 끝면: 두께 방향이 세로가 되어 판은 위·아래, 종이 결도 같이 돈다', () => {
    const lying = [90, -90]
      .map((roll): Book3 => ({ id: 'b', dims, roll, yaw: 0, t: { x: 0, y: 0, z: 0 } }))
      .find((b) => ['head', 'tail'].some((f) => facing(cam, b, f as 'head' | 'tail') > 0.002))!;
    const f = facing(cam, lying, 'head') > 0.002 ? 'head' : 'tail';
    const g = sideFaceGeom(cam, lying, f, px, 0, true, 1);
    expect(g.ok).toBe(true);
    const o = alongThickness(g);
    expect(o.hi[0]).toBeLessThan(0);
    expect(o.hi[1]).toBeGreaterThan(1);
    // 눕힌 책 끝면의 두께 방향은 화면 세로
    const t = dir([g.inner![0], g.inner![1]]);
    expect(Math.abs(t.y)).toBeGreaterThan(0.95);
    const d0 = dir(g.lines[0]);
    const d1 = dir(g.boardHi[0]);
    expect(Math.abs(d0.x * d1.y - d0.y * d1.x)).toBeLessThan(0.05);
  });
});
