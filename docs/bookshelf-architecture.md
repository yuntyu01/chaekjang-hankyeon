# 책장 상태와 계산의 경계

책장 조작은 **입력 → 미리보기 계산 → 확정 → 표시 전환** 순서로 흐른다. 확정 전 배치는 로컬 DB에 저장하지 않는다.

| 책임 | 소유 모듈 | 변경 규칙 |
| --- | --- | --- |
| 선택·정보 상자·편집·드래그 | `features/home/shelf-interaction.ts`, `useShelfInteraction.ts` | reducer의 명시적 action으로 변경한다. 포인터 콜백이 다음 React 커밋 전에 읽는 드래그 참조는 같은 hook이 관리한다. |
| 드래그 후보·넘어짐 유지·프레임 예약 | `useShelfDragPreview.ts` | 항상 확정 배치에서 후보를 계산한다. 마지막 포인터 위치를 놓기 전에 반영하고, 취소·화면 이탈 때 예약을 해제한다. |
| 조작 종료·백그라운드 전환 | `useShelfDragLifecycle.ts` | 미리보기와 자동 스크롤을 함께 종료한다. |
| 자세·기대기·깊이·회전·손잡이 | `useShelfEditCommands.ts` | 임시 자세는 렌더러에만 전달하고 조작 종료 시 commit adapter로 확정한다. |
| 선반 사이 임시 표시 | `row-holds.ts`, `useRowHolds.ts` | 책별 해제 타이머 하나를 유지한다. 새 조작은 이전 해제를 취소한다. |
| 도착 자세·서랍 낙하·이동 캔버스 | `shelf-transitions.ts`, `useShelfTransitions.ts` | 이전 커밋의 snapshot으로 다음 표시 상태를 계산한다. 렌더 도중 이전 snapshot을 수정하지 않는다. |
| 확정 배치·되돌리기·저장 | `store/placement-store.ts` | commit에서 물리 해석과 무결성 검사를 통과한 결과만 저장한다. |

## 물리 결과와 저장

`resolveLeans(layout, books, shelfId?)`는 `{ layout, falls }`를 반환한다. `falls`는 그 계산에서 서랍으로 떨어진 책의 방향이다. 다른 계산이 읽는 전역 Map은 없다. 배치만 필요한 호출은 `withLeans`를 사용한다.

드래그 미리보기를 확정할 때는 결과 전체를 `placementStore.commit({ layout, falls })`에 전달한다. 저장소는 실제로 새로 떨어진 책의 방향만 해당 변경에 붙인다. 되돌리기·다시 불러오기·서재 갱신은 오래된 낙하 정보를 제거한다. 낙하 방향은 저장 형식에 추가하지 않는다.

`domain/layout-schema.ts`는 저장 형식 이전·정규화·구조 검사를 맡는다. 기하 계산을 가져오지 않는다. `layout-engine.ts`는 배치 명령과 공간 검사를 맡고, 기존 호출자를 위해 구조 함수도 다시 내보낸다. 새 저장 관련 코드는 schema를 직접 가져온다.

## 계산과 애니메이션

`domain/transition.ts`는 공개 API와 후보 선택을 맡는다. `domain/transition/`의 각 모듈이 경로 조각, 후보 구성, 충돌 검사, 중력, 낙하 순서, 선반 이동, 서랍 낙하, 경로 이어붙이기를 계산한다. 내부 모듈은 공개 facade를 다시 가져오지 않는다.

낙하 경로 캐시는 계획 한 번의 입력 자세와 함께 만들어 후보들끼리 공유한다. 다른 계획으로 넘기지 않는다. UI 스레드의 실행·캔버스 준비 대기는 `ui/shelf/planner.ts`가 맡는다. 교체되어 실행할 수 없는 적용 요청은 등록 목록에서 제거한다.

`useSceneMotions` 캐시는 현재 선반의 Motion만 소유한다. 제거된 Motion을 강제 폐기하지 않으므로 진행 중인 경로가 잡은 참조는 유지된다.

## 공유 설정과 검증

조명·재질·측정 색상은 `scene-config/`에 둔다. domain과 UI가 같은 값을 읽으며, domain이 UI를 가져오지 않는다. `dependency-boundaries.test.ts`가 이 의존성 방향을 검사한다.

변경 후 `npm run typecheck`, `npm test -- --runInBand`, Android Expo export를 실행한다. 조작 상태 전환, 미리보기 취소, 독립적인 낙하 계산, 배치 복구, 이동·충돌·그림자 회귀 테스트로 기존 동작을 확인한다. 네이티브 기기의 프레임 시간과 GPU 메모리는 별도로 측정해야 한다.

## 남은 경계

HomeScreen에는 화면 조립, UI 스레드 제스처 연결, 카메라·스크롤, 개발용 측정 UI가 남아 있다. 배치 엔진의 이동·쌓기 명령도 아직 큰 모듈이다. 다음 분리는 줄 수보다 각 기능의 입력·출력과 상태 소유권을 기준으로 한다.

planner의 `awayRows`는 떠난 책의 그림자 경로를 연결하는 전역 등록부다. 여러 선반이 동시에 사용하는 동안 한 선반의 unmount에서 통째로 비우면 안 된다. 완료된 경로와 화면별 소유권을 구분하는 정리 계약은 추가 작업이 필요하다.
