// 재질 반사율·카메라 맞추기(light-model runCalibration)는 무거워서 미리 계산해 둔다(light-calibration.generated.ts).
// 평소에는 맞추기 입력(빛·재질 색·기하·격자)이 그 값을 만든 때와 같은지만 본다. 다르면 UPDATE_CALIBRATION=1로 이 테스트를 돌려 다시 만든다
import { CALIBRATION, CALIBRATION_INPUTS } from '../light-calibration.generated';
import { calibrationInputs, runCalibration, type Calibration } from '../light-model';

declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileSync } = require('fs') as { writeFileSync: (path: string, body: string) => void };
const UPDATE = process.env.UPDATE_CALIBRATION === '1';
const num = (v: number) => Number(v.toPrecision(12));
const c3 = (c: number[]) => `[${c.map(num).join(', ')}]`;

if (UPDATE) {
  it('맞추기 다시 만들기', () => {
    const c: Calibration = runCalibration((s) => console.log(s));
    const body = `// 생성 파일(light-model runCalibration, __tests__/light-calibration.test.ts에서 UPDATE_CALIBRATION=1로 다시 만든다). 고치지 말 것
import type { Calibration } from './light-model';

export const CALIBRATION_INPUTS = ${JSON.stringify(calibrationInputs())};
export const CALIBRATION: Calibration | null = {
  eref: { wall: ${c3(c.eref.wall)}, plank: ${c3(c.eref.plank)}, book: ${c3(c.eref.book)}, paper: ${c3(c.eref.paper)} },
  albedo: { wall: ${c3(c.albedo.wall)}, plank: ${c3(c.albedo.plank)}, paper: ${c3(c.albedo.paper)} },
};
`;
    writeFileSync(`${__dirname}/../light-calibration.generated.ts`, body);
  }, 3600000);
} else {
  it('미리 계산한 맞추기가 지금 입력으로 만든 것이다(다르면 UPDATE_CALIBRATION=1로 다시 만든다)', () => {
    expect(CALIBRATION).not.toBeNull();
    expect(CALIBRATION_INPUTS).toBe(calibrationInputs());
  });
}
