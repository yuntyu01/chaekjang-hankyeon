# 자산 규격

## 자산 구분

| 구분 | 위치 | 상태 |
|---|---|---|
| **최종** 종이 배경 | `app/assets/bookshelf/paper-background.png` (1254×1254 RGB) | 받은 자산. 이음새 검사 통과(`scripts/measure-shelf.py`) → 기기 픽셀 1:1로 반복, 화면 고정 |
| **최종** 선반 한 칸 | `app/assets/bookshelf/shelf-single-v3.png` (2172×724 RGBA, 고정 그림자 포함, 윗면 전체 깊이) | 받은 자산. 측정 메타데이터 `src/domain/shelf-asset.generated.ts` |
| 최종(코드 생성) 종이 결 | `app/assets/texture/paper-grain@3x.png` | 시안의 결 세기(밝기 표준편차 2~6)에 맞춰 생성한 이음새 없는 타일. 책 몸체에 겹친다 |
| **임시 TEMP** 예시 책 그림 | `app/assets/temp-reference/*` | 시안 이미지에서 잘라 제목을 지운 개발용 샘플. 최종 재장정 아트로 교체 대상 |
| **임시 TEMP** 모티프 SVG | `app/src/ui/art/motifs.tsx`, `scenes.tsx` | 모티프 PNG가 없을 때의 대체 그림 |

## 선반 PNG 측정값(v3, 정규화, 투명 여백 포함)

`scripts/measure-shelf.py`가 잰다. 나무판 본체는 불투명 픽셀의 가장 큰 연결 덩어리로 잡아 희미한 고립 알파를 무시한다.
plankLeft 0.0235 · plankRight 0.977 · plankTopY 0.3978(윗면 뒤) · frontTopY 0.5014(앞턱 위) · frontBottomY 0.5856 · contactY 0.4703(책 밑면, 윗면 깊이의 30% 안쪽) · usableLeft 0.0433 · usableRight 0.9572(기준선 줄에서 잰 윗면 범위, 4px 안쪽).
윗면(약 75px)과 앞면(약 61px)이 비슷한 깊이. 표시: 원본 비율 유지, 나무판이 화면 좌우 5DU 여백에 오도록 폭 398.5DU·오프셋 -4.4DU. 줄 간격 ROW_PITCH 약 225DU(모든 줄 공통: 책 영역 209 + 앞턱 아래 15.3 + 1).
선반 고정 그림자는 PNG 그대로 쓰고 코드로 다시 그리지 않는다. 앞턱 가림: 책 밑면이 기준선에 서서 앞턱 아래로 내려가지 않아 전경 마스크는 쓰지 않았다.

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

온보딩 예시 18권은 `app/scripts/extract-reference-assets.py`가 시안에서 잘라낸 임시 자산을 쓴다(제목은 inpaint로 지우고 앱이 다시 조판). 모티프는 바탕색을 빼 투명 PNG로 뽑아, 형태를 바꿔도 같은 그림이 나온다.

## 서체

| 용도 | 서체 | 라이선스 | 비고 |
|---|---|---|---|
| 제목·책 이름(명조) | 고운바탕 Gowun Batang 400/700 | SIL OFL 1.1 | `@expo-google-fonts/gowun-batang`, 앱 번들 포함 |
| 메뉴·숫자(고딕) | 시스템 기본 | OS 제공 | Android Noto Sans CJK, iOS Apple SD Gothic Neo |
