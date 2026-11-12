// 측정 번들 전용: 빛 셰이더마다 GPU 컴파일 시간을 잰다(2026-11-12 S23 새로 설치 후 시작 화면에서 1분 넘게 멈춤: 첫 굽기의 셰이더 컴파일이 UI 스레드를 막았다).
// 실제 굽기처럼 UI 스레드에서 작은 화면 밖 표면에 한 번 그리고 화소를 읽어 끝을 기다린다.
// 같은 소스는 드라이버가 저장해 둔 결과를 다시 쓰므로(실기기) 쓰지 않는 uniform 이름에 실행마다 다른 값을 넣어 매번 새로 컴파일하게 한다.
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { bakeSource, bookSource, gridSource, litSource, tabSource } from './scene-light-sksl';

export type BenchSource = { name: string; src: string };
export type BenchResult = { name: string; len: number; makeMs: number; drawMs: number; error?: string };

export function builtinShaders(): BenchSource[] {
  return [
    { name: 'grid', src: gridSource() },
    { name: 'bake', src: bakeSource() },
    { name: 'lit', src: litSource() },
    { name: 'book', src: bookSource() },
    { name: 'tab', src: tabSource() },
  ];
}

function benchOne(name: string, source: string, nonce: string): BenchResult {
  'worklet';
  const src = `uniform float zBench${nonce};\n${source}`;
  const t0 = performance.now();
  const effect = Skia.RuntimeEffect.Make(src);
  const t1 = performance.now();
  if (!effect) return { name, len: source.length, makeMs: t1 - t0, drawMs: -1, error: 'make' };
  const surf = Skia.Surface.MakeOffscreen(4, 4);
  if (!surf) return { name, len: source.length, makeMs: t1 - t0, drawMs: -1, error: 'surface' };
  const uniforms: number[] = [];
  for (let i = 0; i < effect.getUniformFloatCount(); i++) uniforms.push(0);
  const kids = (source.match(/uniform\s+shader\s+\w+/g) ?? []).map(() => Skia.Shader.MakeColor(Skia.Color('black')));
  const paint = Skia.Paint();
  paint.setShader(effect.makeShaderWithChildren(uniforms, kids));
  surf.getCanvas().drawRect(Skia.XYWHRect(0, 0, 4, 4), paint);
  surf.flush();
  const img = surf.makeImageSnapshot();
  img.readPixels(0, 0, { width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 });
  const t2 = performance.now();
  img.dispose();
  surf.dispose();
  return { name, len: source.length, makeMs: t1 - t0, drawMs: t2 - t1 };
}

// 하나씩 차례로(한 번에 하나만 UI 스레드를 막게), 끝날 때마다 알린다
export function runShaderBench(list: BenchSource[], onResult: (r: BenchResult) => void, onDone: () => void) {
  const nonce = String(Date.now() % 1e9);
  const next = (i: number) => {
    if (i >= list.length) return onDone();
    const { name, src } = list[i];
    scheduleOnUI(() => {
      'worklet';
      let r: BenchResult;
      try {
        r = benchOne(name, src, `${nonce}x${i}`);
      } catch (e) {
        r = { name, len: src.length, makeMs: -1, drawMs: -1, error: String(e) };
      }
      scheduleOnRN(report, r, i);
    });
  };
  const report = (r: BenchResult, i: number) => {
    onResult(r);
    setTimeout(() => next(i + 1), 300);
  };
  next(0);
}
