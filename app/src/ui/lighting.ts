// 3D 책장의 빛과 재질(장면 입력). 밝기·그림자·어둠·반사광은 모두 이 입력과 3D 형태에서 계산한다(domain/light-model, ui/SceneLight).
// 손으로 정한 진하기·번짐·범위는 두지 않는다.
//
// 빛(2026-10-10 물리 한 규칙, 사용자: '일관되게 적용할 수 있나, 물리법칙 같은 것도'): 모든 물체(책·판·면)에 같은 빛 두 개만 쓴다.
// - 창빛(key): 작은 원반 하나(왼쪽·위 각도, 반지름). 책·판 그림자, 면이 받는 빛·하이라이트를 모두 이 원반으로 계산한다.
// - 방 빛(sky): 위·앞이 밝은 방. 가리개가 가린 만큼 줄어드는 하늘 가림을 모든 곳에 같은 세기(occlusion, 0~1)로 쓴다.
// 그림자 참고 그림(docs/design/그림자 참고.png)의 모습은 이 물리로 설명된다: 책 그림자는 창빛만 가려 옅고 모양이 또렷하며(작은 원반),
// 판 아래는 창빛과 방 빛(판이 위쪽 하늘을 가림)을 함께 가려 더 진하고, 방 빛 가림이 멀어질수록 줄어 길게 옅어진다.
// 그림자 참고에서 잰 값(트인 벽 대비 선형 휘도): 줄 끝 책 오른쪽 0.81(바로 옆) → 0.87(40px) → 0.95(55px) → 1.0(70px),
// 판 아래(화면) 0.75 → 0.77(25px) → 0.81(45px) → 0.83(60px) → 0.89(125px). 화면에서는 판 바로 아래 벽 약 9DU가 판에 가려 보이지 않는다(카메라 3°)
// - 값(빛 측정 틀에서 그림자 참고에 맞춤): 창빛 왼쪽 10°·위 12°·반지름 6°·세기 0.2(방 빛 0.62), 가림 세기 0.3.
//   책 옆 0.79 → 15DU 0.88 → 25DU 1.0(참고 0.81 → 0.87 → 1.0), 판 아래 9DU 0.71 → 25DU 0.74 → 50DU 0.93(참고 0.75 → 0.81 → 0.89),
//   위 판 아래 책 머리/책등 0.73(가림 0.5면 0.56, 0.7이면 0.41: 판 아래 긴 꼬리를 참고만큼 하려면 책 머리가 그만큼 어두워진다)
// - 빛 색: 창빛은 흰빛, 방 빛은 살짝 따뜻하다([1.14, 1, 0.84])
// 세기는 상대값이다. 재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색으로 보고 반사율을 거꾸로 구한다
// (light-model calibrate). 카메라(노출·화이트 밸런스)는 줄 가운데 벽에 맞춘다.
import { colors } from './theme';

export const light = {
  dir: { x: -Math.tan((10 * Math.PI) / 180), y: Math.tan((12 * Math.PI) / 180) * Math.hypot(1, Math.tan((10 * Math.PI) / 180)), z: -1 },
  radius: (6 * Math.PI) / 180,
  ambient: 0.62,
  skyTilt: { x: 0, y: 0.25, z: -0.12 },
  diffuse: 0.2,
  skyColor: [1.14, 1, 0.84] as [number, number, number],
  keyColor: [1, 1, 1] as [number, number, number],
  // 방 빛 하늘 가림 세기(물리 1). 모든 곳에 같은 비율로 쓴다
  occlusion: 0.3,
};

// 카메라(보기 선택, 물리 값이 아니다). exposure: 노출(EV), 기준(재질이 대표 자리에서 시안 색으로 보이는 노출)보다 밝게 +, 어둡게 −.
// 화면 색은 노출 뒤 필름형 톤 곡선(light-model tone): 화면 밝기가 shoulder를 넘으면 1로 부드럽게 다가가고(하이라이트를 누른다),
// toe 아래는 검정 쪽 기울기를 1 − toeK로 눌러 아주 어두운 곳이 조금 더 깊다. 어깨는 약하게(위 15%만): 더 내리면 시안의 거의 흰 장정 색이
// 반사율 1을 넘는다(0.81 아래)
export const camera = { exposure: 0, shoulder: 0.85, toe: 0.18, toeK: 0.15 };

// 재질(모든 면이 같은 규칙). 종이·면 섬유·도료·나무 마감은 모두 유전체(굴절률 약 1.5)라 수직 반사율 F0가 같고, 다른 것은 표면뿐이다.
// - roughness: 화소보다 훨씬 작은 요철의 거칠기(GGX 지각 거칠기 r, α = r²). 창빛이 보는 사람 뒤(정면에서 15°)라 모든 앞면이 거울 방향 가까이에 있어
//   앞면 반사광 = F0·D(0)·π/4 × 창빛(D(0) = 1/(π α²))이 그대로 보인다. 시안 표지·책등엔 창 비침이 없으니 모두 무광 재질의 범위로 둔다
//   (반사광이 재질 색보다 밝으면 그 색은 물리적으로 못 낸다: 맞추기 SREF)
// - bump: 화소 크기 안팎의 미세 높이(법선 무늬). size = 요철 크기 mm(면 가로, 세로), slope = 기울기 RMS, weave = 천 올(주기 무늬).
//   화면에서 2px보다 작은 요철은 법선 무늬로 그릴 수 없어 거칠기에 더한다(Toksvig: α² += 2·slope²): 멀리서는 결이 광택을 흐리게 하고
//   가까이서는 결로 보인다. 창빛 하이라이트는 광원 원반 크기만큼 넓어진다(α² += (반지름/2)²)
// - grain: 반사율 무늬(빛 계산 안에서 반사율에 곱한다: 그림자 속에선 함께 어두워지고, 평균은 1이라 재질 색은 그대로).
//   kind별로 두 크기 size(mm)와 세기 contrast: fiber = 섬유 점(작은 쪽)·뭉침(큰 쪽), weave = 올 주기·굵기 고르지 않음, sheets = 종이 묶음 결·접장 간격
//   (묶음 결: 몇 장씩 끝이 조금 어긋나 밝기가 다른 가는 결, 종이 가장자리 길이로 길게 이어진다. 접장 사이 틈은 낱장 1.5장 폭 0.15mm, 세기 = 그 틈의 어두움),
//   wood = 나이테 간격(늦재 띠)·색 얼룩, none = 고르다.
// 무늬도 화소 2개보다 작아지면 그 화소의 평균(1)으로 줄인다(가는 선은 화소 안 넓이 비로). 세기는 가장 밝은 장정 색에 곱해도 반사율이 1을 넘지 않게
export const F0 = 0.04;
export type Bump = { size: [number, number]; slope: number; weave?: boolean };
export type Grain = { kind: 'fiber' | 'weave' | 'sheets' | 'wood' | 'none'; size: [number, number]; contrast: [number, number] };
export type SurfaceMaterial = { roughness: number; bump: Bump | null; grain: Grain };
const NONE: Grain = { kind: 'none', size: [1, 1], contrast: [0, 0] };
export const materials = {
  // 무광 종이(코팅 없는 종이, 거의 완전 확산면): 장정 기본·갈피 종이. 섬유 뭉침(약 1.5mm)의 아주 얕은 굴곡
  paper: { roughness: 0.9, bump: { size: [1.5, 1.5], slope: 0.02 }, grain: { kind: 'fiber', size: [0.6, 3], contrast: [0.015, 0.01] } },
  // 장정 천: 올(약 0.5mm 주기)이 높낮이를 만든다. 홈 화면에선 화소보다 작아 거칠기로 들어간다
  cloth: { roughness: 0.75, bump: { size: [0.5, 0.5], slope: 0.3, weave: true }, grain: { kind: 'weave', size: [0.5, 2], contrast: [0.02, 0.008] } },
  // 코팅지: 표지에 흔한 무광 코팅 막(종이보다 매끈해 비스듬한 반사·창빛 하이라이트가 더 크다. 유광 막(r 0.2~0.3)이면 창이 비친다)
  coated: { roughness: 0.7, bump: null, grain: NONE },
  // 속지 단면: 낱장(약 0.1mm) 가장자리가 쌓인 면이라 두께 방향으로 촘촘한 굴곡(재단면이라 종이 면보다 거칠다).
  // 낱장 하나는 화면에서 화소보다 훨씬 가늘어 보이지 않으므로, 결은 몇 장씩 끝이 어긋난 묶음(약 1mm)과 접장 틈(1.6mm마다)으로 보인다
  // (2026-10-10 사용자: 흰 속지가 너무 매끄러워 벽돌 같다, 페이지 티가 나게)
  pages: { roughness: 0.9, bump: { size: [0.15, 40], slope: 0.15 }, grain: { kind: 'sheets', size: [1, 1.6], contrast: [0.12, 0.45] } },
  // 선반 판: 무광 마감(오일·무광 래커)한 결 대비가 낮은 밝은 나무(자작·단풍류: 늦재 띠가 2% 안팎만 짙다. 시안 판 앞면은 결이 거의 안 보인다,
  // 고역 표준편차 0.5단계). 결 방향(판 길이)으로 길게 늘어난 굴곡
  wood: { roughness: 0.7, bump: { size: [30, 0.8], slope: 0.02 }, grain: { kind: 'wood', size: [3.5, 60], contrast: [0.02, 0.005] } },
  // 벽: 무광 수성 페인트(평광)
  paint: { roughness: 0.9, bump: { size: [1, 1], slope: 0.01 }, grain: NONE },
} satisfies Record<string, SurfaceMaterial>;
export type MaterialName = keyof typeof materials;

// 장면 면의 재질 색(반사율은 선형 RGB, light-model linearOf): 선반 판(시안 판 앞면), 벽(화면 바탕), 책 속지(시안 책 머리의 속지 약 (253, 243, 226))
export const surfaces = { plank: '#F2DCC1', wall: colors.wall, paper: '#FBF2E2' };
// 반사율 상한(물리): 실제 흰 재질(흰 종이·크림색 벽 페인트)의 반사율은 0.7~0.85다. 맞추기(light-model setAlbedo)는 어느 재질의 반사율도
// 이 값을 넘지 않게 카메라 이득을 정한다. 1에 가깝게 두면 벽·판·책 사이에서 여러 번 튄 빛이 너무 세서 그늘이 크림 벽·연어색 책의 색으로
// 짙게 물든다(판 아래 R이 G보다 8%, 연어색 책 옆 17% 넘쳤다). 범위의 아래쪽 0.7: 0.8이면 그늘 붉은기(Lab a*)가 3~4.4로 그림자 참고 그림(1.2~2.1)의 두 배
export const ALBEDO_MAX = 0.7;

// 그림자 흐림(반그림자): 가리개에서 빛 길이 t만큼 떨어진 곳의 반그림자 폭 = 2·tan(반지름)·t(창빛 원반 그대로).
// 연속 흐림을 빛 길이 구간(bands)으로 나눠 구간마다 가운데 거리로 번지게 그린다. 첫 구간은 반그림자가 1DU가 되는 거리,
// 다음 구간은 그 3배씩(구간 안 흐림 차이가 3배 이내 = 해상도)
const SPREAD = 2 * Math.tan(light.radius);
export const physShadow = { spread: SPREAD, bands: [1, 3, 9, 27].map((k) => k / SPREAD).concat([Infinity]) };
