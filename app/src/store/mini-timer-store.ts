// 공통 미니 타이머의 자리 정보(저장하지 않는다). 화면 아래에 고정된 버튼(저장 등)이 있는 화면은 그 높이를 알려 주고(bottom),
// 미니 타이머를 둘 수 없는 상태(책장 꾸미기 조작부가 떠 있을 때 등)는 숨긴다(hidden).
import { useSyncExternalStore } from 'react';

export const MINI_TIMER_SIZE = 56;
// 타이머가 있는 화면에서 마지막 내용이 가려지지 않게 더하는 아래 여백(원 + 위아래 틈)
export const MINI_TIMER_SPACE = MINI_TIMER_SIZE + 20;

type State = { bottom: number | null; hidden: boolean };
let state: State = { bottom: null, hidden: false };
// 지금 bottom을 정한 화면(가려진 화면이 늦게 지워 앞 화면 값을 없애지 않게)
let owner: object | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const miniTimerStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  // 고정 버튼 영역의 높이(화면 아래 끝에서 버튼 위 끝까지, dp). 보이는 화면이 정하고(버튼이 없으면 null), 가려지면 자기가 정한 값만 지운다
  setBottom(bottom: number | null, by: object | null = null) {
    owner = by;
    if (state.bottom !== bottom) set({ bottom });
  },
  release(by: object) {
    if (owner !== by) return;
    owner = null;
    if (state.bottom !== null) set({ bottom: null });
  },
  setHidden(hidden: boolean) {
    if (state.hidden !== hidden) set({ hidden });
  },
};

export function useMiniTimerPlace() {
  return useSyncExternalStore(miniTimerStore.subscribe, miniTimerStore.get);
}
