// 저장 형식과 배치 명령이 공유하는 책장 제약. 기하 계산에 의존하지 않는다.
export const MAX_STACK = 3;
export const HOME_SHELF_COUNT = 3;
// 선반 칸 수: 기본 3칸 + 잠긴 2칸(2026-11-04 사용자 '밑에 2칸 잠금, 누르면 사는 느낌'). 연 칸은 보통 선반이 되어 배치에 저장되므로 구매 기록을 따로 두지 않는다
export const SHELF_SLOTS = 5;
export function lockedShelfCount(shelves: number) {
  return Math.max(0, SHELF_SLOTS - shelves);
}
