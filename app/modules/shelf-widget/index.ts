// 홈 화면 위젯 '나의 책장'·'나의 책장(벽 없이)'·'나의 책장(투명)'(Android 전용) JS 쪽. 네이티브 모듈이 없는 곳(iOS·Expo Go)에서는 아무것도 하지 않는다.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// 투명 위젯용 모양(그림 기준 px): 책 외곽 [x0,y0,x1,y1,…], 갈피 띠 [x,y,w,h], 판 외곽 [x0,y0,x1,y1,…]
export type CutPx = { books: number[][]; ribbons: number[][]; boards: number[][] };
// 한 장으로 뜬 그림 안의 칸: index(0부터 위 칸), key(그림이 같은지), y0·y1(그림 안 px 범위), top(책장 콘텐츠 기준 px: 칸을 이어 붙일 자리)
export type BandRow = { index: number; key: string; y0: number; y1: number; top: number };

type Native = {
  // path: 칸 몇 개를 한 장으로 뜬 그림(JPEG, 책장 폭 그대로, 없으면 null: 열쇠만 알린다). keys: 지금 책장 칸마다 열쇠(위 칸부터, 최대 4).
  // 네이티브가 칸마다 잘라 두고(투명 위젯용으로 오려 낸 것도), 열쇠가 다른 칸은 버린 뒤 위젯을 다시 그린다
  // band: 칸마다 [칸 번호, 그림 안 위 px, 아래 px, 콘텐츠 기준 위 끝 px], bandKeys: 그 칸들의 열쇠(Expo 함수 인자는 8개까지)
  updateRows(path: string | null, band: number[][], bandKeys: string[], keys: string[], books: number[][], ribbons: number[][], boards: number[][]): Promise<number>;
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ShelfWidget') : null;

export const shelfWidgetAvailable = !!native;

// 놓인 위젯 수를 돌려준다
export function updateShelfWidget(path: string | null, band: BandRow[], keys: string[], cut: CutPx) {
  if (!native) return Promise.resolve(0);
  const r = (v: number) => Math.round(v);
  return native.updateRows(path, band.map((b) => [b.index, r(b.y0), r(b.y1), r(b.top)]), band.map((b) => b.key), keys, cut.books, cut.ribbons, cut.boards);
}
