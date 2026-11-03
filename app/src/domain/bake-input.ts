// 줄 아틀라스(하늘 가림)를 다시 구워야 하는지: 값으로 비교한다. 갈피 수처럼 빛과 상관없는 값이 바뀌어 객체만 새로 생겨도 줄 전체를 다시 굽지 않는다.
// 자세·상자 말고 굽기가 읽는 값(줄 높이, 맨 윗줄·맨 아랫줄 여부 등)은 inputs 글자에 담아 함께 비교한다: 한 줄의 키 큰 책 때문에 다른 줄의 높이만 바뀌어도 다시 굽는다.
import type { Book3 } from './book3';
import type { BoxBuf } from './light-model';

export type BakePoses = Record<string, Book3 | null>;
export type BakeInput = { ps: BakePoses | null; bx: BoxBuf | null; inputs: string | null };

function sameBook3(a: Book3 | null | undefined, b: Book3 | null | undefined) {
  'worklet';
  if (a === b) return true;
  if (!a || !b) return false;
  return a.t.x === b.t.x && a.t.y === b.t.y && a.t.z === b.t.z && a.roll === b.roll && a.yaw === b.yaw && (a.spin ?? 0) === (b.spin ?? 0) && (a.pitch ?? 0) === (b.pitch ?? 0)
    && a.dims.T === b.dims.T && a.dims.H === b.dims.H && a.dims.W === b.dims.W;
}
export function samePoses(a: BakePoses | null, b: BakePoses | null) {
  'worklet';
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!sameBook3(a[k], b[k])) return false;
  return true;
}
export function sameBoxes(a: BoxBuf | null, b: BoxBuf | null) {
  'worklet';
  if (a === b) return true;
  if (!a || !b || a.ids.length !== b.ids.length) return false;
  for (let i = 0; i < a.ids.length; i++) if (a.ids[i] !== b.ids[i]) return false;
  for (let i = 0; i < a.v.length; i++) if (a.v[i] !== b.v[i]) return false;
  return true;
}
export function sameBakeInput(a: BakeInput, b: BakeInput) {
  'worklet';
  return a.inputs === b.inputs && samePoses(a.ps, b.ps) && sameBoxes(a.bx, b.bx);
}
