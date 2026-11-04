// 책장 스킨(2026-11-04 사용자 '선반·벽 틀을 나눠 물리를 적용하고 스킨을 끼울 수 있게, 선반이랑 벽지'): 책장을 세 부품으로 나눠 따로 고른다.
// - 선반(plank): 책이 놓이는 판 / 틀(frame): 벽에 움푹 파인 구멍의 안쪽 면(양옆·위, none이면 구멍 없이 벽에 판만 달린 모습) / 벽지(wall): 구멍 밖 벽과 뒷벽
// 스킨은 재질 색과 재질 이름만 정한다. 그림자·빛은 부품마다 같은 빛 모델이 3D 모양에서 계산한다(스킨별 덧칠 없음):
// 색은 그 부품이 대표 자리에서 보이는 색이고 반사율은 맞추기(light-model runCalibration)가 거꾸로 구한다.
import { sceneColors } from './palette';
import { readPerfSetting } from './perf-store';

export type SkinPart = { name: string; color: string; mat: 'wood' | 'paint' | 'wallpaper' };

export const PLANK_SKINS = {
  pine: { name: '밝은 나무', color: '#F2DCC1', mat: 'wood' },
  oak: { name: '오크', color: '#D6B48C', mat: 'wood' },
  walnut: { name: '호두나무', color: '#8F6E55', mat: 'wood' },
  white: { name: '흰 칠', color: '#F5F3EE', mat: 'paint' },
} satisfies Record<string, SkinPart>;

// 틀 색은 안쪽 면에서 모서리 그늘 전 평균으로 보이는 색이다(light-model runCalibration). 흰 틀: 시안 안쪽 면 앞 226·뒤 214
export const FRAME_SKINS = {
  white: { name: '흰 틀', color: '#ECEBE9', mat: 'paint' },
  pine: { name: '밝은 나무 틀', color: '#F2DCC1', mat: 'wood' },
  walnut: { name: '호두나무 틀', color: '#8F6E55', mat: 'wood' },
  none: null,
} satisfies Record<string, SkinPart | null>;

// 벽지는 머리글 글자 뒤에도 깔리므로 밝은 색만 둔다(어두운 벽지는 검은 머리글 글자가 안 보인다)
export const WALL_SKINS = {
  white: { name: '흰 벽', color: sceneColors.wall, mat: 'paint' },
  paper: { name: '종이 벽지', color: '#F6F4EE', mat: 'wallpaper' },
  cream: { name: '크림', color: '#F5EEE1', mat: 'paint' },
  sage: { name: '세이지', color: '#E3E8DD', mat: 'paint' },
} satisfies Record<string, SkinPart>;

export type SkinChoice = { plank: keyof typeof PLANK_SKINS; frame: keyof typeof FRAME_SKINS; wall: keyof typeof WALL_SKINS };
export const DEFAULT_SKIN: SkinChoice = { plank: 'pine', frame: 'white', wall: 'white' };

// 측정 번들 전용: 빌드 없이 스킨을 바꿔 비교한다. 딥링크 ?skin=선반,틀,벽지 를 저장하면 다음 실행부터 적용, ?skin=off로 지운다(useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_SKIN_KEY = 'perf-skin';
function chosen(): SkinChoice {
  const saved = readPerfSetting(PERF_SKIN_KEY);
  const [plank, frame, wall] = saved ? saved.split(',') : [];
  if (plank in PLANK_SKINS && frame in FRAME_SKINS && wall in WALL_SKINS) {
    console.log('[skin] 적용', saved);
    return { plank, frame, wall } as SkinChoice;
  }
  return DEFAULT_SKIN;
}

export const SKIN_CHOICE = chosen();
export const SKIN = { plank: PLANK_SKINS[SKIN_CHOICE.plank] as SkinPart, frame: FRAME_SKINS[SKIN_CHOICE.frame] as SkinPart | null, wall: WALL_SKINS[SKIN_CHOICE.wall] as SkinPart };
// 틀이 있으면 빛 모델의 둘레에 구멍 안쪽 면이 들어가고, 없으면 판만 벽에 달린다
export const FRAME_ON = SKIN.frame !== null;

// 움푹 파인 책장의 구도와 모서리(2026-11-04 사용자 '천장이 시안과 다르다, 모서리 부드러움, 선반 붙은 측면'). 시안(841px)에서 잰 값에 맞췄다.
// - dist·eyeY: 줄 카메라 거리와 판 위 눈높이(DU). 시안의 안쪽 면 폭 약 19px, 판 윗면 약 15px, 천장 띠 약 6px가 같은 카메라로 나오는 자리다. 눈이 천장보다 낮아야 천장이 보인다(전 책장의 눈높이 344는 줄 간격 약 200보다 높아 천장이 안 보인다)
// - thickMm: 판 두께(시안 앞면 약 29px)
// - jointMm·jointK: 안쪽 모서리 그늘(light-model jointShade). 넓게 강하게 주면 벽이 시안보다 어둡다(16mm·0.6이면 판 바로 아래 167, 시안 190). 좁게 0.22면 시안처럼 천장·판 바로 아래만 어두워지고 천장과 뒷벽이 이어진다
// - rimMm: 구멍 앞 끝 둥근 테 반지름(시안에서 평평한 벽 → 안쪽 면이 약 4~5px 동안 이어진다)
// - sideMm·sideK: 안쪽 면이 위 면(천장·판 아랫면) 아래에서 어두워지는 범위와 세기. 안쪽 면은 창빛을 받지 않아 판 그림자가 없으므로 위에서 가려지는 몫을 따로 둔다. 시안 안쪽 면은 판 바로 아래 172에서 약 55px에 걸쳐 215까지 밝아진다
// - cornerK: 뒷벽 꼭지점 둥근 그늘 세기(2026-11-04 사용자 '안쪽 꼭지점이 더 곡선이어야'). 위 면과 안쪽 면이 함께 가리는 곳이 둥글게 어두워져 안쪽 면과 뒷벽 경계가 곡선으로 녹아든다. 시안 꼭지점 약 170 → 뒷벽 약 190
// - plankSpec: 판 표면 반사 몫 배수(반무광 마감). 낮은 눈에서 판 윗면을 스치듯 보면 반사가 뒷벽의 밝은 빛을 비춰 윗면이 밝아진다(시안 윗면 202~217, 1배면 197)
// - coveMm: 안쪽 모서리 곡면 반지름(2026-11-04 사용자 '선반이랑 벽 만나는 곳을 부드럽게 이어지게'). 벽·틀·판이 맞닿는 곳에서 두 면의 법선이 서서히 돌아 모서리에서 같아진다(light-model coveNormal)
// - cornerMm: 뒷벽 네 꼭지점 둥글기(2026-11-04 사용자 '안쪽 꼭지점 모서리가 더 곡선이어야'). 판 윗면의 뒤쪽 꼭지점도 같은 값
// - frameGrey: 측정 번들에서 틀 색을 바꿔 볼 때(0이면 스킨 색)
// - warm: 구멍 안(뒷벽·틀)을 따뜻하게 하는 정도(화면 단계, 빨강 − 파랑). 시안 약 6. 빛 계산은 그대로이고 보이는 색만 바뀐다
export const LOOK = { dist: 3300, eyeY: 150, thickMm: 19, jointMm: 8, jointK: 0.22, rimMm: 3, frameGrey: 0, warm: 5, coveMm: 7, cornerMm: 9, sideMm: 26, sideK: 0.6, plankSpec: 2, cornerK: 0.22, softMm: 3, rimCorner: 4 };
// 측정 번들 전용: 딥링크 ?look=거리,눈높이,판 두께,그늘 높이,그늘 세기,테 반지름,틀 회색,따뜻함,곡면 반지름,꼭지점 둥글기,옆면 범위,옆면 세기,판 윤기,꼭지점 그늘 을 저장하면 다음 실행부터 적용, ?look=off로 지운다(useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_LOOK_KEY = 'perf-look';
{
  const saved = readPerfSetting(PERF_LOOK_KEY);
  const v = saved ? saved.split(',').map(Number) : [];
  if (v.length === 16 && v.every(Number.isFinite)) {
    const [dist, eyeY, thickMm, jointMm, jointK, rimMm, frameGrey, warm, coveMm, cornerMm, sideMm, sideK, plankSpec, cornerK, softMm, rimCorner] = v;
    Object.assign(LOOK, { dist, eyeY, thickMm, jointMm, jointK, rimMm, frameGrey, warm, coveMm, cornerMm, sideMm, sideK, plankSpec, cornerK, softMm, rimCorner });
    if (frameGrey > 0 && SKIN.frame) {
      const h = Math.round(frameGrey).toString(16).padStart(2, '0');
      SKIN.frame = { ...SKIN.frame, color: `#${h}${h}${h}` };
    }
    console.log('[look] 적용', saved);
  }
}
// 구멍 안 색을 따뜻하게(초록 5/6, 파랑 1, 시안 벽 237, 232, 231의 비율)
function warmed(hex: string) {
  const v = parseInt(hex.slice(1, 7), 16);
  const ch = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${ch((v >> 16) & 255)}${ch(((v >> 8) & 255) - (LOOK.warm * 5) / 6)}${ch((v & 255) - LOOK.warm)}`;
}
// 뒷벽의 보이는 색. 벽지 색 그대로면 평평한 벽과 같다
export const BACK_COLOR = FRAME_ON ? warmed(SKIN.wall.color) : SKIN.wall.color;
if (SKIN.frame && LOOK.warm) SKIN.frame = { ...SKIN.frame, color: warmed(SKIN.frame.color) };
