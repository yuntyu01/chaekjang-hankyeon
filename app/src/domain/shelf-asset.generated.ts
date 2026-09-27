// 자동 생성: app/scripts/measure-shelf.py 가 assets/bookshelf/shelf-plank.png(그림자 분리본)를 실제로 측정한 값. 직접 고치지 말 것.
// 모든 값은 이미지 전체 폭/높이 대비 비율(투명 여백 포함).
export const SHELF_ASSET = {
  "width": 2172,
  "height": 724,
  "plankTopY": 0.395,
  "frontTopY": 0.5,
  "frontBottomY": 0.5815,
  "contactY": 0.4685,
  "shadowBottomY": 0.5843,
  "usableLeft": 0.0433,
  "usableRight": 0.9563,
  "frontLeft": 0.0249,
  "frontRight": 0.9751,
  "plankLeft": 0.0239,
  "plankRight": 0.9761,
  "plankTop": 0.3936,
  "plankBottom": 0.5829
} as const;

// 종이 배경 이음새 검사: 가장자리 차이 x=1.82/y=2.87, 내부 이웃 차이 x=1.32/y=1.90,
// 끝 32px 평균 밝기 차 좌우=0.37/상하=0.30 → seamless=true
export const PAPER_SEAMLESS = true;
