// 시작 화면은 둘로 나뉜다(2026-11-13 사용자 '진열 중은 책장 페이지에서만, 다른 건 쓸 수 있게'):
// ① 앱 전체 시작 화면(RootLayout): 서재를 읽는 동안만. ② 책장 탭 덮개(ShelfCover): 책 그림·빛(컴파일·굽기)이 다 될 때까지 책장 화면만 덮는다.
// ②는 책장 탭 화면 안에 있어 떠 있는 하단바가 그 위에 보이고, 다른 탭으로 가면 그 탭이 그대로 보인다. 같은 그림(LoadingScreen)이라 ①이 걷힐 때 이어져 보인다.
// 굽기는 프레임을 나눠 하므로(SceneLight 나눠 굽기) 그동안에도 다른 탭이 움직인다
import { createContext, useContext } from 'react';

import { LoadingScreen } from './LoadingScreen';

// visible: 아직 덮는 중 · ready: 책장이 다 됐다(걷어도 된다) · onShown: 덮개 그림이 그려졌다(①을 걷어도 된다) · onFinished: 다 걷혔다
export type StartCover = { visible: boolean; ready: boolean; onShown: () => void; onFinished: () => void };
export const StartCoverContext = createContext<StartCover | null>(null);

export function ShelfCover() {
  const c = useContext(StartCoverContext);
  if (!c || !c.visible) return null;
  return <LoadingScreen ready={c.ready} step={c.ready ? 3 : 2} onFinished={c.onFinished} onShown={c.onShown} />;
}
