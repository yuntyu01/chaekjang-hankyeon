// 측정 번들 전용 화면: 빛 셰이더 컴파일 시간(ui/shader-bench). 홈을 거치지 않고 바로 열어(chaekjang:///shaderbench) 홈 굽기와 겹치지 않게 잰다.
// ?src=주소 면 그 주소의 JSON [{ name, src }]을, 없으면 앱에 든 셰이더를 잰다. 결과는 logcat '[shaderbench]'. 배포본은 빈 화면이다
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { PERF_ENABLED } from '@/ui/perf';
import { type } from '@/ui/theme';
import { builtinShaders, runShaderBench, type BenchResult, type BenchSource } from '@/ui/shader-bench';

export default function ShaderBench() {
  const { src, run } = useLocalSearchParams<{ src?: string; run?: string }>();
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!PERF_ENABLED) return;
    let cancelled = false;
    const log = (line: string) => {
      console.log(`[shaderbench] ${line}`);
      if (!cancelled) setLines((l) => [...l, line]);
    };
    const load = async (): Promise<BenchSource[]> => {
      if (!src) return builtinShaders();
      const res = await fetch(src);
      return (await res.json()) as BenchSource[];
    };
    // 시작 직후의 다른 일(글꼴·저장소)이 끝나도록 잠깐 기다린다
    const id = setTimeout(() => {
      load().then((list) => {
        log(`start ${list.length} run=${run ?? ''}`);
        let total = 0;
        runShaderBench(list, (r: BenchResult) => {
          total += r.drawMs;
          log(`${r.name} len=${r.len} make=${r.makeMs.toFixed(0)}ms draw=${r.drawMs.toFixed(0)}ms${r.error ? ` error=${r.error}` : ''}`);
        }, () => log(`done total=${total.toFixed(0)}ms`));
      }, (e: unknown) => log(`load failed ${String(e)}`));
    }, 2000);
    return () => { cancelled = true; clearTimeout(id); };
  }, [src, run]);
  if (!PERF_ENABLED) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 80 }}>
      {lines.map((l, i) => <Text key={i} style={type.caption}>{l}</Text>)}
    </ScrollView>
  );
}
