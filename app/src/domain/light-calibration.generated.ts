// 생성 파일(light-model runCalibration, __tests__/light-calibration.test.ts에서 UPDATE_CALIBRATION=1로 다시 만든다). 고치지 말 것
import type { Calibration } from './light-model';

export const CALIBRATION_INPUTS = "{\"light\":{\"dir\":{\"x\":-0.1,\"y\":0.06,\"z\":-0.993},\"radius\":0.13962634015954636,\"ambient\":0.85,\"skyUp\":0.22,\"diffuse\":0.15},\"material\":{\"f0\":0.04,\"roughness\":0.6},\"surfaces\":{\"plank\":\"#F2DCC1\",\"wall\":\"#FCF8F1\",\"paper\":\"#FBF2E2\"},\"TONE\":{\"toe\":0.18,\"k\":0.15,\"shoulder\":0.85},\"REF_SPACE\":200,\"REF_BOOK_H\":150,\"SHELF_DEPTH\":122,\"SHELF_FRONT\":53.375,\"SHELF_THICK\":16.39375,\"SHELF_X0\":-1.5,\"SHELF_X1\":367.5,\"GRID_N\":8,\"ENV_NY\":8,\"ENV_COLS\":6,\"GRID_PASSES\":6,\"TOUCH\":0.05,\"eye\":{\"x\":183,\"y\":343.90006113818424,\"z\":-4918}}";
export const CALIBRATION: Calibration | null = {
  eref: { wall: [0.740295220413, 0.665968425436, 0.622918294943], plank: [0.971320818281, 0.971320818281, 0.971320818281], book: [0.928041136466, 0.908481337808, 0.896230658936] },
  albedo: { wall: [0.974300202389, 0.86445121352, 0.775770267537], plank: [0.598420329952, 0.433109094137, 0.303718280132], paper: [0.747354677456, 0.575574731527, 0.465828782167] },
};
