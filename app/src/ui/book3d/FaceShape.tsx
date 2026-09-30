// 상자 옆면·윗면 하나(표지 판 또는 종이 단면). 모양·밝기는 SharedValue(UI 스레드에서 매 프레임)라
// 정지·기울이기·자세 바꾸기·드래그가 같은 코드로 그려진다. 면 사이는 선이 아니라 명암으로 이어진다.
import { BlurMask, Group, LinearGradient, Path, Skia, vec, type SkImage, type SkPath, type SkPoint } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { Point } from '@/domain/shelf-scene';
import { edgeFactor, GrainFill, litTone, mix, PAGE_BASE, PAGE_LINE, PAGE_LIT, PAGE_RIM, scaleColor, withAlpha } from '@/ui/book/BookBody';
import { RENDER } from '@/ui/perf';
import { SHOW } from '@/ui/shelf/shadow-debug';

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

export function linesPath(list: Point[][]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (const pts of list) {
    if (!pts.length) continue;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  }
  return p.detach();
}

// hinge: 표지 판 면(앞·뒤표지)이라 책등과 맞닿은 변(A→B) 가까이에 제본 홈이 있다
type Props = { geom: RO<FaceGeom>; pages: boolean; tone: string; k: RO<number>; s: number; grain: SkImage | null; opacity?: RO<number>; hinge?: boolean };

export function FaceShape(p: Props) {
  return RENDER.texture ? <TexturedFace {...p} /> : <FlatFace {...p} />;
}

// 측정용 기본 도형: 면 윤곽을 밝기만 반영한 단색으로
function FlatFace({ geom, tone, k, opacity }: Props) {
  const path = useDerivedValue(() => polyPath(geom.value.all, true));
  const fill = useDerivedValue(() => scaleColor(tone, Math.min(1.06, k.value)));
  return <Path path={path} color={fill} opacity={opacity} />;
}

// 종이 단면(속지 묶음)과 종이 결: 종이 단면이 있는 면에만(없는 면에는 파생 값을 만들지 않는다)
// 구조는 책 좌표에서 정해 투영한 것(face-geometry pageStructure): 판 두 장 사이·책등 띠 뒤의 속지 묶음, 배쪽에서 판이 튀어나온
// 틈(종이 끝이 판 그늘에 들어가 조금 어둡다), 판·책등과 맞닿는 쪽에만 좁은 회베이지 그늘(열린 배쪽에는 없다).
// 속지는 밝은 종이색 그대로(표지색 섞기·판 명암 겹치기 없이), 면 밝기는 돌려서 어두워질 때만 따른다.
function Pages({ geom, k, a, ab, s, debug, tone }: { geom: RO<FaceGeom>; k: RO<number>; a: RO<SkPoint>; ab: RO<SkPoint>; s: number; debug: boolean; tone: string }) {
  const boardHi = useDerivedValue(() => linesPath(geom.value.boardHi));
  const boardIn = useDerivedValue(() => linesPath(geom.value.boardIn));
  // 판 윗모서리 밝음은 빛을 받는 면(위·왼쪽)에서만, 옆면(빛 등진 쪽)에서는 아주 약하게
  const hiAlpha = useDerivedValue(() => (geom.value.lit ? 0.5 : 0.18));
  const inner = useDerivedValue(() => polyPath(geom.value.inner ?? [], true));
  const lines = useDerivedValue(() => linesPath(geom.value.lines));
  const gaps = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    for (const g of geom.value.gaps) p.addPath(polyPath(g, true));
    return p.detach();
  });
  const shades = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    for (const g of geom.value.shades) p.addPath(polyPath(g, true));
    return p.detach();
  });
  const paper = useDerivedValue(() => {
    const kk = Math.min(1, k.value / 0.98);
    return [scaleColor(PAGE_LIT, kk), scaleColor(PAGE_BASE, kk), scaleColor(PAGE_BASE, kk * 0.985)];
  });
  const gapColor = useDerivedValue(() => mix(scaleColor(PAGE_BASE, Math.min(1, k.value / 0.98) * 0.86), PAGE_RIM, 0.25));
  if (debug) {
    return (
      <>
        <Path path={inner} color="#F2D23C" />
        <Path path={gaps} color="#9B4FD0" />
        <Path path={shades} color="#E07A2E" />
        <Path path={lines} style="stroke" strokeWidth={1} color="#6A5A00" />
        <Path path={boardHi} style="stroke" strokeWidth={1.5} color="#FFFFFF" />
        <Path path={boardIn} style="stroke" strokeWidth={1.5} color="#000000" />
      </>
    );
  }
  return (
    <>
      <Path path={inner}>
        <LinearGradient start={a} end={ab} colors={paper} positions={[0, 0.35, 1]} />
      </Path>
      <Path path={gaps} color={gapColor} />
      <Path path={lines} style="stroke" strokeWidth={0.5} color={PAGE_LINE} opacity={0.14} />
      <Group clip={inner}>
        <Path path={shades} color={withAlpha(PAGE_RIM, 0.34)}>
          <BlurMask blur={0.9 * s} style="normal" />
        </Path>
      </Group>
      {/* 표지 판 두 장: 윗모서리의 가는 밝음(책색을 밝힌 색) + 판 안쪽 면이 종이와 만나는 좁은 그늘(검은 선이 아니라 책색을 낮춘 색) */}
      <Path path={boardHi} style="stroke" strokeWidth={0.55 * s} strokeCap="round" color={litTone(tone)} opacity={hiAlpha}>
        <BlurMask blur={0.25 * s} style="normal" />
      </Path>
      <Path path={boardIn} style="stroke" strokeWidth={0.45 * s} color={withAlpha(scaleColor(tone, 0.55), 0.45)}>
        <BlurMask blur={0.2 * s} style="normal" />
      </Path>
    </>
  );
}

// 제본 홈: 책등 쪽 변에서 표지 깊이의 약 5% 안쪽을 따라가는 좁고 옅은 그늘과 그 바로 뒤의 가는 밝음(검은 선이 아니다)
function Hinge({ geom, tone, s }: { geom: RO<FaceGeom>; tone: string; s: number }) {
  const groove = useDerivedValue(() => {
    const g = geom.value;
    const at = (t: number) => ({ x: (g.Ab.x - g.A.x) * t, y: (g.Ab.y - g.A.y) * t });
    const d = at(0.05);
    const e = at(0.075);
    return { d: linesPath([[{ x: g.A.x + d.x, y: g.A.y + d.y }, { x: g.B.x + d.x, y: g.B.y + d.y }]]), e: linesPath([[{ x: g.A.x + e.x, y: g.A.y + e.y }, { x: g.B.x + e.x, y: g.B.y + e.y }]]) };
  });
  const dp = useDerivedValue(() => groove.value.d);
  const ep = useDerivedValue(() => groove.value.e);
  return (
    <>
      <Path path={dp} style="stroke" strokeWidth={1.1 * s} color={withAlpha(scaleColor(tone, 0.55), 0.16)}>
        <BlurMask blur={0.5 * s} style="normal" />
      </Path>
      <Path path={ep} style="stroke" strokeWidth={0.8 * s} color={withAlpha(litTone(tone), 0.14)} />
    </>
  );
}

function TexturedFace({ geom, pages, tone, k, s, grain, opacity, hinge }: Props) {
  const path = useDerivedValue(() => polyPath(geom.value.all, true));
  const hi = useDerivedValue(() => polyPath(geom.value.lit ? geom.value.hi : [], false));
  const runs = useDerivedValue(() => linesPath(geom.value.runs));
  const a = useDerivedValue(() => vec(geom.value.A.x, geom.value.A.y));
  const b = useDerivedValue(() => vec(geom.value.B.x, geom.value.B.y));
  const ab = useDerivedValue(() => vec(geom.value.Ab.x, geom.value.Ab.y));
  const mid = useDerivedValue(() => vec(geom.value.mid.x, geom.value.mid.y));
  // 종이 단면이 있는 면(머리·꼬리·책배): 종이는 밝혀도 크림색을 넘지 않게(k ≤ 1), 둘레 표지 판은 종이 쪽으로 조금 섞어
  // 짙은 책에서 윗면 테두리가 튀지 않게 한다. 표지·책등 면(pages=false)은 그대로.
  // 종이 단면 면의 바탕 = 표지 판·책등 띠(표지색 그대로: 판과 종이가 색으로 구분되게)
  const fill = useDerivedValue(() => scaleColor(tone, Math.min(1.06, k.value)));
  const debug = SHOW.faceDebug;
  // 면이 꺾이는 모서리 쪽 빛·빛 받는 모서리 광택: 흰색이 아니라 책 색을 밝힌 색(표지색과 이어지게)
  const lit = litTone(tone);
  // 빛을 등진 면(오른쪽 옆면 등)은 맞닿은 모서리를 밝히지 않는다(앞면과의 경계에 밝은 선이 생겨 테두리처럼 보였다)
  const soft = useDerivedValue(() => (geom.value.lit ? [withAlpha(lit, 0.24), withAlpha(lit, 0)] : [withAlpha(lit, 0), withAlpha(lit, 0)]));
  const hiColors = pages ? [withAlpha(lit, 0.14), withAlpha(lit, 0.04)] : [withAlpha(lit, 0.4), withAlpha(lit, 0.12)];
  const edge = scaleColor(tone, edgeFactor(tone));
  return (
    <Group opacity={opacity}>
      {/* 표지 판 색(종이면이면 판이 테두리로 조금 보인다). 선 대신 색 차이로만 구분 */}
      <Path path={path} color={fill} />
      {RENDER.grain ? <GrainFill path={path} s={s} image={grain} /> : null}
      {/* 앞면에서 둥글게 꺾여 들어가는 명암: 맞닿은 모서리 쪽이 앞면 밝기에 가깝고 뒤로 갈수록 어두워진다(선 없이) */}
      <Path path={path}>
        <LinearGradient start={a} end={mid} colors={soft} />
      </Path>
      <Path path={path}>
        <LinearGradient start={a} end={ab} colors={[withAlpha(scaleColor(tone, 0.6), 0), withAlpha(scaleColor(tone, 0.6), 0.14)]} />
      </Path>
      {hinge && !pages ? (
        <Group clip={path}>
          <Hinge geom={geom} tone={tone} s={s} />
        </Group>
      ) : null}
      {/* 속지는 판 명암 위에 따로(판의 둥근 명암·그늘이 종이에 겹쳐 회색 뚜껑처럼 되지 않게) */}
      {pages ? (
        <Group clip={path}>
          <Pages geom={geom} k={k} a={a} ab={ab} s={s} debug={debug} tone={tone} />
        </Group>
      ) : null}
      {debug ? <Path path={path} style="stroke" strokeWidth={1} color={pages ? '#2E8B3C' : hinge ? '#D0342C' : '#2C5BD0'} /> : null}
      {/* 빛 받는 윗면 모서리만 은은하게 */}
      <Path path={hi} style="stroke" strokeWidth={2.4 * s} strokeCap="round">
        <LinearGradient start={a} end={b} colors={hiColors} />
        <BlurMask blur={1.4 * s} style="normal" />
      </Path>
      {/* 바깥 실루엣은 아주 연하게(진한 테두리로 읽히지 않게) */}
      <Path path={runs} style="stroke" strokeWidth={0.7 * s} strokeJoin="round" strokeCap="round" color={edge} opacity={pages ? 0.1 : 0.16} />
    </Group>
  );
}
