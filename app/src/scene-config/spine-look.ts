import { readBootSetting, readPerfSetting, writeBootSetting } from './boot-store';

// 실제 책(YES24 표지가 있는 책)의 측면(책등) 모양. 사용자가 스토어에서 고른다(2026-11-12 사용자 '측면 선택지 있게': 1 색 뽑아 단색, 2 실물 측면, 3 표지 이어 쌓기).
//  color  표지에서 책등과 맞닿는 띠의 색 한 가지 + 제목(기본, 2026-11-01 사용자가 고름)
//  photo  YES24 책등 사진 그대로(제목·장식이 사진 안에 있다. 책등 사진이 없는 책은 color)
//  stripe 앞표지에서 책등과 맞닿는 가장자리 한 줄을 옆으로 늘려 표지 색이 책등까지 줄무늬로 이어지게 + 제목
// 실행 중에 바꿀 수 있다(책 그림 열쇠에 들어가 바꾸면 다시 그린다). 측정 번들은 딥링크 ?spine= 로도 바꾼다(useHomePerf)
export type SpineLook = 'color' | 'photo' | 'stripe';
export const SPINE_LOOKS: SpineLook[] = ['color', 'photo', 'stripe'];
export const SPINE_KEY = 'spine-look';
// (예전 측정 번들 값: 사용자 설정이 없으면 이것을 읽는다)
const PERF_SPINE_KEY = 'perf-spine';

const parse = (v: string | null): SpineLook | null => (v === 'color' || v === 'photo' || v === 'stripe' ? v : null);
let look: SpineLook = parse(readBootSetting(SPINE_KEY)) ?? parse(readPerfSetting(PERF_SPINE_KEY)) ?? 'color';
const listeners = new Set<() => void>();

export const spineLookStore = {
  get: () => look,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  // 바꾸고 저장한다(같으면 그대로)
  set(next: SpineLook) {
    if (next === look) return;
    look = next;
    writeBootSetting(SPINE_KEY, next);
    listeners.forEach((l) => l());
  },
};
