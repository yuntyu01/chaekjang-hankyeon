// 재질 반사율·카메라 맞추기(light-model runCalibration)는 무거워서 스킨 조합(선반 × 틀 × 벽지)마다 미리 계산해 둔다(light-calibration.generated.ts).
// 스토어에서 색을 고르면 앱을 다시 켜지 않고 그 조합의 값으로 바꾼다(light-model switchSkin, 2026-11-10 사용자 '실시간으로').
// 평소에는 조합마다 맞추기 입력(빛·재질 색·기하·격자)의 해시가 그 값을 만든 때와 같은지만 본다. 다르면 UPDATE_CALIBRATION=1로 이 테스트를 돌려 다시 만든다
import { CALIBRATIONS } from '../light-calibration.generated';
import type { Calibration } from '../light-model';
import { ALL_SKINS, frameOnOf, skinToString, type SkinChoice } from '@/scene-config/skin';

declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileSync } = require('fs') as { writeFileSync: (path: string, body: string) => void };
const UPDATE = process.env.UPDATE_CALIBRATION === '1';
const num = (v: number) => Number(v.toPrecision(12));
const c3 = (c: number[]) => `[${c.map(num).join(', ')}]`;

type LM = typeof import('../light-model');
// 틀 여부는 시작할 때 정해진다(카메라·판 모양·빛 배치): 틀 있음·없음마다 그 스킨으로 시작한 모듈을 따로 불러온다.
// table: 미리 계산한 표 대신 쓸 표(다시 만들 때는 빈 표: 시작할 때 처음부터 맞춘다)
function startWith(skin: SkinChoice, table?: typeof CALIBRATIONS): LM {
  let lm!: LM;
  jest.isolateModules(() => {
    jest.doMock('@/scene-config/boot-store', () => ({
      readBootSetting: (k: string) => (k === 'shelf-skin' ? skinToString(skin) : null),
      readPerfSetting: () => null,
      writeBootSetting: () => undefined,
    }));
    if (table) jest.doMock('../light-calibration.generated', () => ({ CALIBRATIONS: table }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lm = require('../light-model') as LM;
  });
  return lm;
}
const GROUPS = [true, false].map((frameOn) => ALL_SKINS.filter((s) => frameOnOf(s) === frameOn));

function entry(c: Calibration, hash: number) {
  return `{ hash: ${hash}, c: {
    gain: ${num(c.gain)},
    eref: { wall: ${c3(c.eref.wall)}, plank: ${c3(c.eref.plank)}, frame: ${c3(c.eref.frame)}, book: ${c3(c.eref.book)}, paper: ${c3(c.eref.paper)} },
    albedo: { wall: ${c3(c.albedo.wall)}, plank: ${c3(c.albedo.plank)}, frame: ${c3(c.albedo.frame)}, paper: ${c3(c.albedo.paper)} },
    sideE: { l: ${c3(c.sideE.l)}, r: ${c3(c.sideE.r)} },
    sref: { wall: ${c3(c.sref.wall)}, plank: ${c3(c.sref.plank)}, frame: ${c3(c.sref.frame)}, paper: ${c3(c.sref.paper)}, book: { ${Object.entries(c.sref.book).map(([k, v]) => `${k}: ${c3(v)}`).join(', ')} } },
  } }`;
}

if (UPDATE) {
  it('맞추기 다시 만들기(스킨 조합마다)', () => {
    const rows: string[] = [];
    for (const skins of GROUPS) {
      const lm = startWith(skins[0], {});
      for (const s of skins) {
        expect(lm.setSkinColors(s)).toBe(true);
        const t0 = Date.now();
        const c = lm.runCalibration();
        rows.push(`  '${skinToString(s)}': ${entry(c, lm.inputsHash(lm.calibrationInputs()))},`);
        console.log(skinToString(s), Date.now() - t0, 'ms');
      }
    }
    const body = `// 생성 파일(light-model runCalibration, __tests__/light-calibration.test.ts에서 UPDATE_CALIBRATION=1로 다시 만든다). 고치지 말 것
// 스킨 조합(선반,틀,벽지)마다 맞추기 입력의 해시와 맞추기 값
import type { Calibration } from './light-model';

export const CALIBRATIONS: Record<string, { hash: number; c: Calibration }> = {
${rows.join('\n')}
};
`;
    writeFileSync(`${__dirname}/../light-calibration.generated.ts`, body);
  }, 6 * 3600000);
} else {
  it('스킨 조합마다 미리 계산한 맞추기가 지금 입력으로 만든 것이다(다르면 UPDATE_CALIBRATION=1로 다시 만든다)', () => {
    const stale: string[] = [];
    for (const skins of GROUPS) {
      const lm = startWith(skins[0]);
      for (const s of skins) {
        expect(lm.setSkinColors(s)).toBe(true);
        const key = skinToString(s);
        if (CALIBRATIONS[key]?.hash !== lm.inputsHash(lm.calibrationInputs())) stale.push(key);
      }
    }
    expect(stale).toEqual([]);
  }, 600000);

  it('실행 중 스킨 바꾸기: 틀 여부가 같으면 그 조합의 맞추기로, 다르면 바꾸지 않는다', () => {
    const lm = startWith({ plank: 'pine', frame: 'white', wall: 'white' });
    const gain0 = lm.lightSet().gain;
    expect(lm.switchSkin({ plank: 'walnut', frame: 'pine', wall: 'sage' })).toBe(true);
    const c = CALIBRATIONS['walnut,pine,sage'].c;
    expect(lm.lightSet().gain).toBe(c.gain);
    expect(lm.lightSet().albedo.plank).toEqual(c.albedo.plank);
    expect(lm.DESIGN.plank).toEqual(lm.linearOf('#8F6E55'));
    // 틀 없는 스킨은 시작할 때만(앱을 다시 켠다)
    expect(lm.switchSkin({ plank: 'oak', frame: 'none', wall: 'white' })).toBe(false);
    expect(lm.lightSet().gain).toBe(c.gain);
    expect(lm.switchSkin({ plank: 'pine', frame: 'white', wall: 'white' })).toBe(true);
    expect(lm.lightSet().gain).toBe(gain0);
  }, 600000);
}
