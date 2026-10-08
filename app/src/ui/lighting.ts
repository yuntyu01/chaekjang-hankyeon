// 3D 책장의 빛과 재질(장면 입력). 밝기·그림자·어둠·반사광은 모두 이 입력과 3D 형태에서 계산한다(domain/light-model, ui/SceneLight).
// 손으로 정한 진하기·번짐·범위는 두지 않는다.
//
// 빛(2026-10-08 사용자: '물리법칙을 지키고, 같은 것엔 같은 규칙, 그림자 느낌은 docs/design/그림자 참고.png처럼'):
// 보는 사람 뒤 왼쪽의 큰 창. 그림자 참고 그림은 책 왼쪽엔 그늘이 없고 오른쪽 아래로만 옅은 그림자가 넓게 번진다(책 오른쪽 바로 옆 0.72~0.80 → 20DU 0.86,
// 판 아래 0.66~0.77 → 25DU 0.87, 그늘 색 R/G 1.12~1.22·B/G 0.82~0.88, 트인 벽 대비 선형 휘도).
// - 창빛(key): 왼쪽 6°, 위 2°의 둥근 면광원, 반지름 12°. 가로로 반지름의 절반만 기울어 책 왼쪽은 깊이 × tan(12° − 6°) ≈ 12DU 안에서만 원반의
//   오른쪽 조각(약 30%)이 가리고, 오른쪽은 원반 약 70%가 가렸다가 깊이 × tan(18°) ≈ 36DU에 걸쳐 옅어진다. 가로 기울기가 반지름 이상이면 책 오른쪽
//   바로 옆이 창빛을 다 잃어 짙고, 0°면 그림자가 양쪽에 똑같이 진다(지난 정면 빛). 높이 2°: 4°면 판 바로 아래가 0.48로 짙다.
//   반지름 12°에서 책 그림자 빛 길이 구간(physShadow.bands) 경계는 63DU
// - 하늘빛·방 확산광: 환경 밝기가 방향에 따라 L(ω) ∝ ambient + 1.5·(skyTilt·ω)로 바뀌는 하늘(면이 받는 빛 = 그 코사인 적분 ambient + skyTilt·n).
//   창이 왼쪽이라 방도 왼쪽이 밝다(skyTilt.x < 0, 음수 빛이 없는 한도 |skyTilt| ≤ ambient/1.5의 약 85%). 책이 가리는 하늘이 오른쪽 옆은 밝은 왼쪽 하늘,
//   왼쪽 옆은 어두운 오른쪽 하늘이라 책 왼쪽 그늘(하늘 가림)이 거의 없어진다(책 왼쪽 3DU 0.95, 고른 하늘이면 0.88).
//   ambient 0.45·창빛 0.55: 하늘 몫이 클수록 그림자가 옅지만 책 오른쪽 바로 옆은 그 자리에서 보이는 하늘 절반이 책에 가려 하늘만으로는
//   0.4 안팎을 넘지 못한다(깊이 110DU 책이 벽에서 11DU: 시안처럼 0.75가 되려면 빛 대부분이 오른쪽에서 와야 하고 그러면 그림자가 왼쪽으로 진다)
// - 빛 색: 흰빛(skyColor·keyColor 1). 그늘 색은 크림 벽·베이지 판·책에서 튄 빛이 정한다(책 옆 그늘 R/G 1.16~1.3·B/G 0.82~0.89, 시안과 비슷한 따뜻한 회색).
//   창빛과 하늘빛 색이 다르면 창빛이 가려진 곳(이제 책 오른쪽)만 하늘 색이 되어 같은 그늘이 자리마다 다른 색이 된다
// 세기는 상대값이다. 재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색으로 보고 반사율을 거꾸로 구한다
// (light-model calibrate). 카메라(노출·화이트 밸런스)는 줄 가운데 벽에 맞춘다.
import { colors } from './theme';

export const light = {
  dir: { x: -Math.tan((6 * Math.PI) / 180), y: Math.tan((2 * Math.PI) / 180) * Math.hypot(1, Math.tan((6 * Math.PI) / 180)), z: -1 },
  radius: (12 * Math.PI) / 180,
  ambient: 0.45,
  skyTilt: { x: -0.28, y: 0.03, z: 0 },
  diffuse: 0.55,
  skyColor: [1, 1, 1] as [number, number, number],
  keyColor: [1, 1, 1] as [number, number, number],
};

// 카메라(보기 선택, 물리 값이 아니다). exposure: 노출(EV), 기준(재질이 대표 자리에서 시안 색으로 보이는 노출)보다 밝게 +, 어둡게 −.
// 화면 색은 노출 뒤 필름형 톤 곡선(light-model tone): 화면 밝기가 shoulder를 넘으면 1로 부드럽게 다가가고(하이라이트를 누른다),
// toe 아래는 검정 쪽 기울기를 1 − toeK로 눌러 아주 어두운 곳이 조금 더 깊다. 어깨는 약하게(위 15%만): 더 내리면 시안의 거의 흰 장정 색이
// 반사율 1을 넘는다(0.81 아래)
export const camera = { exposure: 0, shoulder: 0.85, toe: 0.18, toeK: 0.15 };

// 재질(모든 면이 같은 규칙). 종이·면 섬유·도료·나무 마감은 모두 유전체(굴절률 약 1.5)라 수직 반사율 F0가 같고, 다른 것은 표면뿐이다.
// - roughness: 화소보다 훨씬 작은 요철의 거칠기(GGX 지각 거칠기 r, α = r²). 창빛이 보는 사람 뒤(정면에서 6°)라 모든 앞면이 거울 방향 가까이에 있어
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
