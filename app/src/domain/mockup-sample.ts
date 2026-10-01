// 측정 번들 전용 비교 책장(시안 책장): 시안 '따뜻한 플랫 일러스트 책장'과 같은 제목·책 색·갈피·표지 그림으로 예시 18권 자리를 채운다.
// 판형(치수)·배치·자세·기대기는 예시 책장(SAMPLE_BOOKS·SAMPLE_LAYOUT)과 같다(카메라·선반 간격·책 치수·배치 규칙 그대로).
// 메모리에만 쓰고 저장하지 않는다(placementStore.setDemo('mockup')). 사용자 서재·온보딩 예시와 섞지 않는다.
// 표지 그림 세 장은 시안의 표지 구성을 재서 새로 그린 평면 그림이다(app/scripts/flat-covers/make-covers.py).
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from './onboarding-sample';
import type { Book, ShelfLayout } from './types';

type CoverArt = NonNullable<Book['cover']>;
type Slot = { title: string; color: string; ribbon?: string; cover?: CoverArt };

// 책 색은 시안 책등(표지 책은 판 가장자리)에서 글자·장식을 뺀 면의 중앙값, 갈피 색은 시안 갈피 끈의 색.
// 표지 그림의 titleTop은 시안 표지의 제목 자리(제목 칸 위 끝, 표지 높이 비율), ink는 시안 제목 색(참고값).
const SLOTS: Record<string, Slot> = {
  b01: { title: '모순', color: '#FDF0E0' },
  b02: { title: '데미안', color: '#647361' },
  b03: { title: '어린 왕자', color: '#FBD392', ribbon: '#929778' },
  b04: {
    title: '느린 계절',
    color: '#475B7A',
    cover: { image: require('../../assets/covers/slow-season.png'), titleTop: 0.145, ink: '#F3E2BF', edge: '#475B7A' },
  },
  b05: { title: '문장 수집', color: '#CE886F' },
  b17: { title: '느린 하루', color: '#8DA5B9', ribbon: '#EFC591' },
  b06: { title: '흰', color: '#FDF0DF' },
  b07: {
    title: '여름의 숲',
    color: '#E6D6BC',
    cover: { image: require('../../assets/covers/summer-forest.png'), titleTop: 0.3, ink: '#473C39', edge: '#E6D6BC' },
  },
  b08: { title: '여행의 이유', color: '#819AB1' },
  b09: { title: '작은 것들의 기쁨', color: '#FDECD4', ribbon: '#ECA676' },
  b10: { title: '사람의 마음이란', color: '#475A78' },
  b18: { title: '아주 보통의 하루', color: '#A7AF95' },
  b11: { title: '너라는 계절', color: '#F0BDA0' },
  b12: { title: '찰나의 마음', color: '#F3B497' },
  b13: { title: '좋은 문장은 이렇게 온다', color: '#F8E6CF' },
  b14: { title: '고요한 우연', color: '#8F5654' },
  b15: { title: '아무튼, 독서', color: '#FDECD5', ribbon: '#8C9474' },
  b16: {
    title: '우리가 빛의 속도로 갈 수 없다면',
    color: '#F4BFA2',
    cover: { image: require('../../assets/covers/light-speed.png'), titleTop: 0.11, ink: '#4C433B', edge: '#F4BFA2' },
  },
};

function toMockup(b: Book): Book {
  const s = SLOTS[b.id];
  if (!s) return b;
  return {
    id: b.id,
    title: s.title,
    themeColor: s.color,
    heightClass: b.heightClass,
    thicknessClass: b.thicknessClass,
    coverAspectRatio: b.coverAspectRatio,
    physical: b.physical,
    // 책등은 제목만(장식 그림 없음). 갈피는 시안에서 끈이 보이는 책만.
    art: { motif: 'none', ribbon: s.ribbon },
    quotes: s.ribbon ? 1 : 0,
    cover: s.cover,
  };
}

export const MOCKUP_BOOKS: Book[] = SAMPLE_BOOKS.map(toMockup);
export const MOCKUP_LAYOUT: ShelfLayout = SAMPLE_LAYOUT;
