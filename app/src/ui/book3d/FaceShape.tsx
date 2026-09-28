// 상자 옆면·윗면 하나(표지 판 또는 종이 단면). 모양·밝기는 SharedValue(UI 스레드에서 매 프레임)라
// 정지·기울이기·자세 바꾸기·드래그가 같은 코드로 그려진다. 면 사이는 선이 아니라 명암으로 이어진다.
import { BlurMask, Group, LinearGradient, Path, Skia, vec, type SkImage, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { DESIGN_WIDTH } from '@/domain/geometry';
import type { Point } from '@/domain/shelf-scene';
import { edgeFactor, Grain, mix, PAGE, PAGE_LINE, scaleColor } from '@/ui/book/BookBody';

import type { FaceGeom } from './face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

export function polyPath(pts: Point[], close: boolean): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  if (pts.length) {
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    if (close) p.close();
  }
  return p.detach();
}

function linesPath(list: Point[][]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (const pts of list) {
    if (!pts.length) continue;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  }
  return p.detach();
}

export function FaceShape({ geom, pages, tone, k, s, grain, opacity }: { geom: RO<FaceGeom>; pages: boolean; tone: string; k: RO<number>; s: number; grain: SkImage | null; opacity?: RO<number> }) {
  const path = useDerivedValue(() => polyPath(geom.value.all, true));
  const inner = useDerivedValue(() => polyPath(geom.value.inner ?? [], true));
  const lines = useDerivedValue(() => linesPath(geom.value.lines));
  const hi = useDerivedValue(() => polyPath(geom.value.lit ? geom.value.hi : [], false));
  const runs = useDerivedValue(() => linesPath(geom.value.runs));
  const a = useDerivedValue(() => vec(geom.value.A.x, geom.value.A.y));
  const b = useDerivedValue(() => vec(geom.value.B.x, geom.value.B.y));
  const ab = useDerivedValue(() => vec(geom.value.Ab.x, geom.value.Ab.y));
  const mid = useDerivedValue(() => vec(geom.value.mid.x, geom.value.mid.y));
  const fill = useDerivedValue(() => scaleColor(tone, Math.min(1.06, k.value)));
  const paper = useDerivedValue(() => [mix(scaleColor(PAGE, k.value), tone, 0.08), mix(scaleColor(PAGE, k.value * 0.93), tone, 0.12)]);
  const soft = useDerivedValue(() => (geom.value.lit ? ['rgba(255,250,240,0.2)', 'rgba(255,250,240,0)'] : ['rgba(255,250,240,0.1)', 'rgba(255,250,240,0)']));
  const edge = scaleColor(tone, edgeFactor(tone));
  return (
    <Group opacity={opacity}>
      {/* 표지 판 색(종이면이면 판이 테두리로 조금 보인다). 선 대신 색 차이로만 구분 */}
      <Path path={path} color={fill} />
      {pages ? (
        <>
          <Path path={inner}>
            <LinearGradient start={a} end={ab} colors={paper} />
          </Path>
          <Path path={lines} style="stroke" strokeWidth={0.5} color={PAGE_LINE} opacity={0.5} />
        </>
      ) : null}
      <Group clip={path}>
        <Grain w={DESIGN_WIDTH * s} h={400 * s} s={s} image={grain} />
      </Group>
      {/* 둥근 모서리로 이어지는 명암: 앞면 끝과 같은 밝기에서 시작해 면 색으로 풀린다 */}
      <Path path={path}>
        <LinearGradient start={a} end={mid} colors={soft} />
      </Path>
      {/* 뒤로 갈수록 조금 어둡다(빛에서 멀어짐) */}
      <Path path={path}>
        <LinearGradient start={a} end={ab} colors={['rgba(50,35,25,0)', 'rgba(50,35,25,0.08)']} />
      </Path>
      {/* 빛을 받는 둥근 모서리의 부드러운 광택 */}
      <Path path={hi} style="stroke" strokeWidth={1.6 * s} strokeCap="round">
        <LinearGradient start={a} end={b} colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.2)']} />
        <BlurMask blur={0.9 * s} style="normal" />
      </Path>
      {/* 바깥 실루엣 변만 연한 같은 색 선 */}
      <Path path={runs} style="stroke" strokeWidth={0.8 * s} strokeJoin="round" strokeCap="round" color={edge} opacity={0.7} />
    </Group>
  );
}
