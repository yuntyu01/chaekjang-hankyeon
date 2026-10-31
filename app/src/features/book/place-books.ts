// 책을 책장에 놓기(전체 책·책 상세·책 추가가 같이 쓴다). 책 정보는 그대로 두고 배치만 바꾼다(같은 책 ID).
// - 이미 책장에 있는 책은 건너뛴다(같은 책이 두 번 꽂히지 않는다).
// - 기존 크기·배치 규칙(placeAtFirstFit)으로 빈 자리를 찾고, 책을 줄이거나 다른 책을 옮겨 끼워 넣지 않는다.
// - 자리가 모자라면 묻는다: '새 선반 추가'(누를 때마다 한 칸만, 기존 선반과 같은 재질·크기·간격) 또는 '보관만 하기'.
import { Alert } from 'react-native';

import { placementOf } from '@/domain/layout-engine';
import { ko } from '@/i18n/ko';
import { placementStore } from '@/store/placement-store';

export function placeBooks(ids: readonly string[]): { placed: string[]; left: string[] } {
  const placed: string[] = [];
  const left: string[] = [];
  for (const id of ids) {
    const { layout } = placementStore.get();
    if (placementOf(layout, id)) continue;
    const r = layout.drawer.includes(id) ? placementStore.fromDrawer(id) : placementStore.addToShelf(id);
    (r === 'shelf' ? placed : left).push(id);
  }
  return { placed, left };
}

// 보관만 하기: 아직 배치 어디에도 없는 새 책은 책장에 없는 책 목록에 넣는다(이미 있으면 그대로)
export function keepOffShelf(ids: readonly string[]) {
  for (const id of ids) placementStore.addToDrawer(id);
}

// 놓아 보고, 남은 책이 있으면 새 선반 추가 / 보관만 하기를 고르게 한다. done(놓은 수, 보관만 한 수)
export function placeWithChoice(ids: readonly string[], done?: (placed: number, kept: number) => void) {
  let total = 0;
  const step = (rest: readonly string[], afterNewShelf = false) => {
    const r = placeBooks(rest);
    total += r.placed.length;
    if (!r.left.length) {
      done?.(total, 0);
      return;
    }
    let answered = false; // 버튼과 바깥 누르기(onDismiss)가 겹쳐도 한 번만
    const keep = () => {
      if (answered) return;
      answered = true;
      keepOffShelf(r.left);
      done?.(total, r.left.length);
    };
    // 새 빈 선반에도 한 권도 못 놓았으면(선반보다 큰 책) 더 묻지 않고 보관한다(선반이 끝없이 늘지 않게)
    if (afterNewShelf && !r.placed.length) {
      keep();
      return;
    }
    Alert.alert(
      ko.allBooks.noRoomTitle,
      ko.allBooks.noRoomBody(r.left.length),
      [
        { text: ko.allBooks.keep, style: 'cancel', onPress: keep },
        {
          text: ko.allBooks.addShelf,
          onPress: () => {
            if (answered) return;
            if (!placementStore.addShelf()) return keep();
            answered = true;
            step(r.left, true);
          },
        },
      ],
      { cancelable: true, onDismiss: keep },
    );
  };
  step(ids);
}
