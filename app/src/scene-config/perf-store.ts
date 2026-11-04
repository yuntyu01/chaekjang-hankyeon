// 측정 번들 전용: 빌드 없이 빛·스킨을 바꿔 비교할 때 저장한 값을 시작할 때 읽는다(useHomePerf가 딥링크로 저장). 배포본은 읽지 않는다.
// scene-config에서 앱 밖 모듈을 부르는 유일한 곳(dependency-boundaries 시험이 이 파일만 허용한다)
export function readPerfSetting(key: string): string | null {
  if (process.env.EXPO_PUBLIC_PERF !== '1') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-sqlite/kv-store').default as { getItemSync(k: string): string | null }).getItemSync(key);
  } catch {
    // 측정 도구라 못 읽으면 기본값으로 둔다
    return null;
  }
}
