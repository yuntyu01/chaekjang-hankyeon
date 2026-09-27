# 책장 한켠

읽은 책을 모아 직접 배치해 꾸미는 책장 앱(가칭). 화면명은 "나의 책장".

- 홈 지시서: `docs/HOME_BRIEF.md`, 시안: `docs/design/home-reference.png`
- 홈 외 기능 지시서: `docs/SPEC.md` (Phase 0~6, 승인 후 진행)
- 캡처: `docs/screenshots/`

## 실행

```bash
cd app
npm install
npx expo start --port 8095   # Expo Go(SDK 57)로 연다
npm test                     # 배치 엔진·조판 단위 테스트
npm run typecheck
```

## 구조 (app/src)

| 경로 | 역할 |
|---|---|
| `domain/types.ts` | Book, BookPlacement, ShelfLayout |
| `domain/geometry.ts` | 설계 단위(폭 390) 치수, 높이·두께 등급, 기울임 경계 |
| `domain/layout-engine.ts` | LayoutEngine: 이동·쌓기·형태·기울기·검증(순수) |
| `domain/shelf-scene.ts` | 회전 후 윤곽·바닥점·터치 판정(순수) |
| `domain/title-layout.ts` | 세로 책등 제목 조판 |
| `store/placement-store.ts` | PlacementStore: 확정 상태, 로컬 저장(expo-sqlite kv), 되돌리기 1회, 저장 실패 표시 |
| `ui/book/BookRenderer.tsx` | 책 한 권(책등/가로/정면) |
| `ui/art/` | 개발용 샘플 SVG 일러스트(장면 6종, 모티프 9종) |
| `ui/shelf/ShelfRow.tsx`, `ShelfShadows.tsx`, `DragOverlay.tsx` | 선반, 화면 좌표 기준 그림자, 드래그 오버레이 |
| `features/home/HomeScreen.tsx`, `BookDetail.tsx` | 홈 화면과 상세·배치 메뉴 |

## 설계 메모

- 저장은 선반·순서·쌓기 그룹만. 픽셀 좌표는 매번 설계 단위로 계산해 화면 폭에 맞게 균일하게 스케일한다. 520px보다 넓으면 멈추고 가운데 정렬, 좁은 화면은 그대로 축소한다.
- 모든 변경(드롭·형태·기울기·메뉴 이동)은 임시 레이아웃 전체를 만들어 공간과 무결성을 검증한 뒤 한 번에 확정한다.
- 터치는 선반 전체에 제스처 하나를 두고 책 윤곽(회전 반영)으로 판정한다. 그림자는 판정에 들어가지 않는다.
- 외부 그림자는 플랫폼 그림자 API 대신 선반 좌표의 SVG 도형으로 그린다(iOS/Android 동일, 회전과 무관하게 오른쪽 아래).
- 서체: 제목 고운바탕(Gowun Batang, SIL OFL 1.1), 메뉴·숫자는 시스템 고딕.

## 현재 상태 (2026-09-27)

홈 책장만 구현했다. Android 에뮬레이터(Pixel, API 36, Expo Go)에서 확인한 항목:

- 16권 샘플(세움·좌우 기울임·2권 쌓기·표지 전시 3권) 렌더링, 헤더 "2026년 · 16권"
- 짧게 누르기 → 책이 살짝 들리고 상세 시트
- 메뉴로 형태 변경(눕히기), 공간 부족 시 거절 안내
- 길게 눌러 선반 간 이동, 가장자리 자동 스크롤, 새 선반 드롭, 눕힌 책 쌓기("쌓기" 미리보기), 맨 아래 책 빼기, 되돌리기
- 앱 강제 종료 후 재실행 시 배치 복원
- 화면 폭 약 308dp(density 560)에서 균일 축소, 헤더 한 줄

확인하지 않은 것: iOS 실기기·시뮬레이터, TalkBack/VoiceOver 실제 읽기, 동작 줄이기 설정 켠 상태, 200권 이상 성능(선반 단위 캐시만 있고 가상화는 없음), 저장 실패 경로(재시도 배너는 코드만 있음).

## 자산 상태

선반의 그림은 모두 코드로 그린 **개발용 샘플 SVG**다. 실제 재장정 자산 슬롯은 `Book.coverArtUri` / `Book.spineArtUri`이며 값이 있으면 샘플 대신 쓴다. 시안과 비교해 부족한 점:

- 시안의 수채화·종이 질감이 없다(평면 벡터 + 그라데이션 명암).
- 장면 그림의 밀도가 낮다(특히 여름의 숲 나무, 어린 왕자 인물).
- 필요 자산: 모티프 약 30종(책등용 세로 PNG, 투명 배경), 표지 장면 일러스트(불투명 사각), 종이 질감 오버레이.
