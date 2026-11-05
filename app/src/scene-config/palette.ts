import { readPerfSetting } from './boot-store';

const HEX = /^#[\da-f]{6}$/i;
// 측정 번들 전용: 딥링크 ?wallbg=FFFFFF 를 저장하면 다음 실행부터 책장 벽지를 그 색으로 찍어 비교한다(?wallbg=off로 지운다, useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_WALL_KEY = 'perf-wall';
const perfWall = readPerfSetting(PERF_WALL_KEY);
// 기본 벽지 색 하나(2026-11-04 사용자 '벽지는 따뜻한 벽'). 시안 벽 237, 232, 231의 비율을 흰색에 준 값
export const sceneColors = { wall: perfWall && HEX.test(perfWall) ? perfWall : '#FEFAF9' };

// 일반 화면 바탕(2026-11-05 사용자 '당근 배경색으로, 배경 흰색만': 당근 설정 화면 사진에서 잰 값 #FFFFFF). 책장 벽지와 따로 둔다.
// 측정 번들 전용: 딥링크 ?uibg=FEFBF6 을 저장하면 다음 실행부터 그 색으로 찍어 비교한다(?uibg=off로 지운다, useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_UI_BG_KEY = 'perf-ui-bg';
const perfBg = readPerfSetting(PERF_UI_BG_KEY);
export const uiBackground = perfBg && HEX.test(perfBg) ? perfBg : '#FFFFFF';
