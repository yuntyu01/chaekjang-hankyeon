// 시작할 때 동기로 읽는 설정(모듈이 불러올 때 값이 정해지는 스킨·빛에 쓴다). scene-config에서 앱 밖 모듈을 부르는 유일한 곳(dependency-boundaries 시험이 이 파일만 허용한다)
type Kv = { getItemSync(k: string): string | null; setItemSync(k: string, v: string): void };
function kv(): Kv | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-sqlite/kv-store').default as Kv;
  } catch {
    return null;
  }
}
export function readBootSetting(key: string): string | null {
  try {
    return kv()?.getItemSync(key) ?? null;
  } catch {
    return null; // 못 읽으면 기본값으로 시작한다
  }
}
export function writeBootSetting(key: string, value: string) {
  try {
    kv()?.setItemSync(key, value);
  } catch {
    // 저장하지 못해도 다음 시작 때 다시 계산한다
  }
}
// 측정 번들 전용: 빌드 없이 빛·스킨을 바꿔 비교할 때 저장한 값(useHomePerf가 딥링크로 저장). 배포본은 읽지 않는다
export function readPerfSetting(key: string): string | null {
  if (process.env.EXPO_PUBLIC_PERF !== '1') return null;
  return readBootSetting(key);
}
