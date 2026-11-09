# 책 공유 카드 재료 만들기

2026-11-10 사용자 시안(`docs/design/책 공유 시안 (빛·그림자 기준).png`, 941×1671)에 '재질·빛비침·그림자 99% 동일'하게 맞춘 재료와 그 값을 만든 스크립트다.
앱 그리기는 `src/features/book/share-scene.ts` 한 곳이고, 아래 `render.mjs`가 같은 파일을 CanvasKit(앱과 같은 Skia)으로 돌려 시안과 화소 단위로 비교한다.

| 재료(`assets/share/`) | 만드는 곳 | 내용 |
|---|---|---|
| `plate.png` | `plate.py` → `plate_shelf.py` | 시안에서 책·글자·책 그림자를 지운 바탕(벽 질감·창빛 줄기·나무 선반). 지운 자리는 빛 세기를 주변에서 잇고(조화 메움) 잔무늬는 깨끗한 벽에서 옮긴다. 선반 윗면은 결만 왼쪽 판에서 옮긴다 |
| `book-mul.png`, `book-add.png` | `overlay.py` | 책 오버레이. 표지 색 c에 `c·M + A`. M=곱하는 빛(큰 기울기 2차 곡면·책등 홈·가장자리 그늘·종이 결, 값×128), A=더하는 빛(왼쪽 위 은은한 빛·가장자리 반사, 값+64). 책등 홈은 분홍·검은 띠 짝으로 M·A를 함께 풀었다 |
| `book-pages.png` | `overlay.py` | 오른쪽 속지 띠(시안에서 잘라 냄, 위·아래 기운 끝은 투명) |
| `shelf-right.png`, `shelf-front.png` | (fit 메모 참고) | 선반 윗면 책 오른쪽 그늘·책 앞 닿는 그늘(곱하기) |

- 벽 그림자 세 겹(`fit_shadow.py`): 책 모양을 옮겨 흐린 그늘, 밝기 오차 약 1%. 값은 `share-scene.ts` SHADOW.
- 표지 색감(GRADE): 실제 아몬드 표지와 시안 표지 11곳을 짝지어 맞춤(채도 1.42, 감마 1.015, 밝기 0.978, 검정을 따뜻한 회색으로).
- 글꼴: 제목 마루부리 SemiBold 67px, 감상 마루부리 Regular 48px(줄 70), 저자·별점 숫자 Pretendard Regular 36px, '책장 한켠' Pretendard Medium 33px.

비교(`node --experimental-strip-types render.mjs <표지.jpg> out.png '{"coverAspect":0.703}'` → `python3 compare2.py out.png '{"x":239,"y":224,"w":433,"h":616}'`):
빛·그늘 SSIM(흐리게 본 밝기) 벽 99.99%, 책 둘레·그림자 99.2%, 선반 99.7%, 글자 96.5%, 전체 98.4%. 표지 그림 안쪽은 시안이 다시 그린 표지라 비교에서 뺀다.
파이썬은 numpy·opencv·scipy·Pillow, 노드는 22(type stripping).

## 갈피 공유 두 모양

`mark_plate.py <시안> <out.png> '<글자 상자 json>' '<잔무늬 원천 상자>'`로 글자를 지운 바탕(`assets/share/bookmark-page.png`, `bookmark-note.png`)을 만든다(상자마다 둘레 띠의 흐린 밝기로 2차 곡면 + 같은 그림의 깨끗한 종이 잔무늬).
책 페이지: `'[[190,580,685,875],[190,953,476,991],[345,1536,596,1570],[785,1535,854,1570]]' '[600,1100,900,1450]'`, 종이 메모: `'[[150,666,670,962],[150,1195,310,1291],[708,1253,790,1292],[312,1550,628,1580]]' '[450,450,840,640]'`.
그리기는 `src/features/bookmark/bookmark-scene.ts`, 비교는 `node --experimental-strip-types mark.mjs <page|note> out.png` → `python3 mcompare.py <시안> out.png`.
