// 책의 판·속지 면(책등·앞표지 그림 면 말고 나머지). 모두 book-parts의 3D 조각을 지금 자세·카메라로 투영한다(face-geometry).
// - 종이 단면 면(머리·꼬리·책배): 판 테두리 안에 속지를 채우고, 들어간 종이 면의 무늬를 겹친다.
//   속지 면이 판 끝보다 들어가 있어서, 앞 면(책등 등)에 가려지는 부분은 그 앞 면이 나중에 덮는다(카메라가 보이는 만큼을 정한다).
// - 판 면(뒤표지): 판 색 + 재질 결.
// 여기는 재질(색·무늬)만 칠한다. 밝기는 책 한 권에 한 번(ui/SceneLight BookLight: 셰이더가 화소마다 광선으로 보이는 면을 찾고
// 종이 단면 면은 테두리·속지·안쪽 벽을 가른다).
import { Group, Path, Picture, Rect, Skia, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { Book3, Cam } from '@/domain/book3';
import { EDGE_R, facePanel } from '@/domain/book-parts';
import { hull } from '@/domain/box';
import type { Point } from '@/domain/camera';
import type { BoxBuf, Env } from '@/domain/light-model';
import { bookFacePath, PAGE_BASE } from '@/ui/book/BookBody';
import type { Atlas } from '@/ui/SceneLight';

import type { BookArt } from './art';
import { faceMatrix, faceVisible, HIDDEN_MATRIX, pageGeom, roundedPolygon, type Affine } from './face-geometry';
import { MaterialGrain } from './MaterialGrain';

type RO<T> = Readonly<SharedValue<T>>;

function polysPath(list: Point[][]): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  for (const pts of list) {
    if (pts.length < 3) continue;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

// 이 책이 받는 빛: 둘레(판·벽), 이 책이 있는 줄의 구운 하늘 가림(atlas, 면 key는 책 id), 갈피의 한 점 빛에 쓸 가리개(boxes·self)
export type Surround = { env?: RO<Env | null>; atlas?: RO<Atlas>; id?: string; boxes?: RO<BoxBuf>; self?: RO<number> };

// 종이 단면 면 하나의 재질: 판 테두리(책 색) + 속지(종이 색) + 판 안쪽 벽(책 색). 빛은 책 한 권에 한 번(SceneLight BookLight)
export function PageFace({ f, state, cam, px, art, tone }: { f: 'head' | 'tail' | 'fore'; state: RO<Book3>; cam: RO<Cam>; px: Affine; art: BookArt; tone: string }) {
  const g = useDerivedValue(() => pageGeom(cam.value, state.value, f, px));
  const opening = useDerivedValue(() => polysPath(g.value.ok ? [hull(g.value.opening)] : []));
  const cap = useDerivedValue(() => polysPath(g.value.ok ? [roundedPolygon(hull(g.value.rims.flat()), EDGE_R * px.s)] : []));
  const m = useDerivedValue(() => g.value.pageM);
  // 안쪽 벽(책배 둘, 머리·꼬리 셋): 보이는 것만(pageGeom)
  const walls = useDerivedValue(() => polysPath(g.value.ok ? g.value.walls.filter((w) => w.length) : []));
  const pic = f === 'fore' ? art.pageFore : art.pageEnd;
  return (
    <Group clip={cap}>
      <Path path={cap} color={tone} />
      <Path path={opening} color={PAGE_BASE} />
      <Group clip={opening}>
        <Group matrix={m}>
          <Picture picture={pic} />
        </Group>
      </Group>
      <Path path={walls} color={tone} />
    </Group>
  );
}

// 판 재질(색 + 결). 빛(모서리·제본 홈 법선까지)은 SceneLight BookLight
function Board({ w, h, s, tone }: { w: number; h: number; s: number; tone: string }) {
  const W = w * s;
  const H = h * s;
  return (
    <>
      <Rect x={0} y={0} width={W} height={H} color={tone} />
      <MaterialGrain w={W} h={H} s={s} />
    </>
  );
}

// 뒤표지 판 면
export function BackFace({ dims: d, state, cam, px, tone }: { dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const m = useDerivedValue(() => (faceVisible(cam.value, state.value, 'back') ? faceMatrix(state.value, 'back', cam.value, px) : HIDDEN_MATRIX));
  const p = facePanel(d, 'back');
  return (
    <Group matrix={m} clip={bookFacePath(p.w * px.s, p.h * px.s, px.s)}>
      <Board w={p.w} h={p.h} s={px.s} tone={tone} />
    </Group>
  );
}
