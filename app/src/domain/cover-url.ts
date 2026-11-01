// 실제 표지·책등 주소(YES24 도서 이미지). 같은 상품 번호에 크기만 다르다: 앞표지 L 약 240~320×400, XL 약 3배. 책등 sideCover는 표지 주소에 /SIDE를 넣은 주소
// (점검한 응답 5,262건 모두 이 규칙, 이미 저장한 책도 서버를 바꾸지 않고 쓸 수 있다). 약관상 출처는 책 추가·책 정보에 YES24로 표시한다.
// 검색에서 받은 주소(보통 L)를 저장해 두고, 크게 그릴 때만 XL로 바꿔 받는다(책장 수십 권의 앞표지를 모두 XL로 들면 메모리가 크다).
// YES24가 아닌 주소(내가 찍은 사진·다른 제공처)는 크기를 바꾸지 않고 책등도 없다.
const YES24 = /^(https:\/\/image\.yes24\.com\/goods\/\d+)\/(?:S|M|L|XL)$/;

export function coverAtSize(uri: string | undefined, size: 'L' | 'XL'): string | undefined {
  if (!uri) return uri;
  const m = YES24.exec(uri);
  return m ? `${m[1]}/${size}` : uri;
}

export function spineOfCover(uri: string | undefined, size: 'L' | 'XL'): string | undefined {
  const m = uri ? YES24.exec(uri) : null;
  return m ? `${m[1]}/SIDE/${size}` : undefined;
}

// 책등 그림 판별: 진짜 책등은 좁고 길다(표본 27권 폭/높이 0.02~0.16). 책등이 없는 책은 '이미지 준비중' 대체 그림(280×400, HTTP 200)이 온다.
// 그 비율을 두께로 읽지 않는다
export const isSpineImage = (width: number, height: number) => height > 0 && width / height < 0.3;

// 책등 사진 비율(폭/높이)을 재 둔 값: 그림은 책등에 쓰지 않고 실제 두께만 읽는다(2026-11-01 사용자가 책등은 표지 색으로 정함). 0 = 책등 사진이 없음, 없음(undefined) = 아직 못 쟀다(둘 다 쪽수 두께).
// 판본 데이터가 아니라 공개 그림에서 다시 잴 수 있는 값이라 기기에만 둔다(store/spine-ratio-store)
const spineRatios = new Map<string, number>();
const goodsOf = (uri: string | undefined) => (uri ? YES24.exec(uri)?.[1] : undefined);
export function spineRatioOf(coverUri: string | undefined): number | undefined {
  const g = goodsOf(coverUri);
  return g ? spineRatios.get(g) : undefined;
}
export function rememberSpineRatio(coverUri: string, ratio: number) {
  const g = goodsOf(coverUri);
  if (g) spineRatios.set(g, ratio);
}
export const spineRatioEntries = () => [...spineRatios.entries()];
export function loadSpineRatioEntries(entries: [string, number][]) {
  for (const [k, v] of entries) spineRatios.set(k, v);
}
export const needsSpineRatio = (coverUri: string | undefined) => !!goodsOf(coverUri) && spineRatioOf(coverUri) === undefined;

