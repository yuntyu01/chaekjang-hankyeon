// 책장 갈피(종이 탭) 회전 비교(2026-11-05 사용자 '갈피 회전도 사진 찍어봐'). 측정 번들에서 딥링크 ?tabturn=follow|paper로 저장하고(off로 지운다, useHomePerf) 다음 실행부터 쓴다. 배포본은 항상 정면
// none: 항상 보는 쪽을 향한다 / follow: 책을 돌린 만큼 같이 돌되 TAB_MAX_SPIN까지 / paper: 실제 종이처럼 책장(페이지)과 같은 면
import { readPerfSetting } from './boot-store';

export const PERF_TAB_TURN_KEY = 'perf-tab-turn';
export const TAB_MAX_SPIN = 40;
const saved = readPerfSetting(PERF_TAB_TURN_KEY);
export const TAB_TURN: 'none' | 'follow' | 'paper' = saved === 'follow' || saved === 'paper' ? saved : 'none';
