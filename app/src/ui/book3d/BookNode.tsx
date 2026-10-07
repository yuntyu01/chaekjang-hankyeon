// 책 한 권 = Skia 그룹 하나. 지금 자세(Book3, UI 스레드 SharedValue)에서 몸체 조각(domain/book-parts)을 매 프레임 투영해 그린다.
// - 책등·앞표지: 기록해 둔 그림(Picture)을 면 변환 행렬에 태운다. 글자도 그 면에 붙어 몸체와 함께 돈다(글자를 따로 돌리지 않는다).
//   책등 제목은 조판 두 가지(세운 책등 = 세로, 눕힌 책등 = 가로 한 줄)를 따로 기록해 두고 자세(눕힘 정도)로 고른다.
// - 머리·꼬리·책배: 판 끝보다 안쪽으로 들어간 속지 면 + 판·책등 테두리(BookFaces). 뒤표지: 판 면.
// - 그리는 순서: 속지 면(안쪽) 먼저, 바깥 면(판·책등·앞표지) 나중: 들어간 속지 가운데 바깥 면 뒤로 숨는 부분은 바깥 면이 덮는다.
// - 윤곽: 투영 껍질을 판 모서리 반지름(EDGE_R)으로 둥글린 모양. 레이어에 그린 뒤 그 모양으로 잘라 가장자리를 매끈하게 한다(dstIn).
// - 밝기: 빛 모델 하나(domain/light-model, ui/SceneLight). 책끼리 앞뒤는 매 프레임 가림 순서로(zIndex).
import { Group, Path, Picture, Rect, Skia, type SkRect } from '@shopify/react-native-skia';
import type React from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { corners, depthKey, faceCorners, facing, rot, toWorld, type Book3, type Cam } from '@/domain/book3';
import { EDGE_R } from '@/domain/book-parts';
import { bookViewCam } from '@/domain/book-view';
import { project } from '@/domain/camera';
import { lightWithLoss, linearOf, NO_BOXES, othersOf, skyLossAt, toEye } from '@/domain/light-model';
import { RIBBON_Z } from '@/domain/ribbon-design';
import { titleOpacity } from '@/domain/title-layout';
import type { Book } from '@/domain/types';
import { bookFacePath } from '@/ui/book/BookBody';
import { LIGHT_ON, RENDER } from '@/ui/perf';
import { BookLight, UniformLight } from '@/ui/SceneLight';
import { SHOW } from '@/ui/shelf/shadow-debug';

import { useBookArt, tabsOf, toneOf, type BookArt, type Shared } from './art';
import { BackFace, PageFace, type Surround } from './BookFaces';
import { faceMatrix, HIDDEN_MATRIX, silhouette, type Affine } from './face-geometry';
import { layerBounds } from '@/ui/layer-bounds';

type RO<T> = Readonly<SharedValue<T>>;

// 책등 제목: 세로 조판(세운 책등)과 가로 조판(눕힌 책등)을 눕힘 정도로 고른다. 보이지 않는 쪽은 화면 밖으로 보낸다
// (불투명도 0만으로는 기록된 그림이 얇은 선으로 남는다). 바뀌는 구간(36~54°)에서 하나가 사라진 뒤 다른 하나가 나타난다.
function SpineTitles({ art, state }: { art: BookArt; state: RO<Book3> }) {
  const op = useDerivedValue(() => titleOpacity(state.value.roll));
  const vOp = useDerivedValue(() => op.value.v);
  const hOp = useDerivedValue(() => op.value.h);
  const vT = useDerivedValue(() => [{ translateX: op.value.v <= 0 ? -1e5 : 0 }]);
  const hT = useDerivedValue(() => [{ translateX: op.value.h <= 0 ? -1e5 : 0 }]);
  return (
    <>
      <Group opacity={vOp} transform={vT}>
        <Picture picture={art.titleV} />
      </Group>
      <Group opacity={hOp} transform={hT}>
        <Picture picture={art.titleH} />
      </Group>
    </>
  );
}

function ArtFace({ f, art, state, cam, px, d }: { f: 'spine' | 'cover'; art: BookArt; state: RO<Book3>; cam: RO<Cam>; px: Affine; d: Book3['dims'] }) {
  const s = px.s;
  // 보이지 않는 면은 그리지 않는다(행렬을 화면 밖 한 점으로)
  const m = useDerivedValue(() => (facing(cam.value, state.value, f) <= 0.002 ? HIDDEN_MATRIX : faceMatrix(state.value, f, cam.value, px)));
  const w = (f === 'spine' ? d.T : d.W) * s;
  const h = d.H * s;
  return (
    <Group matrix={m} clip={bookFacePath(w, h, s)}>
      <Picture picture={f === 'spine' ? art.spine : art.cover} />
      {SHOW.faceDebug ? <Rect x={0} y={0} width={w} height={h} color={f === 'spine' ? 'rgba(44,91,208,0.45)' : 'rgba(208,52,44,0.45)'} /> : null}
      {f === 'spine' ? <SpineTitles art={art} state={state} /> : null}
    </Group>
  );
}

// 측정용 기본 도형: 책등·표지 면을 그림·빛 없이 단색 사각형으로
function PlainFace({ f, state, cam, px, tone }: { f: 'spine' | 'cover'; state: RO<Book3>; cam: RO<Cam>; px: Affine; tone: string }) {
  const path = useDerivedValue(() => {
    const b = state.value;
    const c = cam.value;
    const p = Skia.PathBuilder.Make();
    if (facing(c, b, f) <= 0.002) return p.detach();
    const cs = corners(b);
    faceCorners(f).forEach((i, n) => {
      const q = project(c, cs[i]);
      if (n === 0) p.moveTo(q.x * px.s + px.tx, q.y * px.s + px.ty);
      else p.lineTo(q.x * px.s + px.tx, q.y * px.s + px.ty);
    });
    p.close();
    return p.detach();
  });
  return <Path path={path} color={tone} />;
}

// 갈피(종이 탭): 머리에서 위로 나온 종이. 보는 쪽을 향한 면(책등과 같은 법선)이라 탭 가운데 한 점의 빛으로 탭 모양 안만 다시 칠한다.
// 하늘 가림(둘레·이웃 책)은 책 자세·둘레·상자가 바뀔 때만 계산하고, 시점에 따라 바뀌는 반사광만 매 프레임. 반사율은 앞장 탭 종이 색
function Ribbons({ art, book, state, cam, px, sur }: { art: BookArt; book: Book; state: RO<Book3>; cam: RO<Cam>; px: Affine; sur: Surround }) {
  const albedo = linearOf(tabsOf(book)[0]?.color ?? toneOf(book));
  const at = useDerivedValue(() => {
    const b = state.value;
    const d = b.dims;
    const root = toWorld(b, { x: d.T * 0.55, y: d.H, z: d.W * RIBBON_Z });
    const n = rot(b.roll, b.yaw, { x: 0, y: 0, z: -1 }, b.spin ?? 0, b.pitch ?? 0);
    const up = rot(b.roll, b.yaw, { x: 0, y: 1, z: 0 }, b.spin ?? 0, b.pitch ?? 0);
    const half = art.ribbonsOut / 2;
    const c = { x: root.x + up.x * half, y: root.y + up.y * half, z: root.z + up.z * half };
    const env = sur.env ? sur.env.value : null;
    return { root, c, n, env, loss: skyLossAt(c, n, env, othersOf(sur.boxes ? sur.boxes.value : NO_BOXES, sur.self ? sur.self.value : -1)) };
  });
  const g = useDerivedValue(() => {
    const { root, c, n, env, loss } = at.value;
    const b = state.value;
    const p = project(cam.value, root);
    return { tf: [{ translateX: p.x * px.s + px.tx }, { translateY: p.y * px.s + px.ty }, { rotate: (b.roll * Math.PI) / 180 }], lt: lightWithLoss(c, n, toEye(cam.value, c), env, loss) };
  });
  const tf = useDerivedValue(() => g.value.tf);
  const lt = useDerivedValue(() => g.value.lt);
  return (
    <Group transform={tf}>
      <Picture picture={art.ribbons!} />
      <UniformLight path={art.ribbonsShape!} light={lt} albedo={albedo} />
    </Group>
  );
}

export { depthKey } from '@/domain/book3';

// shared: 캔버스 밖에서 useBookShared()로 읽어 넘긴다
// under: 면 위·갈피 아래에 그릴 것(이 책이 받는 그림자)
// order: 줄 전체의 그리는 순서(가림 순서, ShelfMotion의 drawOrder). 없으면(서랍·단독) 깊이 키.
// clip: 이 책을 그릴 영역(없으면 전부). 줄 캔버스는 다른 줄로 옮겨 가는 동안 빈 영역을 준다(그동안은 이동 캔버스가 그린다)
// env: 이 책이 받는 빛의 둘레(판·벽, 없으면 열린 방: 서랍·단독), atlas: 이 책이 있는 줄의 구운 하늘 가림(없으면 둘레만 그 자리에서),
// boxes·self: 갈피 한 점의 하늘 가림에 쓸 줄의 책 상자(그중 self 번째가 이 책)
export function BookNode({ book, dims, state, cam: sceneCam, px, shared, under, order, clip, env, atlas, boxes, self }: { book: Book; dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; shared: Shared; under?: React.ReactNode; order?: RO<number>; clip?: RO<SkRect> } & Omit<Surround, 'id'>) {
  const cam = useDerivedValue(() => bookViewCam(sceneCam.value, state.value));
  const art = useBookArt(book, px.s, dims, shared);
  const z = useDerivedValue(() => (order ? order.value : depthKey(state.value)));
  // 둥근 모서리: 투영 윤곽을 판 모서리 반지름으로 깎은 모양(face-geometry silhouette)
  const outline = useDerivedValue(() => {
    const pts = silhouette(cam.value, state.value, px, EDGE_R);
    const p = Skia.PathBuilder.Make();
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.close();
    return p.detach();
  });
  const bounds = useDerivedValue(() => layerBounds(outline.value));
  if (!art) return null;
  // 몸체 색 하나: 판 두 장·책등·판 끝·책등 띠가 모두 같은 책 색이다
  const tone = toneOf(book);
  const albedo = linearOf(tone);
  const sur: Surround = { env, atlas, id: book.id, boxes, self };
  return (
    <Group zIndex={z} clip={clip}>
      {/* 경로 자르기(clip)는 안티에일리어싱 없이 계단이 된다. 책 둘레 사각형 크기 레이어에 그린 뒤 안티에일리어싱된 윤곽 경로로 남길 곳만 남긴다(dstIn) */}
      <Group clip={bounds}>
        <Group layer>
          <Path path={outline} color={tone} />
          {/* 안쪽: 머리·꼬리·책배(판 끝보다 들어간 속지 + 테두리) */}
          <PageFace f="head" state={state} cam={cam} px={px} art={art} tone={tone} />
          <PageFace f="tail" state={state} cam={cam} px={px} art={art} tone={tone} />
          <PageFace f="fore" state={state} cam={cam} px={px} art={art} tone={tone} />
          {/* 바깥: 뒤표지 판, 책등·앞표지 그림 */}
          <BackFace dims={dims} state={state} cam={cam} px={px} tone={tone} />
          {RENDER.art ? (
            <>
              <ArtFace f="spine" art={art} state={state} cam={cam} px={px} d={dims} />
              <ArtFace f="cover" art={art} state={state} cam={cam} px={px} d={dims} />
            </>
          ) : (
            <>
              <PlainFace f="spine" state={state} cam={cam} px={px} tone={tone} />
              <PlainFace f="cover" state={state} cam={cam} px={px} tone={tone} />
            </>
          )}
          {/* 빛: 책 윤곽 안을 화소마다 광선으로(보이는 면·속지 구멍을 셰이더가 찾는다). 받는 그림자(under)는 그 위에 */}
          {SHOW.body && LIGHT_ON.face ? <BookLight dims={dims} state={state} cam={cam} px={px} outline={outline} albedo={albedo} env={env} atlas={atlas} id={book.id} /> : null}
          {under}
          <Path path={outline} color="black" blendMode="dstIn" />
        </Group>
      </Group>
      {/* 갈피: 머리 위로 나오므로 둥근 윤곽 밖에 */}
      {art.ribbons && RENDER.art ? <Ribbons art={art} book={book} state={state} cam={cam} px={px} sur={sur} /> : null}
    </Group>
  );
}
