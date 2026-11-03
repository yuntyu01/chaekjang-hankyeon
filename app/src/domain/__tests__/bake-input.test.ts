// 줄 아틀라스 다시 굽기 판단: 객체만 새로 생기면 굽지 않고, 빛에 닿는 값이 바뀌면 반드시 굽는다
import type { Book3 } from '../book3';
import { sameBakeInput, type BakeInput } from '../bake-input';
import type { BoxBuf } from '../light-model';

const book = (over: Partial<Book3> = {}): Book3 => ({ id: 'a', dims: { T: 20, H: 150, W: 100 }, roll: 0, yaw: 90, t: { x: 1, y: 0, z: 2 }, ...over });
const boxes = (v = [1, 2, 3], ids = ['a']): BoxBuf => ({ list: [], ids, v });
const input = (over: Partial<BakeInput> = {}): BakeInput => ({ ps: { a: book() }, bx: boxes(), inputs: '200|false|false', ...over });

describe('줄 아틀라스 다시 굽기', () => {
  it('값이 같으면 객체가 새로 생겨도 굽지 않는다', () => {
    expect(sameBakeInput(input(), input())).toBe(true);
  });
  it('기울기 없음과 0은 같다', () => {
    expect(sameBakeInput(input({ ps: { a: book({ spin: 0, pitch: 0 }) } }), input())).toBe(true);
  });
  it('그리는 진하기(alpha)는 빛과 상관없다', () => {
    expect(sameBakeInput(input({ ps: { a: book({ alpha: 0.5 }) } }), input())).toBe(true);
  });
  it.each<[string, Partial<BakeInput>]>([
    ['위치', { ps: { a: book({ t: { x: 2, y: 0, z: 2 } }) } }],
    ['자세', { ps: { a: book({ pitch: 4 }) } }],
    ['크기', { ps: { a: book({ dims: { T: 21, H: 150, W: 100 } }) } }],
    ['책이 늘어남', { ps: { a: book(), b: book({ id: 'b' }) } }],
    ['자세가 사라짐', { ps: { a: null } }],
    ['상자 값(반사율 등)', { bx: boxes([1, 2, 4]) }],
    ['상자 순서', { bx: boxes([1, 2, 3], ['b']) }],
    // 다른 줄의 키 큰 책 때문에 이 줄 높이만 바뀐 경우: 자세·상자는 그대로다
    ['줄 높이', { inputs: '230|false|false' }],
    ['맨 윗줄 여부', { inputs: '200|true|false' }],
    ['맨 아랫줄 여부', { inputs: '200|false|true' }],
    ['처음 굽기', { ps: null, bx: null, inputs: null }],
  ])('%s이(가) 바뀌면 다시 굽는다', (_, over) => {
    expect(sameBakeInput(input(over), input())).toBe(false);
  });
});
