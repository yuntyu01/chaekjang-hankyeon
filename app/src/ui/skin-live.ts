// 실행 중 스킨 바꾸기(2026-11-10 사용자 '실시간으로, 바꿔도 앱 재실행 안 해도 되는 거'): 스토어에서 고르면 그 자리에서 책장 색·재질과 빛 맞추기가 바뀐다.
// - JS 쪽 값(스킨·면 색·맞추기)은 domain/light-model switchSkin이 바꾼다(스킨 조합마다 미리 계산한 맞추기 표).
// - UI 스레드에는 맞추기 값 사본을 새로 심는다(installLight: 워클릿은 처음 붙잡은 값을 UI에 복사해 두어 JS에서 바꾼 값을 못 본다).
//   빛 격자 그림 보관(SceneLight cachedGrid)은 스킨을 모르는 열쇠라 비운다.
// - 화면은 스킨 열쇠(useSkinKey)가 바뀌면 다시 만든다: 스토어 미리보기는 고를 때마다, 홈은 다시 보일 때(app/(tabs)/index).
// 틀 있음 ↔ 없음은 카메라·판 모양·빛 배치가 달라 실행 중에 못 바꾼다(적용하면 앱을 다시 켠다).
import { useSyncExternalStore } from 'react';
import { scheduleOnUI } from 'react-native-worklets';

import { lightSnapshot, switchSkin, type LightSet } from '@/domain/light-model';
import { writeBootSetting } from '@/scene-config/boot-store';
import { liveSkinOK, savedSkin, SKIN_CHOICE, SKIN_KEY, skinToString, type SkinChoice } from '@/scene-config/skin';

import { dropHomeSnapshot } from './home-snapshot';

function installLight(set: LightSet) {
  'worklet';
  const g = globalThis as { __lightSet?: LightSet; __grids?: { img: { dispose(): void } | null }[] };
  g.__lightSet = set;
  for (const e of g.__grids ?? []) e.img?.dispose();
  g.__grids = [];
}

const listeners = new Set<() => void>();
let key = skinToString(SKIN_CHOICE);

// 스킨을 바꾼다(같으면 그대로). 실행 중에 바꿀 수 없으면 false
function setLive(choice: SkinChoice): boolean {
  if (skinToString(choice) === key) return true;
  if (!switchSkin(choice)) return false;
  scheduleOnUI(installLight, lightSnapshot());
  key = skinToString(SKIN_CHOICE);
  listeners.forEach((l) => l());
  return true;
}

export const skinLive = {
  // 실행 중에 바꿀 수 있는 스킨인가(틀 여부가 지금과 같다)
  canLive: liveSkinOK,
  // 미리보기: 저장하지 않고 바꾼다(스토어를 나갈 때 적용하지 않았으면 revert)
  preview: setLive,
  // 적용: 시작 설정에 저장하고 바꾼다. 'restart'면 앱을 다시 켜야 한다(틀 여부가 다르다)
  apply(choice: SkinChoice): 'live' | 'restart' {
    writeBootSetting(SKIN_KEY, skinToString(choice));
    dropHomeSnapshot();
    return setLive(choice) ? 'live' : 'restart';
  },
  // 저장된 스킨으로 되돌린다(미리보기만 하고 나갈 때)
  revert() {
    setLive(savedSkin());
  },
};

// 지금 스킨 열쇠('선반,틀,벽지'): 바뀌면 그림을 다시 만든다
export function useSkinKey() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => key,
  );
}
