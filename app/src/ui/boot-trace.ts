// 첫 실행 단계 측정(측정 번들에서만 기록): logcat에 [boot] 단계 이름을 남긴다. 시각은 logcat 타임스탬프로 잰다.
// 조작 가능 시점: 홈이 뜬 뒤 JS 스레드가 100ms 타이머를 연속 5번 50ms 안에 처리하면 'js-responsive'.
import { PERF_ENABLED, tl } from './perf';
import { PROFILE, stopProfile } from './profile';

const seen = new Set<string>();
export function bootMark(name: string, detail?: string | number) {
  if (!PERF_ENABLED) return;
  if (seen.has(name)) return;
  seen.add(name);
  console.log(`[boot] ${name}${detail !== undefined ? ` ${detail}` : ''}`);
  // 시작 프로파일은 첫 책장 그림이 다 되면 끝낸다
  if (PROFILE) tl(`mark ${name}`);
  if (PROFILE && name.startsWith('art-idle')) setTimeout(stopProfile, 500);
}

let watching = false;
export function watchResponsive() {
  if (!PERF_ENABLED || watching) return;
  watching = true;
  let last = Date.now();
  let ok = 0;
  let worst = 0;
  const t = setInterval(() => {
    const now = Date.now();
    const lag = now - last - 100;
    last = now;
    worst = Math.max(worst, lag);
    ok = lag < 50 ? ok + 1 : 0;
    if (ok >= 5) {
      clearInterval(t);
      bootMark('js-responsive', `worstLag=${worst}ms`);
    }
  }, 100);
}
