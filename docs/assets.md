# 자산 규격

## 자산 구분

| 구분 | 위치 | 상태 |
|---|---|---|
| **최종** 종이 배경 | `app/assets/bookshelf/paper-background.png` | 받은 자산 |
| 선반 | 코드(3D 판: `app/src/ui/shelf/ShelfPlank.tsx`, 치수 `app/src/domain/geometry.ts`) | 받은 선반 PNG(shelf-plank, 원본 v3·v4)는 3D 판으로 바꾼 뒤 쓰지 않아 2026-10-26 지움 |
| **임시** 책 재료 | `app/assets/body/` (`motif/`, `cover/`, `brush-detail.png`) | `scripts/extract-body-assets.py`가 시안 원본(`app/assets/source/books-source.png`, 앱 번들 제외)에서 평평한 재료만 추출: 책등 색·모티프·책등 장면, 제목 지운 표지 그림, 붓결 질감. 최종 재장정 아트로 교체 대상 |

책 형태(크기·윤곽·옆면·윗면·명암)는 코드(`app/src/ui/book/BookBody.tsx`)가 그린다. 잘라 붙인 책 이미지는 쓰지 않는다.

## 책 크기(실제 단위)

- 선반 안쪽 길이 480mm = 선반 사용 폭. 화면에서는 비율만 바뀐다(`geometry.ts` `SHELF_LENGTH_MM`, `DU_PER_MM`).
- 높이·표지 폭: 판형 그대로. 두께: 실제 두께 (쪽수 × 0.06mm + 1.5mm)가 10mm 이하면 30DU(세로 제목이 들어가는 최소), 그보다 두꺼운 만큼은 실제 비율의 1.4배로 늘린다(300쪽 ≈ 40DU).
- 자세별 점유 폭: 세움 = 두께, 누움 = 책 높이, 표지 = 표지 폭 + 옆면, 쌓기 = 가장 긴 책.
- 예: 300쪽 책은 한 선반에 세워서 9권.
- 가운데 시점: 화면 가운데보다 왼쪽 책은 오른쪽 옆면, 오른쪽 책은 왼쪽 옆면이 보이고 가운데에 가까울수록 옆면이 좁다(`geometry.ts` `viewOf`).
- 붓결: `extract-body-assets.py`가 요철 음영 없이 평평한 물감 얼룩 + 옅은 비스듬한 결 + 드문 밝은 점·잔 긁힘을 합성한다(굵기별 세기는 시안 데미안 면을 보고 맞춤).
- 명암: 책등은 앞면(왼쪽 가까이 가장 밝음) → 좁은 홈(어두운 책만) → 한 톤 어두운 옆면. 그늘은 회색이 아니라 따뜻한 갈색 쪽으로 어두워진다(채널별 지수). 실루엣에는 책 색을 어둡게 한 또렷한 선을 두른다(조금 어긋난 두 번째 선으로 굵기가 고르지 않게). 가장자리는 파장 24·10DU 사인으로 최대 0.32DU 부드럽게 흔들리고, 책등 머리는 가운데가 0.9DU 볼록하다. 빛을 받는 위·왼쪽 가장자리 안쪽에는 넓고 흐린 밝은 테가 있다.
- 누운 책: 사선 투영 상자. 앞면(책등) + 윗면(뒤 모서리가 오른쪽으로 윗면 깊이만큼 밀린 평행사변형, 왼쪽 끝 45도) + 오른쪽 끝면(위아래 얇은 표지 판은 책 색, 사이는 아이보리 종이 단면). 끝면 폭 = 윗면 깊이(TOP_FACE)라 앞면은 그만큼 짧다. 앞면·윗면은 끝까지 한 장으로 그리고 끝면이 덮는다(이음선 없음).
- 세로 시점: 2번째 선반이 눈높이. 위 선반은 올려다봐 옆면 위가 깎이고, 아래 선반은 내려다봐 세운 책 윗면(아이보리 종이 + 양옆 표지 판)이 TOP_VIEW(4DU)만큼 보인다. 누운 책 더미는 LYING_BACK(2DU) 뒤에 놓인다.
- 표지 책: 책은 오른쪽으로 열리므로 왼쪽 옆면 = 책등(책 색), 오른쪽 옆면 = 여는 쪽 종이 단면(앞뒤 표지 판 사이 아이보리). 가운데보다 오른쪽 책은 책등이, 왼쪽 책은 종이가 보인다. 옆면은 표지 가장자리에 붙어 뒤로 물러나는 평행사변형이고 세로 시점도 세운 책과 같은 규칙. 테두리 색은 표지 그림 가장자리 색(COVER_ART.edge).
- 기기 없이 몸체만 확인: `QA_OUT=/tmp/bodies.png npx jest -c scripts/qa/render-bodies.jest.config.js`(CanvasKit 헤드리스, 제목·선반 제외).
- 모서리 빛 반사: 면이 꺾이는 모서리(세운 책 앞면-옆면, 누운 책 앞면-윗면·앞면-끝면·윗면-끝면, 표지 앞면-옆면)에 흐린 흰 선.
- 그림자: 빛 반대쪽(오른쪽 아래)으로만 떨어진다. 흐림이 왼쪽·위로 새지 않게 시작 윤곽도 조금 민다.
- 예시 18권은 실제 책(판형·쪽수는 공개 서지 기준 대략값, 서지 API 연동 시 교체).

## 선반(코드)

선반 판은 3D 상자(깊이 230mm = 앞 끝 → 책 기준선 70mm + 벽까지 160mm, 두께 21.5mm, 모서리 둥글기 2mm)를 책과 같은 원근 카메라로 투영해 그린다(`ShelfPlank.tsx`, `domain/shelf-geom.ts`).
예전 선반 PNG 측정값(`shelf-asset.generated.ts`)과 측정·그림자 분리 스크립트(`measure-shelf.py`, `separate-shelf-shadow.py`)는 2026-10-26 지웠다.

## 빛과 그림자(코드)

모든 면에 같은 빛 두 개만 쓴다: 창빛(왼쪽 9°·위 17°, 반지름 14° 원반)과 방 빛(위·앞이 밝은 방, 하늘 가림 세기 0.55). 값과 근거는 `app/src/ui/lighting.ts`, 계산은 `app/src/domain/light-model.ts`(빛 격자·판 그림자)·`cast-shadow.ts`(책 그림자)·`app/src/ui/scene-light-sksl.ts`(셰이더).
판 아래 그림자는 판 바로 아래가 가장 짙고 길게 옅어진다(2026-10-26, 그림자 참고 그림에 맞춤). 손으로 정한 그림자 층(예전 `theme.ts` `shadow`·`SoftShadow.tsx`)은 없다.

시안 대조 도구: `app/scripts/qa/cmpshadow.py 시안.png 캡처.png`, `rightprof.py`(벽색→그림자색 방향으로 그림자 세기를 떼어 같은 지점 비교).

## 추가로 필요한 최종 자산

| 파일 | 규격 | 용도 |
|---|---|---|
| `motifs/<id>/spine.png` ×30 | 180×450px(2:5) 투명 PNG, 아래 정렬, 단색 또는 채색 | 책등·가로 책등의 작은 그림(모티프 슬롯, 아래 표) |
| `motifs/<id>/cover.png` ×30 | 600×600px 투명 PNG | 단색 표지 가운데 큰 그림 |
| `art/<isbn>/cover-art.png` (선택) | 700×1000px 불투명, 제목 없음 | 표지 전시 책의 재장정 그림. 책등은 같은 그림을 크롭 |
| `art/<isbn>/spine-art.png` (선택) | 책등 폭:높이 1:4.5, 투명 또는 불투명, 제목 없음 | 책등 아래쪽 장면(어린왕자·여행의 이유처럼) |
| 책 몸체 질감(선택) | 512×512 이음새 없는 그레이스케일 | 지금은 코드 생성 결(paper-grain)을 쓴다. 천·가죽 장정 등 다른 재질이 필요하면 |

책 몸체(둥근 책등·표지판 돌출·속지 띠·모서리 명암·갈피)는 코드로 그려서 모든 자세가 같은 디자인 데이터(색·모티프·아트)를 공유한다. 제목·저자는 이미지에 넣지 않는다.

## 모티프 슬롯 30개

책등·가로 책등·단색 표지에 올리는 작은 그림. 슬롯 id는 `app/src/domain/motif-slots.ts`, 서버 `books.default_motif_id`와 `user_books.custom_motif_id`에 저장한다. 파일이 없으면 개발용 SVG(대체)로 그린다.

| # | id | 이름 | 파일 | 개발용 대체 |
|---|---|---|---|---|
| 1 | `leaf` | 잎 | `motifs/leaf/spine.png`, `motifs/leaf/cover.png` | leaf |
| 2 | `sprig` | 가지 | `motifs/sprig/spine.png`, `motifs/sprig/cover.png` | sprig |
| 3 | `cotton` | 목화 | `motifs/cotton/spine.png`, `motifs/cotton/cover.png` | cotton |
| 4 | `moon` | 달 | `motifs/moon/spine.png`, `motifs/moon/cover.png` | moon |
| 5 | `crescent` | 초승달 | `motifs/crescent/spine.png`, `motifs/crescent/cover.png` | moon |
| 6 | `star` | 별 | `motifs/star/spine.png`, `motifs/star/cover.png` | star |
| 7 | `constellation` | 별자리 | `motifs/constellation/spine.png`, `motifs/constellation/cover.png` | star |
| 8 | `wave` | 파도 | `motifs/wave/spine.png`, `motifs/wave/cover.png` | wave |
| 9 | `ripple` | 물결 | `motifs/ripple/spine.png`, `motifs/ripple/cover.png` | wave |
| 10 | `flower` | 꽃 | `motifs/flower/spine.png`, `motifs/flower/cover.png` | flower |
| 11 | `wildflower` | 들꽃 | `motifs/wildflower/spine.png`, `motifs/wildflower/cover.png` | bud |
| 12 | `tulip` | 튤립 | `motifs/tulip/spine.png`, `motifs/tulip/cover.png` | bud |
| 13 | `camellia` | 동백 | `motifs/camellia/spine.png`, `motifs/camellia/cover.png` | flower |
| 14 | `pine` | 소나무 | `motifs/pine/spine.png`, `motifs/pine/cover.png` | pine |
| 15 | `mountain` | 산 | `motifs/mountain/spine.png`, `motifs/mountain/cover.png` | pine |
| 16 | `cloud` | 구름 | `motifs/cloud/spine.png`, `motifs/cloud/cover.png` | wave |
| 17 | `sun` | 해 | `motifs/sun/spine.png`, `motifs/sun/cover.png` | star |
| 18 | `rain` | 비 | `motifs/rain/spine.png`, `motifs/rain/cover.png` | wave |
| 19 | `snow` | 눈송이 | `motifs/snow/spine.png`, `motifs/snow/cover.png` | star |
| 20 | `feather` | 깃털 | `motifs/feather/spine.png`, `motifs/feather/cover.png` | leaf |
| 21 | `bird` | 새 | `motifs/bird/spine.png`, `motifs/bird/cover.png` | sprig |
| 22 | `cat` | 고양이 | `motifs/cat/spine.png`, `motifs/cat/cover.png` | moon |
| 23 | `teacup` | 찻잔 | `motifs/teacup/spine.png`, `motifs/teacup/cover.png` | bud |
| 24 | `candle` | 촛불 | `motifs/candle/spine.png`, `motifs/candle/cover.png` | bud |
| 25 | `key` | 열쇠 | `motifs/key/spine.png`, `motifs/key/cover.png` | star |
| 26 | `letter` | 편지 | `motifs/letter/spine.png`, `motifs/letter/cover.png` | leaf |
| 27 | `window` | 창문 | `motifs/window/spine.png`, `motifs/window/cover.png` | moon |
| 28 | `lantern` | 등불 | `motifs/lantern/spine.png`, `motifs/lantern/cover.png` | bud |
| 29 | `shell` | 조개 | `motifs/shell/spine.png`, `motifs/shell/cover.png` | wave |
| 30 | `mushroom` | 버섯 | `motifs/mushroom/spine.png`, `motifs/mushroom/cover.png` | bud |

### 파일 규격

- `spine.png`: 책등용 세로 모티프. 비율 2:5, 180×450px(@3x), 투명 배경, 아래쪽 정렬(줄기가 바닥에서 올라오는 구도). 선반·그림자·글자 넣지 않음.
- `cover.png`: 단색 표지 가운데 아래에 놓는 큰 모티프. 1:1, 600×600px, 투명 배경.
- 색: 한 가지 잉크색(흑백 또는 단색)으로 그리면 앱이 책 색에 맞춰 칠할 수 있다(tintColor). 여러 색이면 그대로 쓴다.
- 종이 질감이 필요하면 모티프가 아니라 공통 `textures/paper.png`(512×512, 반복, 흰 바탕 멀티플라이용) 한 장으로 분리한다.

## 온보딩 예시 그림(임시)

온보딩 예시 18권은 원본 이미지와 `src/domain/reference-art.ts`의 개별 윤곽·역회전 행렬을 쓴다. `ReferenceBook.tsx`가 화면 전체를 배경으로 깔지 않고 책마다 별도 SVG 노드로 그리므로 터치·드래그·기울임이 유지된다. 그림을 여러 띠로 나눠 늘리거나 원본 윗면에 윗면을 덧붙이지 않는다. 기본 자세의 글자는 이미지에 포함되며 샘플 메타데이터 변경만으로 바뀌지 않는다.

예시 자세를 바꾸면 이전 `temp-reference` 자산과 코드 렌더러를 사용한다. 실제 등록 책은 `coverArtUri`·`spineArtUri`와 앱 조판을 사용하며, 목표 이미지의 예시 윤곽을 공유하지 않는다. 사진 → AI 그림 생성 → URI 저장 연결은 별도 미구현 단계다.

## 서체

| 용도 | 서체 | 라이선스 | 비고 |
|---|---|---|---|
| 제목·책 이름(명조) | 고운바탕 Gowun Batang 400/700 | SIL OFL 1.1 | `@expo-google-fonts/gowun-batang`, 앱 번들 포함 |
| 메뉴·숫자(고딕) | 시스템 기본 | OS 제공 | Android Noto Sans CJK, iOS Apple SD Gothic Neo |
