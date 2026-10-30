// 시작 시간표(EXPO_PUBLIC_PROFILE=1로 만든 측정 번들에서만): 앱 JS가 뜰 때부터 첫 책장 그림이 다 될 때까지
// 측정 시간표(perf.ts TL)를 켜 두고, JS 스레드가 25ms 넘게 막힌 구간도 함께 적어 끝나면 logcat에 '[prof] 시각 사건'으로 낸다.
// (릴리스 Hermes에는 샘플링 프로파일러가 없다.) 보통 빌드에서는 아무것도 하지 않는다.
import { TL, tl } from './perf';

export const PROFILE = process.env.EXPO_PUBLIC_PROFILE === '1';

let lagTimer: ReturnType<typeof setInterval> | null = null;
export function startProfile() {
  if (!PROFILE || TL.on) return;
  TL.on = true;
  TL.js = [];
  tl('profile-start');
  let last = Date.now();
  lagTimer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - 10;
    if (lag > 25) tl(`lag ${lag}ms since ${last}`);
    last = now;
  }, 10);
}

export function stopProfile() {
  if (!PROFILE || !TL.on) return;
  tl('profile-end');
  TL.on = false;
  if (lagTimer) clearInterval(lagTimer);
  for (const line of TL.js) console.log(`[prof] ${line}`);
  console.log('[prof] done');
}
