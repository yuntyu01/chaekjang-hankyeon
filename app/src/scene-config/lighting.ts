// 3D 책장의 빛과 재질(장면 입력). 밝기·그림자·어둠·반사광은 모두 이 입력과 3D 형태에서 계산한다(domain/light-model, ui/SceneLight).
// 손으로 정한 진하기·번짐·범위는 두지 않는다.
//
// 빛(2026-10-10 물리 한 규칙, 사용자: '일관되게 적용할 수 있나, 물리법칙 같은 것도'): 모든 물체(책·판·면)에 같은 빛 두 개만 쓴다.
// - 창빛(key): 작은 원반 하나(왼쪽·위 각도, 반지름). 책·판 그림자, 면이 받는 빛·하이라이트를 모두 이 원반으로 계산한다.
// - 방 빛(sky): 위·앞이 밝은 방. 가리개가 가린 만큼 줄어드는 하늘 가림을 모든 곳에 같은 세기(occlusion, 0~1)로 쓴다.
// 그림자 참고 그림(docs/design/그림자 참고.png)의 모습은 이 물리로 설명된다: 책 그림자는 창빛만 가려 옅고 모양이 또렷하며(작은 원반),
// 판 아래는 창빛과 방 빛(판이 위쪽 하늘을 가림)을 함께 가려 더 진하고, 방 빛 가림이 멀어질수록 줄어 길게 옅어진다.
// 그림자 참고에서 잰 값(트인 벽 대비 선형 휘도): 줄 끝 책 오른쪽 0.81(바로 옆) → 0.87(40px) → 0.95(55px) → 1.0(70px),
// 판 아래(화면) 0.75 → 0.77(25px) → 0.81(45px) → 0.83(60px) → 0.89(125px). 화면에서는 판 바로 아래 벽 약 12DU가 판에 가려 보이지 않는다(카메라 4°)
// 2026-10-26 다시 잼(그림자 참고, 판 아래 벽 깊이 h DU, 맨 위 열린 벽 대비): h12 0.58~0.75, h23 0.72~0.83, h33 0.78~0.89, h44 0.82~0.95 —
// 판 바로 아래가 가장 짙고 길게 옅어진다(사용자 결정 2026-10-26: 시안처럼). 반지름 7°이면 화면(책 있는 줄)에서 판 아래가 h 17~33 동안
// 0.72~0.74로 평평한 띠였다(창빛 본그림자 띠: 판 앞 끝을 스치는 빛이 위 17° − 반지름 아래로는 다 막힌다). 반지름 14°면 반그림자가 판
// 바로 아래(h 9)에서 시작해 화면에서 h12 0.67 → h33 0.77 → h55 0.84 → h90 0.92로 이어서 밝아진다(시안 평균과 오차 0.08 → 0.06).
// 가림 세기를 0.55로 올리면 판 바로 아래는 시안만큼 짙지만 책이 찬 줄 벽 전체가 0.1쯤 어두워져(h90 0.83) 0.3 그대로 둔다.
// 책 그림자는 원반이 넓어진 만큼(반그림자 폭 두 배) 더 번진다.
// - 값: 창빛 왼쪽 6°·위 10°·반지름 8°·세기 0.22(방 빛 0.72), 가림 세기 0.3, 반사율 상한 0.9(2026-11-04 움푹 파인 책장, 사용자가 사진으로 고른 c1을 시안 그늘 길이에 맞춤).
//   가림 0.3은 물리값 1이 아니다: 1이면 뒷벽이 약 164까지 어두워져 시안(약 230)에서 멀어진다. 좁은 곳의 어둠은 안쪽 모서리 그늘(jointShade)이 맡는다.
//   반사율 상한은 틀 때문에 0.9다: 틀은 안쪽 면에서 보이는 색이 기준이라 벽보다 반사율이 크고, 그 값이 상한이 된다(벽은 c1의 0.7과 비슷하다).
//   이전 값(왼쪽 10°·위 17°·반지름 14°·세기 0.35, 방 빛 0.55, 가림 0.3, 상한 0.7, 2026-11-03 '수정안 2')은 깊이 173DU의 구멍에서 반그림자가 3~31°까지 퍼져 뒷벽 어디도
//   그늘을 벗어나지 못했고(시안은 판 아래 약 54DU면 그늘이 끝난다: 위 + 반지름 약 17~23°), 창빛을 못 받는 안쪽 면이 방 빛 몫만큼만 남아 어두웠다(180, 시안 205~230).
//   아래 왼쪽 10°·위 12°·위 17° 설명은 그 이전 값의 기록이다.
//   판 그림자는 창빛이 왼쪽에서 오는 만큼 오른쪽으로 밀려 판 끝에서 대각선이 된다(판이 벽에서 175DU 나와 있다): 기울기 = tan(왼쪽)/tan(위).
//   왼쪽 10°·위 12°면 대각선이 세로에서 40°라 왼쪽 끝 판 아래가 비고 오른쪽 끝은 판 너머로 번졌다(2026-10-10 사용자: 선반 양끝 문제).
//   위 17°로 높여 26°로 세웠다(판 그림자도 길어져 그림자 참고의 긴 꼬리에 가깝다). 왼쪽을 더 줄이면 책 그림자가 책 옆으로 덜 드러난다
//   (그림자 참고는 책 그림자만 오른쪽으로 밀고 판 그림자는 바로 아래로 그려 물리로는 함께 나오지 않는다)
// - 빛 색: 창빛·방 빛 모두 흰빛. 2026-11-03 사용자 '그림자가 불쾌하게 진다': 방 빛이 따뜻하던([1.14, 1, 0.84], 크림 벽 시절) 때는 흰 창빛이 가려진 곳에
//   따뜻한 방 빛만 남아 흰 벽 그림자가 노란 올리브색(판 아래 #DEDCD1, R−B 13~28)으로 떴다. 그늘의 따뜻한 기운은 판에서 튄 빛(색 번짐)으로만 남는다
// 세기는 상대값이다. 재질 색(시안 색)은 그 재질이 대표 자리에서 보이는 색으로 보고 반사율을 거꾸로 구한다
// (light-model calibrate). 카메라(노출·화이트 밸런스)는 줄 가운데 벽에 맞춘다.
import { readPerfSetting } from './boot-store';
import { LOOK, SKIN } from './skin';

const tanD = (d: number) => Math.tan((d * Math.PI) / 180);
// 창빛 방향: 위 각, 왼쪽 각
const keyDir = (el: number, az: number) => ({ x: -tanD(az), y: tanD(el) * Math.hypot(1, tanD(az)), z: -1 });
// 움푹 파인 책장: 2026-11-04 사용자 'c1이 제일 나아 보인다'(위 13°, 반지름 10°). 눈이 낮아지며 판 바로 아래가 보이게 되어, 그늘이 시안처럼 판 아래 약 90px에서 끝나도록 위 10°, 반지름 8°로 맞췄다.
// 전 책장(틀 없음, 사용자가 아직 고르는 중): 2026-11-03 '수정안 2'
const NICHE_LIGHT = { el: 10, az: 6, radius: 8, ambient: 0.72, diffuse: 0.22, occlusion: 0.3 };
const OPEN_LIGHT = { el: 17, az: 10, radius: 14, ambient: 0.55, diffuse: 0.35, occlusion: 0.3 };
const L0 = SKIN.frame ? NICHE_LIGHT : OPEN_LIGHT;
export const light = {
  dir: keyDir(L0.el, L0.az),
  radius: (L0.radius * Math.PI) / 180,
  ambient: L0.ambient,
  skyTilt: { x: 0, y: 0.25, z: -0.12 },
  diffuse: L0.diffuse,
  skyColor: [1, 1, 1] as [number, number, number],
  keyColor: [1, 1, 1] as [number, number, number],
  // 방 빛 하늘 가림 세기(물리 1). 모든 곳에 같은 비율로 쓴다
  occlusion: L0.occlusion,
};

// 측정 번들 전용: 빌드 없이 빛을 바꿔 비교한다. 딥링크 ?light=위 각,왼쪽 각,반지름,ambient,skyTilt y,skyTilt z,diffuse,occlusion[,반사율 상한] 을 저장하면 다음 실행부터 적용, ?light=off로 지운다(useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_LIGHT_KEY = 'perf-light';
let perfAlbedoMax: number | undefined;
{
  const saved = readPerfSetting(PERF_LIGHT_KEY);
  const v = saved ? saved.split(',').map(Number) : [];
  if ((v.length === 8 || v.length === 9) && v.every(Number.isFinite)) {
    const [el, az, rad, ambient, ty, tz, diffuse, occlusion, albedoMax] = v;
    perfAlbedoMax = albedoMax;
    Object.assign(light, { dir: keyDir(el, az), radius: (rad * Math.PI) / 180, ambient, skyTilt: { x: 0, y: ty, z: tz }, diffuse, occlusion });
    console.log('[light] 적용', saved);
  }
}

// 접촉 그늘(2026-11-02 사용자 '책이 선반에 놓여 있는 느낌, 좁고 짧은 그림자'): 빛이 앞에서 와 책 앞 판은 책 앞면이 되비친 빛으로 채워져 그늘이 지지 않고(에뮬 실측 1단계 차이),
// 책이 붕 떠 보였다. 실제로는 책 밑 둥근 모서리·바닥 틈이 어둡게 가린다: 받치는 면(윗면) 위의 점에서 책 밑동을 높이 heightMm의 어두운 띠로 보고 그 띠가 가리는 몫
// ½(1 − d/√(d² + h²))(수직 띠의 형태 계수, d: 책까지 거리)만큼 받는 빛을 줄인다. 높이는 화면에서 3~4화소로 보이게 고른 값(보기 선택, 실제 모서리 반지름 4mm보다 크다)
export const contact = { heightMm: 18 };

// 책장에 그리는 실제 표지 사진의 채도(1 = 원본, 2026-11-03 사용자 '실사 책들 채도를 좀 낮추면'). 인터넷 표지 그림은 화면용이라 실제 무광 인쇄지보다 쨍해서 흰 벽에서 튄다.
// 책등 색도 같은 값을 쓴다(표지 사진에서 뽑은 색이라 어긋나지 않게). 목록·시트의 썸네일은 원본 그대로
export const PHOTO_SATURATION = 0.85;

// 카메라(보기 선택, 물리 값이 아니다). exposure: 노출(EV), 기준(재질이 대표 자리에서 시안 색으로 보이는 노출)보다 밝게 +, 어둡게 −.
// 화면 색은 노출 뒤 필름형 톤 곡선(light-model tone): 화면 밝기가 shoulder를 넘으면 1로 부드럽게 다가가고(하이라이트를 누른다),
// toe 아래는 검정 쪽 기울기를 1 − toeK로 눌러 아주 어두운 곳이 조금 더 깊다. 어깨는 약하게(위 15%만): 더 내리면 시안의 거의 흰 장정 색이
// 반사율 1을 넘는다(0.81 아래)
// 2026-11-03 사용자 '왜 흰 책 모서리 그늘이 붉은가': 어깨(0.85)가 크림색의 R만 눌러 두어 그늘에서 R만 덜 어두워졌다(#FDF0E0의 90% 그늘이 251,229,214). 어깨를 0.95로 올려 그늘 색이 책 색 그대로 어두워진다(243,229,214)
export const camera = { exposure: 0, shoulder: 0.95, toe: 0.18, toeK: 0.15 };

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
// fine: (fiber만) 짧은 섬유의 세기. 폭 FIBER.width·길이 FIBER.length로 두 방향으로 엇갈린다
export type Grain = { kind: 'fiber' | 'weave' | 'sheets' | 'wood' | 'linen' | 'none'; size: [number, number]; contrast: [number, number]; fine?: number };
export const FIBER = { width: 0.55, length: 2.2 };
// specular: 표면 반사 몫의 배수(없으면 1, 보통 유전체 F0). 반사광은 모든 색에 똑같이 더해져 검은 부분을 띄운다
export type SurfaceMaterial = { roughness: number; bump: Bump | null; grain: Grain; specular?: number };
const NONE: Grain = { kind: 'none', size: [1, 1], contrast: [0, 0] };
export const materials = {
  // 무광 종이(코팅 없는 종이, 거의 완전 확산면): 갈피 종이·빛 맞추기 기준. 섬유 뭉침(약 1.5mm)의 아주 얕은 굴곡.
  // 결(반사율): 표지 종이의 섬유 뭉침(지합, 1~5mm 구름 무늬)은 반사율이 몇 % 다르다. 2026-10-31 사용자 '잔결이 좀 보이게':
  // 0.6mm(화면 1.3px, 안 보임)·1% 세기 → 1.5mm(약 3px)·4%, 4mm·2%. 에뮬 측정(12px 흐림을 뺀 책등 밝기 표준편차): 0.24 → 0.45단계.
  // 사용자가 보여 준 사진은 약 1.5단계라 옅었다 → 2026-11-02 사용자 '종이재질 넣어줘': 세기를 사진 쪽으로 3배(12%, 6%)
  paper: { roughness: 0.9, bump: { size: [1.5, 1.5], slope: 0.02 }, grain: { kind: 'fiber', size: [1.5, 4], contrast: [0.12, 0.06], fine: 0.26 } },
  // 2026-11-03 사용자 선택: 책 표면은 고운 종이(기본)·린넨·매끈 무광·줄무늬 종이. 예전 재질(무광 종이·천·코팅지·무광 인쇄지)은 저장본을 읽을 때 새 이름으로 바뀐다(types bindingMaterialOf)
  // 고운 종이(기본): 예전 무광 종이의 결을 약 40%로. 단색 책등에서 뭉침이 석고처럼 보이지 않고, 표지 사진의 글자·그림을 흐리지 않는다(YES24 답변: 옅은 종이 질감 허용).
  // 반사 몫은 저반사 무광 막(F0 약 0.014): 보통 F0이면 표지 검정이 떠서 탁해 보였다(에뮬 실측, 2026-11-02)
  fine: { roughness: 0.9, bump: { size: [1.5, 1.5], slope: 0.01 }, grain: { kind: 'fiber', size: [1.5, 4], contrast: [0.05, 0.02], fine: 0.09 }, specular: 0.35 },
  // 린넨: 가로·세로 실이 직각으로 교차하는 천(섬유와 같은 굵기·길이의 실) + 실 굵기 얼룩
  linen: { roughness: 0.8, bump: { size: [1.2, 1.2], slope: 0.06 }, grain: { kind: 'linen', size: [1, 5], contrast: [0, 0.02], fine: 0.2 } },
  // 매끈 무광: 결 없는 무광 코팅 막(요즘 책 표지에 가장 흔하다)
  matte: { roughness: 0.85, bump: null, grain: NONE, specular: 0.5 },
  // 줄무늬 종이(레이드지): 뜰 때 생긴 가는 평행 줄. 나무 나이테와 같은 식에 줄 간격 2.4mm
  laid: { roughness: 0.9, bump: { size: [1, 1], slope: 0.01 }, grain: { kind: 'wood', size: [2.4, 60], contrast: [0.09, 0] }, specular: 0.35 },
  // 속지 단면: 낱장(약 0.1mm) 가장자리가 쌓인 면이라 두께 방향으로 촘촘한 굴곡(재단면이라 종이 면보다 거칠다).
  // 낱장 하나는 화면에서 화소보다 훨씬 가늘어 보이지 않으므로, 결은 몇 장씩 끝이 어긋난 묶음(약 1mm)과 접장 틈(1.6mm마다)으로 보인다
  // (2026-10-10 사용자: 흰 속지가 너무 매끄러워 벽돌 같다, 페이지 티가 나게)
  pages: { roughness: 0.9, bump: { size: [0.15, 40], slope: 0.15 }, grain: { kind: 'sheets', size: [1, 1.6], contrast: [0.12, 0.45] } },
  // 선반 판: 무광 마감(오일·무광 래커)한 나무. 결 방향(판 길이)으로 길게 늘어난 굴곡
  // 2026-11-03 사용자 시안 '선반에 나뭇결': 시안 판 앞면 밝기 표준편차 5.0단계(전에는 0.5단계로 거의 단색이었다)에 맞춰 늦재 띠 9%, 긴 색 얼룩 5%
  // 2026-11-04 사용자 '디테일이 떨어진다': 시안 판은 굵은 띠 사이로 가는 결이 또렷해 가는 결을 더했다(fine: 세기). 표준편차가 시안(3.85)을 넘지 않게 굵은 띠를 0.09 → 0.07로
  // specular: 움푹 파인 책장은 반무광 마감(scene-config/skin LOOK plankSpec)
  wood: { roughness: 0.7, bump: { size: [30, 0.8], slope: 0.02 }, grain: { kind: 'wood', size: [3.5, 60], contrast: [0.07, 0.05], fine: 0.07 }, specular: SKIN.frame ? LOOK.plankSpec : 1 },
  // 벽: 무광 도료. 고운 섬유 0.8mm(세기 0.01)·얼룩 8mm(세기 0.01). 2026-11-04 얼룩 세기 0.03 → 0.01: 뒷벽이 흰색에서 내려와 어깨에 눌리지 않자 얼룩이 드러났다
  // (빈 벽 밝기 표준편차 2.73단계, 움푹 파인 책장 시안 0.9단계)
  paint: { roughness: 0.9, bump: { size: [1, 1], slope: 0.01 }, grain: { kind: 'fiber', size: [0.8, 8], contrast: [0.01, 0.01] } },
  // 종이 벽지(스킨): 벽 칠보다 섬유 결이 또렷한 두꺼운 종이. 표지 종이(paper)와 같은 크기의 뭉침에 그 절반 세기
  wallpaper: { roughness: 0.9, bump: { size: [1.5, 1.5], slope: 0.02 }, grain: { kind: 'fiber', size: [1.5, 6], contrast: [0.06, 0.04], fine: 0.13 } },
} satisfies Record<string, SurfaceMaterial>;
export type MaterialName = keyof typeof materials;

// 장면 면의 재질 색(반사율은 선형 RGB, light-model linearOf): 선반 판·틀·벽은 스킨(scene-config/skin), 책 속지(시안 책 머리의 속지 약 (253, 243, 226))
// paper: 책 속지(머리·꼬리·책배 종이). 2026-11-03 사용자 '페이지 쪽은 흰색, 너무 밝은 흰색 말고': 살구빛 크림 #FBF2E2 → 은은한 미색
export const surfaces = { plank: SKIN.plank.color, frame: SKIN.frame?.color ?? SKIN.plank.color, wall: SKIN.wall.color, paper: '#F1EEE6' };
// 부품의 재질 이름(materials의 열쇠): 스킨이 정한다
export const surfaceMats = { plank: SKIN.plank.mat, frame: SKIN.frame?.mat ?? SKIN.plank.mat, wall: SKIN.wall.mat } as const;
// 반사율 상한(물리): 실제 흰 재질(흰 종이·크림색 벽 페인트)의 반사율은 0.7~0.85다. 맞추기(light-model setAlbedo)는 어느 재질의 반사율도
// 이 값을 넘지 않게 카메라 이득을 정한다. 1에 가깝게 두면 벽·판·책 사이에서 여러 번 튄 빛이 너무 세서 그늘이 크림 벽·연어색 책의 색으로
// 짙게 물든다(판 아래 R이 G보다 8%, 연어색 책 옆 17% 넘쳤다). 2026-11-04 0.7 → 0.85: 흰 칠 벽의 실제 값이고, 움푹 파인 안쪽은 튄 빛으로 밝아진다. 물드는 정도는 사진으로 확인
export const ALBEDO_MAX = perfAlbedoMax ?? (SKIN.frame ? 0.9 : 0.7);

// 그림자 흐림(반그림자): 가리개에서 빛 길이 t만큼 떨어진 곳의 반그림자 폭 = 2·tan(반지름)·t(창빛 원반 그대로).
// 연속 흐림을 빛 길이 구간(bands)으로 나눠 구간마다 가운데 거리로 번지게 그린다. 첫 구간은 반그림자가 1DU가 되는 거리,
// 다음 구간은 그 2배씩(구간 안 흐림 차이가 2배 이내: 3배씩 5단계면 구간 경계에서 번짐이 한 번에 바뀌는 계단이 보였다). 마지막은 끝없이
const SPREAD = 2 * Math.tan(light.radius);
export const physShadow = { spread: SPREAD, bands: [1, 2, 4, 8, 16, 32].map((k) => k / SPREAD).concat([Infinity]) };
