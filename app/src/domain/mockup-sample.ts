// 측정 번들 전용 비교 책장(시안 책장): 시안 '따뜻한 플랫 일러스트 책장'과 같은 제목·책 색·갈피·표지 그림으로 예시 18권 자리를 채운다.
// 판형(치수)·배치·자세·기대기는 예시 책장(SAMPLE_BOOKS·SAMPLE_LAYOUT)과 같다(카메라·선반 간격·책 치수·배치 규칙 그대로).
// 메모리에만 쓰고 저장하지 않는다(placementStore.setDemo('mockup')). 사용자 서재·온보딩 예시와 섞지 않는다.
// 표지 그림 세 장은 제공받은 원본 시안을 면 좌표로 직접 참조한다.
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from './onboarding-sample';
import { LANDSCAPES } from './book-design';
import type { BindingMaterial, Book, ShelfLayout } from './types';

type CoverArt = NonNullable<Book['cover']>;
// marks: 보이는 갈피 장 수(2026-10-07 사용자 참고 사진). ribbon: 갈피 색(크림 책처럼 책 색으로 정하기 어려울 때 쓰는 색)
// material: 장정 재질(그림 표지 세 권은 코팅지, 데미안·사람의 마음이란·고요한 우연은 천, 나머지는 무광 종이)
type Slot = { title: string; color: string; ribbon?: string; marks?: number; cover?: CoverArt; material?: BindingMaterial };

// 책 색은 시안 책등(표지 책은 판 가장자리)에서 글자·장식을 뺀 면의 중앙값, 갈피 색은 시안 갈피 끈의 색.
// 표지 그림의 titleTop은 시안 표지의 제목 자리(제목 칸 위 끝, 표지 높이 비율), ink는 시안 제목 색(참고값).
const SLOTS: Record<string, Slot> = {
  b01: { title: '모순', color: '#FDF0E0' },
  b02: { title: '데미안', color: '#5E6D5B', ribbon: '#98AC9E', marks: 2, material: 'cloth' },
  b03: { title: '어린 왕자', color: '#FBD392', ribbon: '#E9A562', marks: 1 },
  b04: {
    title: '느린 계절',
    color: '#475B7A',
    ribbon: '#7D9CC4',
    marks: 2,
    cover: LANDSCAPES.night,
    material: 'coated',
  },
  b05: { title: '문장 수집', color: '#CE886F', ribbon: '#D98A7C', marks: 2 },
  b17: { title: '느린 하루', color: '#88A4BA' },
  b06: { title: '흰', color: '#FDF0DF' },
  b07: {
    title: '여름의 숲',
    color: '#E6D6BC',
    cover: LANDSCAPES.forest,
    material: 'coated',
  },
  b08: { title: '여행의 이유', color: '#819AB1', ribbon: '#8EAAD0', marks: 2 },
  b09: { title: '작은 것들의 기쁨', color: '#FDECD4' },
  b10: { title: '사람의 마음이란', color: '#3E5374', material: 'cloth' },
  b18: { title: '아주 보통의 하루', color: '#A7AF95' },
  b11: { title: '너라는 계절', color: '#F0BDA0', ribbon: '#E9A070', marks: 1 },
  b12: { title: '찰나의 마음', color: '#F3B497' },
  b13: { title: '좋은 문장은 이렇게 온다', color: '#F8E6CF' },
  b14: { title: '고요한 우연', color: '#8D4F4E', material: 'cloth' },
  b15: { title: '아무튼, 독서', color: '#FDECD5' },
  b16: {
    title: '우리가 빛의 속도로 갈 수 없다면',
    color: '#F4BFA2',
    cover: LANDSCAPES.sunset,
    material: 'coated',
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
    dims: b.dims,
    // 시안의 꽃·잎·달 장식과 실제로 보이는 갈피를 재현한다.
    art: {
      motif: ({ b01: 'blossom', b02: 'asterisk', b03: 'star-solid', b04: 'moon', b05: 'sprig', b17: 'cloud', b06: 'daisy', b08: 'wave', b09: 'sprig', b10: 'moon', b18: 'seedling', b11: 'blossom', b12: 'seedling', b13: 'feather', b14: 'seedling', b15: 'book' } as Record<string, string>)[b.id] ?? 'none',
      accentColor: ({ b02: '#F6DB8C', b03: '#DCA64E', b05: '#F7E2B6', b17: '#F9EDDA', b08: '#F8EACF', b10: '#F8DEA3', b18: '#F8EACF', b12: '#FFF0D5', b14: '#F8E3B7', b15: '#C6A67B' } as Record<string, string>)[b.id],
      ribbon: s.ribbon,
      ribbonCount: s.marks,
      titleTop: ({ b01: 0.25, b02: 0.24, b03: 0.22, b05: 0.21, b17: 0.18, b06: 0.322, b08: 0.245, b09: 0.175, b10: 0.155, b18: 0.195, b11: 0.215, b14: 0.205, b15: 0.24 } as Record<string, number>)[b.id],
      motifScale: ({ b01: 1.15, b05: 0.9, b11: 0.76, b13: 1.3 } as Record<string, number>)[b.id],
      motifBottom: ({ b01: 0.875, b05: 0.91, b11: 0.89 } as Record<string, number>)[b.id],
      plainCover: b.id === 'b12' || b.id === 'b13',
      material: s.material,
    },
    quotes: s.marks ?? (s.ribbon ? 1 : 0),
    cover: s.cover,
  };
}

export const MOCKUP_BOOKS: Book[] = SAMPLE_BOOKS.map(toMockup);
// 시안은 가운데 정렬이 아니다. 각 책 바닥의 왼쪽 위치를 390DU로 환산한다(줄 왼쪽 끝 책 자리는 시안 그대로).
// 나란히 선 책끼리는 붙인다(그림자 참고 그림처럼): 처음 시안에서 잰 책 사이 1~3DU 틈은 깊이 150mm 책 사이 2~4mm 틈이라
// 빛이 들지 않아 검은 선이 된다. 기대는 책 자리(쐐기)와 표지 옆 넓은 틈(5DU)은 두고 그 오른쪽은 닫은 만큼 왼쪽으로 옮겼다.
// 기대는 책(흰 b06, 너라는 계절 b11)은 버틸 수 있는 각(넘어짐 한계 + 여유, domain/statics.ts: 12.1°·13.4°)으로 기대도록 틈을 둔다
// (시안의 7~8°는 이 두께에서는 무게중심이 바닥 모서리 안쪽이라 다시 서는 각이다).
const REFERENCE_X: Record<string, number> = {
  b01: 15.8, b02: 42.8, b03: 77.6, b04: 114.4,
  b05: 232.4, b17: 265.2, b06: 334.2,
  b07: 18.5, b08: 156.5, b09: 187.3, b10: 218.1,
  b18: 261.9, b11: 332.6,
  b12: 4.9, b13: 4.9, b14: 165.9, b15: 198.3, b16: 230.8,
};
export const MOCKUP_LAYOUT: ShelfLayout = {
  ...SAMPLE_LAYOUT,
  placements: SAMPLE_LAYOUT.placements.map((p) => ({ ...p, pos: REFERENCE_X[p.bookId] })),
};
