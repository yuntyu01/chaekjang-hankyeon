import { readPerfSetting } from './boot-store';

// 실제 책(YES24 표지가 있는 책)의 책등 모양 세 안(2026-11-10 사용자 '책장 측면 선택지 3개'):
//  color  표지에서 책등과 맞닿는 띠의 색 한 가지 + 제목(지금 모양, 2026-11-01 사용자가 고름)
//  photo  YES24 책등 사진 그대로(제목·장식이 사진 안에 있다. 책등 사진이 없는 책은 color)
//  stripe 앞표지에서 책등과 맞닿는 가장자리 한 줄을 옆으로 늘려 표지 색이 책등까지 줄무늬로 이어지게 + 제목
// 측정 번들 전용: 딥링크 ?spine=photo 를 저장하면 다음 실행부터 그 모양으로 찍어 비교한다(?spine=off로 지운다, useHomePerf). 배포본은 이 값을 읽지 않는다
export type SpineLook = 'color' | 'photo' | 'stripe';
export const PERF_SPINE_KEY = 'perf-spine';
const perfSpine = readPerfSetting(PERF_SPINE_KEY);
export const spineLook: SpineLook = perfSpine === 'photo' || perfSpine === 'stripe' ? perfSpine : 'color';
