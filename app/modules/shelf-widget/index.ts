// 홈 화면 위젯 '나의 책장'·'나의 책장(벽 없이)'·'나의 책장(투명)'(Android 전용) JS 쪽. 네이티브 모듈이 없는 곳(iOS·Expo Go)에서는 아무것도 하지 않는다.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// 투명 위젯용 모양(그림 기준 px): 책 외곽 [x0,y0,x1,y1,…], 갈피 띠 [x,y,w,h], 판 외곽 [x0,y0,x1,y1,…]
export type CutPx = { books: number[][]; ribbons: number[][]; boards: number[][] };

type Native = {
  // path: 책장 그림(JPEG, 위젯 칸 폭 그대로). bottoms: 그림 위에서부터 선반 한 칸·두 칸이 끝나는 높이(px). year: 접근성 이름의 해
  update(path: string, bottoms: number[], year: number, books: number[][], ribbons: number[][], boards: number[][]): Promise<number>;
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ShelfWidget') : null;

export const shelfWidgetAvailable = !!native;

// 새 그림을 알리고 놓인 위젯을 모두 다시 그린다(놓인 위젯 수를 돌려준다)
// 같은 그림에서 오려 낸 투명 그림(cut-<같은 때>.png)도 네이티브가 만든다
export function updateShelfWidget(path: string, bottoms: number[], year: number, cut: CutPx) {
  if (!native) return Promise.resolve(0);
  return native.update(path, bottoms.map((b) => Math.round(b)), year, cut.books, cut.ribbons, cut.boards);
}
