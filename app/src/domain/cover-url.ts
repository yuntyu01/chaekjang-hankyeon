// 실제 표지 주소(YES24 도서 이미지 크기 고르기). YES24 표지는 같은 상품 번호에 크기만 다르다: M 129×220, L 236×400, XL 708×1200.
// 검색에서 받은 주소(보통 L)를 저장해 두고, 크게 그릴 때만 XL로 바꿔 받는다(책장 수십 권을 모두 XL로 들면 메모리가 크다).
// YES24가 아닌 주소(내가 찍은 사진·다른 제공처)는 그대로.
const YES24 = /^(https:\/\/image\.yes24\.com\/goods\/\d+)\/(?:S|M|L|XL)$/;

export function coverAtSize(uri: string | undefined, size: 'L' | 'XL'): string | undefined {
  if (!uri) return uri;
  const m = YES24.exec(uri);
  return m ? `${m[1]}/${size}` : uri;
}
