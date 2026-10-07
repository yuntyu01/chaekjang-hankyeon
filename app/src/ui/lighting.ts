// 3D 책장의 빛과 재질(장면 입력). 밝기·그림자·어둠·반사광은 모두 이 입력과 3D 형태에서 계산한다(domain/light-model, ui/SceneLight).
// 손으로 정한 진하기·번짐·범위는 두지 않는다.
//
// 빛(2026-10-07 시안 docs/design/따뜻한 플랫 일러스트 책장.png에서 잰 것):
// - 창빛(key): 거의 정면(왼쪽 약 6°, 위 약 3.5°)의 둥근 면광원, 반지름 약 8°. 그림자가 책 뒤로 숨고 판 밑 그늘이 짧다.
// - 방 확산광(ambient)과 천장에서 오는 몫(skyUp): 환경 밝기가 방향에 따라 L(ω) ∝ ambient + 1.5·skyUp·ω.y로 바뀌는 하늘.
//   이 하늘이 법선 n인 면에 주는 빛 = ambient + skyUp·n.y(코사인 적분).
// 세기는 상대값이고 빛은 흰빛이다. 재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색으로 보고 반사율을 거꾸로 구한다
// (light-model calibrate). 카메라(노출·화이트 밸런스)는 줄 가운데 벽에 맞춘다.
import { colors } from './theme';

export const light = { dir: { x: -0.1, y: 0.06, z: -0.993 }, radius: (8 * Math.PI) / 180, ambient: 0.85, skyUp: 0.22, diffuse: 0.15 };

// 카메라(보기 선택, 물리 값이 아니다). exposure: 노출(EV), 기준(재질이 대표 자리에서 시안 색으로 보이는 노출)보다 밝게 +, 어둡게 −.
// 화면 색은 노출 뒤 필름형 톤 곡선(light-model tone): 화면 밝기가 shoulder를 넘으면 1로 부드럽게 다가가고(하이라이트를 누른다),
// toe 아래는 검정 쪽 기울기를 1 − toeK로 눌러 아주 어두운 곳이 조금 더 깊다. 어깨는 약하게(위 15%만): 더 내리면 시안의 거의 흰 장정 색이
// 반사율 1을 넘는다(0.81 아래)
export const camera = { exposure: 0, shoulder: 0.85, toe: 0.18, toeK: 0.15 };

// 모든 면의 표면 광택: 유전체(굴절률 1.5)의 수직 반사율 F0와 표면 거칠기(종이·칠한 벽·나무 모두 같은 무광 유전체)
export const material = { f0: 0.04, roughness: 0.6 };

// 장면 면의 재질 색(반사율은 선형 RGB, light-model linearOf): 선반 판(시안 판 앞면), 벽(화면 바탕), 책 속지(시안 책 머리의 속지 약 (253, 243, 226))
export const surfaces = { plank: '#F2DCC1', wall: colors.wall, paper: '#FBF2E2' };

// 그림자 흐림(반그림자): 가리개에서 빛 길이 t만큼 떨어진 곳의 반그림자 폭 = 2·tan(반지름)·t.
// 연속 흐림을 빛 길이 구간(bands)으로 나눠 구간마다 가운데 거리로 번지게 그린다. 첫 구간은 반그림자가 1DU가 되는 거리,
// 다음 구간은 그 3배씩(구간 안 흐림 차이가 3배 이내 = 해상도).
const SPREAD = 2 * Math.tan(light.radius);
export const physShadow = { spread: SPREAD, bands: [1, 3, 9, 27].map((k) => k / SPREAD).concat([Infinity]) };
