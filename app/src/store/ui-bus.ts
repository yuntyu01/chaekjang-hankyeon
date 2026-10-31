// 화면 사이 한 번짜리 요청(예: 책 찾기에서 고른 책으로 책장을 옮겨 강조). 저장하지 않는다.
let focusId: string | null = null;
const listeners = new Set<() => void>();

let pickedId: string | null = null;
export const uiBus = {
  focusBook(id: string) {
    focusId = id;
    listeners.forEach((l) => l());
  },
  takeFocus() {
    const id = focusId;
    focusId = null;
    return id;
  },
  // 책 고르기에서 '새 책 등록'으로 나갔다가 돌아올 때: 등록한 책 id를 맡겨 두면 작성 중이던 화면이 돌아와 가져간다
  offerPickedBook(id: string) {
    pickedId = id;
    listeners.forEach((l) => l());
  },
  takePickedBook() {
    const id = pickedId;
    pickedId = null;
    return id;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
