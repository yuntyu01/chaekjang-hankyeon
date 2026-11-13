// 실제 책 비교 책장(지금 앱 domain/real-sample). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
// spineRatio: 지금 앱이 그리는 두께/높이(책등 사진 비율에서 정한 실제 두께)
library;

const realSampleBooks = [
  (id: 'b01', title: '모순', author: '양귀자', publisher: '쓰다', goods: 8759796, widthMm: 128, heightMm: 188, pages: 308, spineRatio: 0.19532612486920126, color: '#EDEBE5', ribbon: '#D4B3EF', ribbonCount: 1),
  (id: 'b02', title: '데미안', author: '헤르만 헤세', publisher: '민음사', goods: 176787, widthMm: 132, heightMm: 225, pages: 239, spineRatio: 0.16320582877959927, color: '#EDEDED', ribbon: '#7B4497', ribbonCount: 2),
  (id: 'b03', title: '어린 왕자', author: '생텍쥐페리', publisher: '열린책들', goods: 22431294, widthMm: 160, heightMm: 220, pages: 136, spineRatio: 0.16691505216095381, color: '#EDEDED', ribbon: '#F4BD37', ribbonCount: 1),
  (id: 'b04', title: '아몬드', author: '손원평', publisher: '다즐링', goods: 119697570, widthMm: 138, heightMm: 214, pages: 314, spineRatio: 0.17159491343649458, color: '#E7C4C6', ribbon: '#E8C4C6', ribbonCount: 2),
  (id: 'b05', title: '여행의 이유', author: '김영하', publisher: '복복서가', goods: 125905365, widthMm: 128, heightMm: 188, pages: 260, spineRatio: 0.19532612486920126, color: '#039066', ribbon: '#039066', ribbonCount: 2),
  (id: 'b17', title: '불편한 편의점', author: '김호연', publisher: '나무옆의자', goods: 99308021, widthMm: 135, heightMm: 200, pages: 268, spineRatio: 0.18360655737704917, color: '#EDECEB', ribbon: null, ribbonCount: 0),
  (id: 'b06', title: '흰', author: '한강', publisher: '문학동네', goods: 143896198, widthMm: 120, heightMm: 188, pages: 180, spineRatio: 0.19532612486920126, color: '#B0CFE5', ribbon: '#B0CFE4', ribbonCount: 1),
  (id: 'b07', title: '코스모스', author: '칼 세이건', publisher: '사이언스북스', goods: 2312211, widthMm: 153, heightMm: 224, pages: 719, spineRatio: 0.185, color: '#0A0A0A', ribbon: '#855A2D', ribbonCount: 2),
  (id: 'b08', title: '쇼코의 미소', author: '최은영', publisher: '문학동네', goods: 29288225, widthMm: 145, heightMm: 210, pages: 296, spineRatio: 0.17486338797814208, color: '#EDE3EB', ribbon: null, ribbonCount: 0),
  (id: 'b09', title: '82년생 김지영', author: '조남주', publisher: '민음사', goods: 32972572, widthMm: 127, heightMm: 188, pages: 192, spineRatio: 0.19532612486920126, color: '#CDCCD0', ribbon: null, ribbonCount: 0),
  (id: 'b10', title: '채식주의자', author: '한강', publisher: '창비', goods: 108422348, widthMm: 128, heightMm: 194, pages: 276, spineRatio: 0.18928511069798887, color: '#5276B3', ribbon: '#5276B4', ribbonCount: 1),
  (id: 'b18', title: '구의 증명', author: '최진영', publisher: '은행나무', goods: 118578901, widthMm: 128, heightMm: 188, pages: 192, spineRatio: 0.19532612486920126, color: '#91CEAF', ribbon: null, ribbonCount: 0),
  (id: 'b11', title: '아무튼, 서재', author: '김윤관', publisher: '제철소', goods: 51095578, widthMm: 110, heightMm: 178, pages: 140, spineRatio: 0.2062995026708418, color: '#EDECE9', ribbon: null, ribbonCount: 0),
  (id: 'b12', title: '사피엔스', author: '유발 하라리', publisher: '김영사', goods: 23030284, widthMm: 152, heightMm: 215, pages: 636, spineRatio: 0.17079679756004576, color: '#EDECE9', ribbon: null, ribbonCount: 0),
  (id: 'b13', title: '달러구트 꿈 백화점', author: '이미예', publisher: '팩토리나인', goods: 91065309, widthMm: 134, heightMm: 200, pages: 300, spineRatio: 0.18360655737704917, color: '#EDECE6', ribbon: '#8ACED1', ribbonCount: 1),
  (id: 'b14', title: '소년이 온다', author: '한강', publisher: '창비', goods: 13137546, widthMm: 153, heightMm: 224, pages: 216, spineRatio: 0.1639344262295082, color: '#4E4C33', ribbon: '#4E4C33', ribbonCount: 1),
  (id: 'b15', title: '이처럼 사소한 것들', author: '클레어 키건', publisher: '다산책방', goods: 123400303, widthMm: 132, heightMm: 192, pages: 132, spineRatio: 0.19125683060109291, color: '#EDEDEB', ribbon: null, ribbonCount: 0),
  (id: 'b16', title: '우리가 빛의 속도로 갈 수 없다면', author: '김초엽', publisher: '허블', goods: 74261416, widthMm: 130, heightMm: 198, pages: 344, spineRatio: 0.18546116906772644, color: '#EDE9E4', ribbon: '#B7B0D2', ribbonCount: 2),
];

const realSampleShelves = [(id: 'shelf-1', order: 0), (id: 'shelf-2', order: 1), (id: 'shelf-3', order: 2)];

const realSamplePlacements = [
  (bookId: 'b01', shelfId: 'shelf-1', order: 0, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b02', shelfId: 'shelf-1', order: 1, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b03', shelfId: 'shelf-1', order: 2, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b04', shelfId: 'shelf-1', order: 3, pose: 'front', tilt: 0, stackId: null, stackOrder: null, depth: 58.015473762628105, pitch: 12.74, spin: null),
  (bookId: 'b05', shelfId: 'shelf-1', order: 4, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b17', shelfId: 'shelf-1', order: 5, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b06', shelfId: 'shelf-1', order: 6, pose: 'spine', tilt: -7, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b07', shelfId: 'shelf-2', order: 0, pose: 'front', tilt: 0, stackId: null, stackOrder: null, depth: 38.127859244863345, pitch: 13.48, spin: 14),
  (bookId: 'b08', shelfId: 'shelf-2', order: 1, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b09', shelfId: 'shelf-2', order: 2, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b10', shelfId: 'shelf-2', order: 3, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b18', shelfId: 'shelf-2', order: 4, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b11', shelfId: 'shelf-2', order: 5, pose: 'spine', tilt: -7, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b12', shelfId: 'shelf-3', order: 0, pose: 'horizontal', tilt: 0, stackId: 'stack:b12', stackOrder: 0, depth: null, pitch: null, spin: null),
  (bookId: 'b13', shelfId: 'shelf-3', order: 0, pose: 'horizontal', tilt: 0, stackId: 'stack:b12', stackOrder: 1, depth: null, pitch: null, spin: null),
  (bookId: 'b14', shelfId: 'shelf-3', order: 1, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b15', shelfId: 'shelf-3', order: 2, pose: 'spine', tilt: 0, stackId: null, stackOrder: null, depth: null, pitch: null, spin: null),
  (bookId: 'b16', shelfId: 'shelf-3', order: 3, pose: 'front', tilt: 0, stackId: null, stackOrder: null, depth: 48.20324134099498, pitch: 13.51, spin: -14),
];
