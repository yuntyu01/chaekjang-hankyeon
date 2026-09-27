// 자동 생성: app/scripts/measure-shelf.py 가 assets/bookshelf/shelf-single.png 를 실제로 측정한 값. 직접 고치지 말 것.
// 모든 값은 이미지 전체 폭/높이 대비 비율(투명 여백 포함).
export const SHELF_ASSET = {
  "width": 2172,
  "height": 724,
  "plankTopY": 0.3978,
  "frontTopY": 0.5014,
  "frontBottomY": 0.5856,
  "contactY": 0.4703,
  "shadowBottomY": 0.761,
  "usableLeft": 0.0433,
  "usableRight": 0.9572,
  "frontLeft": 0.0235,
  "frontRight": 0.9761,
  "plankLeft": 0.0235,
  "plankRight": 0.977,
  "plankTop": 0.3964,
  "plankBottom": 0.5939
} as const;

// 종이 배경 이음새 검사: 가장자리 차이 x=1.82/y=2.87, 내부 이웃 차이 x=1.32/y=1.90,
// 끝 32px 평균 밝기 차 좌우=0.37/상하=0.30 → seamless=true
export const PAPER_SEAMLESS = true;
