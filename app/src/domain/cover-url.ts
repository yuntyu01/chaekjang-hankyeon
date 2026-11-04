// 실제 표지·책등 주소(YES24 도서 이미지). 같은 상품 번호에 크기만 다르다: 앞표지 M 약 141×220, L 약 240~320×400, XL 약 3배. 책등 sideCover는 표지 주소에 /SIDE를 넣은 주소
// (점검한 응답 5,262건 모두 이 규칙, 이미 저장한 책도 서버를 바꾸지 않고 쓸 수 있다). 약관상 출처는 책 추가·책 정보에 YES24로 표시한다.
// 검색에서 받은 주소(보통 L)를 저장해 두고, 크게 그릴 때만 XL로 바꿔 받는다(책장 수십 권의 앞표지를 모두 XL로 들면 메모리가 크다).
// YES24가 아닌 주소(내가 찍은 사진·다른 제공처)는 크기를 바꾸지 않고 책등도 없다.
const YES24 = /^(https:\/\/image\.yes24\.com\/goods\/\d+)\/(?:S|M|L|XL)$/;

export function coverAtSize(uri: string | undefined, size: 'M' | 'L' | 'XL'): string | undefined {
  if (!uri) return uri;
  const m = YES24.exec(uri);
  return m ? `${m[1]}/${size}` : uri;
}

// 표지가 보이는 책(책장에서 표지로 세운 책)의 큰 표지: 글씨까지 원래대로 또렷하게(2026-11-02 사용자 '원래 색·그림·글씨를 유지'). 앞표지 L은 책장에 그릴 크기보다 작다.
// 책등으로 꽂힌 책은 표지가 보이지 않으니 작은 그림 그대로. 같은 책에는 같은 사본을 돌려준다(책 그림 기록이 객체가 같은지로 다시 그릴지 정한다)
const sharpCopies = new WeakMap<object, object>();
export function withSharpCover<B extends { coverArtUri?: string }>(book: B): B {
  const uri = coverAtSize(book.coverArtUri, 'XL');
  if (uri === book.coverArtUri) return book;
  const hit = sharpCopies.get(book) as B | undefined;
  if (hit) return hit;
  const copy = { ...book, coverArtUri: uri };
  sharpCopies.set(book, copy);
  return copy;
}

export function spineOfCover(uri: string | undefined, size: 'L' | 'XL'): string | undefined {
  const m = uri ? YES24.exec(uri) : null;
  return m ? `${m[1]}/SIDE/${size}` : undefined;
}

// 표지 그림 바깥의 흰 여백: 판매처 그림 중에 표지 둘레에 흰 여백을 둔 것이 있어(표본 19권 중 쇼코의 미소, 변마다 2.5~5%) 그대로 입히면 책에 흰 테두리가 생긴다.
// 네 변 모두 거의 흰 띠가 있고 그 폭이 좁을 때만 여백으로 본다: 표지가 원래 흰색이면 띠가 없는 변이 있거나 폭이 넓다(어린 왕자 위 16%·아무튼, 서재 왼쪽 0). 변마다 잘라 낼 비율, 여백이 아니면 null
const NEAR_WHITE = 245;
const MAT_MIN = 0.01;
const MAT_MAX = 0.07;
const MAT_LINES = [0.2, 0.35, 0.5, 0.65, 0.8];
export type CoverMat = { l: number; t: number; r: number; b: number };
export function whiteMat(width: number, height: number, read: (x: number, y: number, w: number, h: number) => ArrayLike<number> | null): CoverMat | null {
  const white = (px: ArrayLike<number>, i: number) => px[i * 4] >= NEAR_WHITE && px[i * 4 + 1] >= NEAR_WHITE && px[i * 4 + 2] >= NEAR_WHITE;
  // 한 줄(길이 n)의 양 끝에서 흰 띠가 몇 칸인지
  const ends = (px: ArrayLike<number>, n: number): [number, number] => {
    let a = 0;
    while (a < n && white(px, a)) a++;
    let b = 0;
    while (b < n && white(px, n - 1 - b)) b++;
    return [a, b];
  };
  const band = [Infinity, Infinity, Infinity, Infinity]; // 왼쪽, 오른쪽, 위, 아래: 여러 줄 중 가장 좁은 값
  for (const f of MAT_LINES) {
    const row = read(0, Math.floor(height * f), width, 1);
    const col = read(Math.floor(width * f), 0, 1, height);
    if (!row || !col) return null;
    const [l, r] = ends(row, width);
    const [t, b] = ends(col, height);
    band[0] = Math.min(band[0], l);
    band[1] = Math.min(band[1], r);
    band[2] = Math.min(band[2], t);
    band[3] = Math.min(band[3], b);
  }
  const [l, r, t, b] = [band[0] / width, band[1] / width, band[2] / height, band[3] / height];
  if (Math.min(l, r, t, b) < MAT_MIN || Math.max(l, r, t, b) > MAT_MAX) return null;
  return { l, t, r, b };
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

// 표지에서 뽑은 갈피 색(rebinding accentColorOf): ''는 고를 색이 없는 표지, 없음(undefined)은 아직 못 쟀다. 공개 그림에서 다시 잴 수 있어 기기에만 둔다(store/cover-accent-store)
const coverAccents = new Map<string, string>();
export function coverAccentOf(coverUri: string | undefined): string | undefined {
  const g = goodsOf(coverUri);
  return g ? coverAccents.get(g) : undefined;
}
export function rememberCoverAccent(coverUri: string | undefined, accent: string) {
  const g = goodsOf(coverUri);
  if (g) coverAccents.set(g, accent);
}
export const coverAccentEntries = () => [...coverAccents.entries()];
export function loadCoverAccentEntries(entries: [string, string][]) {
  for (const [k, v] of entries) coverAccents.set(k, v);
}
export const needsCoverAccent = (coverUri: string | undefined) => !!goodsOf(coverUri) && coverAccentOf(coverUri) === undefined;

