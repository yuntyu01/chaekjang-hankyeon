import { readPerfSetting } from './boot-store';

const HEX = /^#[\da-f]{6}$/i;
// 측정 번들 전용: 딥링크 ?wallbg=FFFFFF 를 저장하면 다음 실행부터 책장 벽지를 그 색으로 찍어 비교한다(?wallbg=off로 지운다, useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_WALL_KEY = 'perf-wall';
const perfWall = readPerfSetting(PERF_WALL_KEY);
// 기본 벽지 색 하나(2026-11-05 사용자 '#FFFFFF가 낫다': 원래·이전·당근·아이보리 후보를 책장에서 비교해 고름). 일반 화면 바탕과 같은 색이라 탭을 옮겨도 바탕이 안 바뀐다
export const sceneColors = { wall: perfWall && HEX.test(perfWall) ? perfWall : '#FFFFFF' };

// 일반 화면 바탕(2026-11-05 사용자 '당근 배경색으로, 배경 흰색만': 당근 설정 화면 사진에서 잰 값 #FFFFFF). 측정 번들에서 책장 벽지와 따로 비교할 수 있게 값을 나눠 둔다.
// 측정 번들 전용: 딥링크 ?uibg=FEFBF6 을 저장하면 다음 실행부터 그 색으로 찍어 비교한다(?uibg=off로 지운다, useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_UI_BG_KEY = 'perf-ui-bg';
const perfBg = readPerfSetting(PERF_UI_BG_KEY);
export const uiBackground = perfBg && HEX.test(perfBg) ? perfBg : '#FFFFFF';
