// 3D 책장의 빛과 재질(장면 입력). 밝기·그림자·어둠·반사광은 모두 이 입력과 3D 형태에서 계산한다(domain/light-model, ui/SceneLight).
// 손으로 정한 진하기·번짐·범위는 두지 않는다.
//
// 빛(2026-10-08 시안 docs/design/따뜻한 플랫 일러스트 책장.png와 사용자 의견에 맞춰 고름: '선반 그림자가 안 보인다', '칸마다 색 배경이 다르다',
// '그림자를 좀 연하고 회색 계열로, 넓게 퍼지는 각도로'): 맑은 날 보는 사람 뒤 큰 창에서 드는 빛. 창으로 직접 드는 햇빛과 창으로 보이는 하늘빛.
// - 창빛(key, 직접 드는 빛): 정면(가로 0°: 시안의 책 옆 벽 그늘은 책 양쪽에 옅게만 있다), 조금 위(2°)의 큰 둥근 면광원, 반지름 10°(큰 창).
//   판 앞 모서리가 원반 위쪽을 가려 판 아래 벽에 30~40DU에 걸친 넓고 부드러운 그늘이 진다(판 바로 아래 0.63 → 20DU 0.85 → 30DU 0.93).
//   창을 더 높이면(5°) 판 바로 아래에서 원반을 80%까지 가려 그늘이 짙어진다. 반지름을 더 키우면(14°) 책 그림자를 빛 길이
//   구간(physShadow.bands, 3배 간격)으로 나눈 근사의 구간 경계가 책 깊이 안(54DU)으로 들어와 책을 밀 때 그림자 진하기가 한 번에 바뀐다
//   거의 수평 0.5°·반지름 4°면 4DU 안에서 끝나 판 아래가 선 하나로 보였다. 판 바로 아래가 0.8보다 옅은 것은 이 기하에서는 어떤 빛으로도
//   안 된다(위 판이 하늘 절반과 원반 위쪽을 막는다)
// - 하늘빛·방 확산광: 환경 밝기가 방향에 따라 L(ω) ∝ ambient + 1.5·skyUp·ω.y + 1.5·skyFront·(−ω.z)로 바뀌는 하늘(면이 받는 빛 = 그 코사인 적분
//   ambient + skyUp·n.y − skyFront·n.z). 창빛이 닿지 않는 곳의 밝기는 이 몫이라 키울수록 그늘이 옅다(0.55). 다만 칸 안까지 곧장 들어오는 것은
//   정면 창빛뿐이라 이 몫이 클수록 판·책에 가린 칸 안 벽이 트인 벽보다 어둡다(책 찬 칸 책 위 벽 / 트인 벽: 0.3이면 0.91 / 1.03, 0.55면 0.71 / 1.16). 앞쪽이 밝은 방(skyFront)은 넓게 퍼진 빛이라 오히려 나빠 0
// - 빛 색(skyColor·keyColor, 선형 RGB 배수, 휘도 1로 맞춤): 직접 드는 햇빛은 살짝 따뜻하고 하늘빛은 푸르다(맑은 날 실내). 크림 벽·베이지 판에서
//   튄 빛이 그늘을 따뜻하게 물들이는 것을(흰빛이면 판 아래 그늘 R/G 1.08·B/G 0.95) 푸른 하늘빛이 상쇄해 그늘이 회색 쪽이다(1.03·1.02).
//   거꾸로(차가운 창빛·따뜻한 방 빛) 두면 방 빛이 가린 칸 안 벽이 보랏빛 회색이 되어 칸마다 바탕이 갈렸다. 맞추기가 재질 색을 대표 자리 빛에
//   맞추므로 화이트 밸런스로는 이 색 갈림을 못 지운다
// 세기는 상대값이다. 재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색으로 보고 반사율을 거꾸로 구한다
// (light-model calibrate). 카메라(노출·화이트 밸런스)는 줄 가운데 벽에 맞춘다.
import { colors } from './theme';

export const light = {
  dir: { x: 0, y: Math.tan((2 * Math.PI) / 180), z: -1 },
  radius: (10 * Math.PI) / 180,
  ambient: 0.55,
  skyUp: 0.03,
  skyFront: 0,
  diffuse: 0.42,
  skyColor: [0.78, 1, 1.35] as [number, number, number],
  keyColor: [1.06, 1, 0.9] as [number, number, number],
};

// 카메라(보기 선택, 물리 값이 아니다). exposure: 노출(EV), 기준(재질이 대표 자리에서 시안 색으로 보이는 노출)보다 밝게 +, 어둡게 −.
// 화면 색은 노출 뒤 필름형 톤 곡선(light-model tone): 화면 밝기가 shoulder를 넘으면 1로 부드럽게 다가가고(하이라이트를 누른다),
// toe 아래는 검정 쪽 기울기를 1 − toeK로 눌러 아주 어두운 곳이 조금 더 깊다. 어깨는 약하게(위 15%만): 더 내리면 시안의 거의 흰 장정 색이
// 반사율 1을 넘는다(0.81 아래)
export const camera = { exposure: 0, shoulder: 0.85, toe: 0.18, toeK: 0.15 };

// 재질(모든 면이 같은 규칙). 종이·면 섬유·도료·나무 마감은 모두 유전체(굴절률 약 1.5)라 수직 반사율 F0가 같고, 다른 것은 표면뿐이다.
// - roughness: 화소보다 훨씬 작은 요철의 거칠기(GGX 지각 거칠기 r, α = r²). 창빛이 보는 사람 바로 뒤라 모든 앞면이 거울 방향 가운데에 있어
//   앞면 반사광 = F0·D(0)·π/4 × 창빛(D(0) = 1/(π α²))이 그대로 보인다. 시안 표지·책등엔 창 비침이 없으니 모두 무광 재질의 범위로 둔다
//   (반사광이 재질 색보다 밝으면 그 색은 물리적으로 못 낸다: 맞추기 SREF)
// - bump: 화소 크기 안팎의 미세 높이(법선 무늬). size = 요철 크기 mm(면 가로, 세로), slope = 기울기 RMS, weave = 천 올(주기 무늬).
//   화면에서 2px보다 작은 요철은 법선 무늬로 그릴 수 없어 거칠기에 더한다(Toksvig: α² += 2·slope²): 멀리서는 결이 광택을 흐리게 하고
//   가까이서는 결로 보인다. 창빛 하이라이트는 광원 원반 크기만큼 넓어진다(α² += (반지름/2)²)
// - grain: 반사율 무늬(빛 계산 안에서 반사율에 곱한다: 그림자 속에선 함께 어두워지고, 평균은 1이라 재질 색은 그대로).
//   kind별로 두 크기 size(mm)와 세기 contrast: fiber = 섬유 점(작은 쪽)·뭉침(큰 쪽), weave = 올 주기·굵기 고르지 않음, sheets = 낱장 두께·접장 간격
//   (접장 사이 틈은 낱장 1.5장 폭, 세기 = 그 틈의 어두움), wood = 나이테 간격(늦재 띠)·색 얼룩, none = 고르다.
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
  // 속지 단면: 낱장(약 0.1mm) 가장자리가 쌓인 면이라 두께 방향으로 촘촘한 굴곡(재단면이라 종이 면보다 거칠다)
  pages: { roughness: 0.9, bump: { size: [0.15, 40], slope: 0.15 }, grain: { kind: 'sheets', size: [0.1, 1.6], contrast: [0.04, 0.25] } },
  // 선반 판: 무광 마감(오일·무광 래커)한 결 대비가 낮은 밝은 나무(자작·단풍류: 늦재 띠가 2% 안팎만 짙다. 시안 판 앞면은 결이 거의 안 보인다,
  // 고역 표준편차 0.5단계). 결 방향(판 길이)으로 길게 늘어난 굴곡
  wood: { roughness: 0.7, bump: { size: [30, 0.8], slope: 0.02 }, grain: { kind: 'wood', size: [3.5, 60], contrast: [0.02, 0.005] } },
  // 벽: 무광 수성 페인트(평광)
  paint: { roughness: 0.9, bump: { size: [1, 1], slope: 0.01 }, grain: NONE },
} satisfies Record<string, SurfaceMaterial>;
export type MaterialName = keyof typeof materials;

// 장면 면의 재질 색(반사율은 선형 RGB, light-model linearOf): 선반 판(시안 판 앞면), 벽(화면 바탕), 책 속지(시안 책 머리의 속지 약 (253, 243, 226))
export const surfaces = { plank: '#F2DCC1', wall: colors.wall, paper: '#FBF2E2' };

// 그림자 흐림(반그림자): 가리개에서 빛 길이 t만큼 떨어진 곳의 반그림자 폭 = 2·tan(반지름)·t.
// 연속 흐림을 빛 길이 구간(bands)으로 나눠 구간마다 가운데 거리로 번지게 그린다. 첫 구간은 반그림자가 1DU가 되는 거리,
// 다음 구간은 그 3배씩(구간 안 흐림 차이가 3배 이내 = 해상도).
const SPREAD = 2 * Math.tan(light.radius);
export const physShadow = { spread: SPREAD, bands: [1, 3, 9, 27].map((k) => k / SPREAD).concat([Infinity]) };
