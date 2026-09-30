// 화면 사이 한 번짜리 요청(예: 책 찾기에서 고른 책으로 책장을 옮겨 강조). 저장하지 않는다.
let focusId: string | null = null;
const listeners = new Set<() => void>();

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
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
