# 자산 규격

## 자산 구분

| 구분 | 위치 | 상태 |
|---|---|---|
| **최종** 종이 배경 | `app/assets/bookshelf/paper-background.png` | 받은 자산 |
| **최종** 선반 | `app/assets/bookshelf/shelf-plank.png` | 받은 v4에서 그림자 분리 |
| **임시** 책 재료 | `app/assets/body/` (`motif/`, `cover/`, `brush-detail.png`) | `scripts/extract-body-assets.py`가 시안 원본(`app/assets/source/books-source.png`, 앱 번들 제외)에서 평평한 재료만 추출: 책등 색·모티프·책등 장면, 제목 지운 표지 그림, 붓결 질감. 최종 재장정 아트로 교체 대상 |

책 형태(크기·윤곽·옆면·윗면·명암)는 코드(`app/src/ui/book/BookBody.tsx`)가 그린다. 잘라 붙인 책 이미지는 쓰지 않는다.

## 책 크기(실제 단위)

- 선반 안쪽 길이 480mm = 선반 사용 폭. 화면에서는 비율만 바뀐다(`geometry.ts` `SHELF_LENGTH_MM`, `DU_PER_MM`).
- 높이·표지 폭: 판형 그대로. 두께: 실제 두께 (쪽수 × 0.06mm + 1.5mm)가 10mm 이하면 30DU(세로 제목이 들어가는 최소), 그보다 두꺼운 만큼은 실제 비율의 1.4배로 늘린다(300쪽 ≈ 40DU).
- 자세별 점유 폭: 세움 = 두께, 누움 = 책 높이, 표지 = 표지 폭 + 옆면, 쌓기 = 가장 긴 책.
- 예: 300쪽 책은 한 선반에 세워서 9권.
- 가운데 시점: 화면 가운데보다 왼쪽 책은 오른쪽 옆면, 오른쪽 책은 왼쪽 옆면이 보이고 가운데에 가까울수록 옆면이 좁다(`geometry.ts` `viewOf`).
- 붓결: `extract-body-assets.py`가 요철 음영 없이 평평한 물감 얼룩 + 옅은 비스듬한 결 + 드문 밝은 점·잔 긁힘을 합성한다(굵기별 세기는 시안 데미안 면을 보고 맞춤).
- 명암: 책등은 앞면(왼쪽 가까이 가장 밝음) → 좁은 홈(어두운 책만) → 한 톤 어두운 옆면. 그늘은 회색이 아니라 따뜻한 갈색 쪽으로 어두워진다(채널별 지수). 실루엣에는 책 색을 어둡게 한 또렷한 선을 두른다.
- 그림자: 빛 반대쪽(오른쪽 아래)으로만 떨어진다. 흐림이 왼쪽·위로 새지 않게 시작 윤곽도 조금 민다.
- 예시 18권은 실제 책(판형·쪽수는 공개 서지 기준 대략값, 서지 API 연동 시 교체).

## 선반 PNG 측정값(shelf-plank, 정규화, 투명 여백 포함)

`scripts/measure-shelf.py`가 잰다. 나무판 본체는 불투명 픽셀의 가장 큰 연결 덩어리. 윗면/앞면 경계는 두 면 대표 밝기의 중간값으로 찾는다(앞면 아래 어두운 테두리에 속지 않게).
plankLeft 0.0239 · plankRight 0.9761 · plankTopY 0.395 · frontTopY 0.5 · plankBottom 0.5829 · contactY 0.4685(기존 측정 기준선) · usableLeft 0.0433 · usableRight 0.9563.
실제 책 접촉선은 `geometry.ts`의 `BOOK_SHELF_DEPTH=0.28`로 계산한다. 윗면 뒤쪽에서 28% 지점(이미지 정규화 y=0.4244)이며 책 앞에 약 9.6DU의 나무 면을 남긴다. 원본 측정 메타데이터는 유지한다.
표시: 나무판이 화면 좌우 2DU에 오도록 폭·오프셋 계산, 세로 두께 배율 0.94. 모든 선반에 같은 줄 간격(전체 책·쌓기의 최대 높이 + 갈피 8DU + 위 여백 12DU + 선반 아래 영역)을 적용한다. 3개 선반을 헤더와 하단 아이콘 사이에 중앙 정렬한다.

## 그림자(코드)

빛은 왼쪽 위. 책·선반 모두 윤곽을 오른쪽 아래로 옮긴 모양과 원래 윤곽을 이은 볼록 껍질을 Skia `BlurMask`로 흐린다. SVG 블러 폭 제한 없이 접촉층과 넓은 확산층을 그린다. 책갈피는 작은 View 안에만 그려 반복 텍스처가 벽으로 새어 나오지 않게 한다. 드래그 중의 단일 그림자는 `SoftShadow.tsx`를 사용한다.
- 책: `theme.ts` `shadow.cast.layers`(dx·dy·blur·opacity), `fade`(높이별) → `src/ui/shelf/ShelfShadows.tsx`
- 선반: `theme.ts` `shelfShadow.layers`(짧은 접촉층 2개) + `tail`(82DU 연속 감쇠층) → `src/ui/shelf/ShelfShadow.tsx`. 꼬리 뒤에도 블러 3배의 캔버스 여백을 둔다.
- 선반 두께: `geometry.ts` `SHELF_THICKNESS`(0.94)
- 그리는 순서: 책의 벽 그림자 → 선반 그림자·본체 → 책 접촉 그림자 → 책 → 선반 앞턱. 벽 그림자가 나무 면 위에 칠해지거나 책이 앞턱을 덮지 않게 한다.

시안 대조 도구: `app/scripts/qa/cmpshadow.py 시안.png 캡처.png`, `rightprof.py`(벽색→그림자색 방향으로 그림자 세기를 떼어 같은 지점 비교).
그림자 길이·거리별 감쇠·책 깊이는 3차 수정에서 변경됐다. 현재 검증 내용은 `HOME_VISUAL_REVIEW.md` 참고.

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
