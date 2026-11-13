// 첫 화면의 빛 셰이더를 그리는 요소마다 차례로 처음 그린다(2026-11-12 S23 새로 설치 첫 실행에서 시작 화면 1분+ 멈춤·응답 없음).
// GPU 프로그램은 처음 그릴 때 UI 스레드에서 컴파일되고, 같은 셰이더라도 섞기(곱하기·닷지·한 번에·더하기)와 Skia가 도형을 그리는 방식
// (사각형·볼록 다각형·작은 도형…)마다 따로 컴파일된다. 첫 화면은 벽·틀·판·책·갈피를 한 프레임에 모두 처음 그려 그 컴파일이 한 번에 몰렸다
// (그동안 화면이 멈추고 손을 대면 '응답 없음'). 겹 종류로 나눠도 한 단계 안에 도형 방식이 여러 벌이라 10초가 넘게 몰렸다.
// 그래서 빛 겹(Path)마다 처음 그려지는 차례 번호(slot)를 받고, 시작 화면 뒤에서 UI 스레드 프레임 콜백이 두 프레임에 몇 개씩 연다
// (직전이 느렸으면 하나, 빨랐으면 두 배씩 넷까지: 이미 컴파일된 방식이면 바로 지나간다). 열리기 전 겹은 빈 경로를 그려
// Skia가 그리기를 건너뛴다(컴파일도 없다). 시작 화면이 걷힌 뒤(finishLightStages)에는 새 겹을 기다리지 않고 바로 그린다.
// 그린 결과는 같다(시작 화면이 다 열릴 때까지 덮는다)
import { makeMutable } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

// 측정 번들: 느린 프레임과 단계 시각을 logcat에
const STAGE_LOG = process.env.EXPO_PUBLIC_PERF === '1';

// UI 스레드에서 읽는 값: 열린 차례 번호(이 번호까지 그린다), 받은 번호 수, 모두 열림(시작 화면이 걷힌 뒤), 책 그림 준비(시작 화면 조건과 같다)
export const lightOpenSV = makeMutable(0);
const slotsSV = makeMutable(0);
export const lightAllSV = makeMutable(false);
const artReadySV = makeMutable(false);
// 책장 화면이 안 보이는 동안(다른 탭·다른 화면)은 열기를 멈춘다: 보이지 않는 캔버스는 그리지 않아, 그사이 번호만 다 열리면 돌아왔을 때 컴파일이 한 프레임에 몰린다
const pausedSV = makeMutable(false);
export function setLightPaused(paused: boolean) {
  pausedSV.value = paused;
}

let slots = 0;
let all = false;
// 빛 겹 하나의 차례 번호(그 겹을 처음 그릴 때 한 번). 시작 화면이 걷힌 뒤면 0(바로 그린다)
export function takeLightSlot(): number {
  if (all) return 0;
  slots += 1;
  slotsSV.value = slots;
  scheduleOnUI(kickLightStages);
  return slots;
}

const listeners = new Set<() => void>();
let drained = false;
function markDrained() {
  if (drained) return;
  drained = true;
  listeners.forEach((l) => l());
}
// 시작 화면을 걷어도 되는지(받은 번호를 모두 열었고 몇 프레임 동안 새 번호가 없다)
export const lightStage = {
  done: () => drained,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// 책 그림이 다 됐다(책이 붙기 전에 열기를 끝내지 않게)
export function setLightArtReady() {
  artReadySV.value = true;
  scheduleOnUI(kickLightStages);
}

// 시작 화면이 걷혔다: 이제부터 새 겹은 기다리지 않는다
export function finishLightStages() {
  all = true;
  lightAllSV.value = true;
}

// UI 스레드: 여는 고리를 돌린다(돌고 있으면 그대로). 번호 받기·책 그림 준비·딥 링크 대체가 부른다
export function kickLightStages() {
  'worklet';
  const g = globalThis as { __lightLoop?: boolean };
  if (g.__lightLoop || lightAllSV.value) return;
  g.__lightLoop = true;
  let frame = 0;
  let step = 1;
  let quiet = 0;
  let last = Date.now();
  // 굽기를 기다리는 겹이 끝내 풀리지 않아도(구울 값이 오지 않는 면) 시작 화면이 걷히게 이만큼만 기다린다. 굽기 일감이 남아 있는 동안은 계속 기다린다
  let gateUntil = Date.now() + 20000;
  const tick = () => {
    frame++;
    if (lightAllSV.value) {
      g.__lightLoop = false;
      return;
    }
    if (pausedSV.value) {
      last = Date.now();
      quiet = 0;
      requestAnimationFrame(tick);
      return;
    }
    // 두 프레임에 한 번: 연 겹을 그린(컴파일한) 프레임이 끝난 뒤 그 시간을 본다
    if (frame % 2 === 1) {
      const now = Date.now();
      const dt = now - last;
      last = now;
      step = dt > 80 ? 1 : Math.min(step * 2, 4);
      if (STAGE_LOG && dt > 200) console.log(`[light-stage] ${dt}ms up to slot ${lightOpenSV.value}/${slotsSV.value}`);
      if (lightOpenSV.value < slotsSV.value) {
        lightOpenSV.value = Math.min(slotsSV.value, lightOpenSV.value + step);
        quiet = 0;
      } else if (((globalThis as { __bakeJobs?: unknown[] }).__bakeJobs?.length ?? 0) > 0) {
        // 굽기 일감이 남아 있다(SceneLight 나눠 굽기): 시작 화면을 걷지 않는다
        quiet = 0;
        gateUntil = Math.max(gateUntil, now + 5000);
      } else if (now < gateUntil && Object.keys((globalThis as { __lightGated?: Record<number, boolean> }).__lightGated ?? {}).length > 0) {
        // 굽기를 기다리는 겹이 있다(SceneLight gatePath): 시작 화면을 걷지 않는다
        quiet = 0;
      } else if (artReadySV.value && ++quiet >= 10) {
        // 다 열었고 스무 프레임 동안 새 겹이 없다: 시작 화면을 걷어도 된다(고리는 멈추고, 새 번호가 오면 다시 돈다)
        g.__lightLoop = false;
        if (STAGE_LOG) console.log(`[light-stage] drained ${slotsSV.value} slots`);
        scheduleOnRN(markDrained);
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// JS: 굽기가 없는 화면으로 시작했을 때(딥 링크) 그냥 돌린다
export function startLightStages() {
  scheduleOnUI(kickLightStages);
}
