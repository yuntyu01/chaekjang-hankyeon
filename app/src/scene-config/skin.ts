// 책장 스킨(2026-11-04 사용자 '선반·벽 틀을 나눠 물리를 적용하고 스킨을 끼울 수 있게, 선반이랑 벽지'): 책장을 세 부품으로 나눠 따로 고른다.
// - 선반(plank): 책이 놓이는 판 / 틀(frame): 벽에 움푹 파인 구멍의 안쪽 면(양옆·위, none이면 구멍 없이 벽에 판만 달린 모습) / 벽지(wall): 구멍 밖 벽과 뒷벽
// 스킨은 재질 색과 재질 이름만 정한다. 그림자·빛은 부품마다 같은 빛 모델이 3D 모양에서 계산한다(스킨별 덧칠 없음):
// 색은 그 부품이 대표 자리에서 보이는 색이고 반사율은 맞추기(light-model runCalibration)가 거꾸로 구한다.
import { sceneColors } from './palette';
import { readBootSetting, readPerfSetting } from './boot-store';

export type SkinPart = { name: string; color: string; mat: 'wood' | 'paint' | 'wallpaper' };

export const PLANK_SKINS = {
  pine: { name: '밝은 나무', color: '#F2DCC1', mat: 'wood' },
  oak: { name: '오크', color: '#D6B48C', mat: 'wood' },
  walnut: { name: '호두나무', color: '#8F6E55', mat: 'wood' },
  white: { name: '흰 칠', color: '#F5F3EE', mat: 'paint' },
} satisfies Record<string, SkinPart>;

// 틀 색은 안쪽 면에서 모서리 그늘 전 평균으로 보이는 색이다(light-model runCalibration). 흰 틀: 시안 안쪽 면 앞 226·뒤 214
export const FRAME_SKINS = {
  white: { name: '흰 벽', color: '#ECE7E4', mat: 'paint' },
  pine: { name: '밝은 나무 벽', color: '#F2D7BC', mat: 'wood' },
  walnut: { name: '호두나무 벽', color: '#8F6950', mat: 'wood' },
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
// 스토어에서 고른 값(시작 설정). 적용하면 앱을 다시 켠다(app/store)
export const SKIN_KEY = 'shelf-skin';
export const skinToString = (c: SkinChoice) => `${c.plank},${c.frame},${c.wall}`;
export function parseSkin(saved: string | null): SkinChoice | null {
  const [plank, frame, wall] = saved ? saved.split(',') : [];
  return plank in PLANK_SKINS && frame in FRAME_SKINS && wall in WALL_SKINS ? ({ plank, frame, wall } as SkinChoice) : null;
}
// 늘 새 객체(지금 스킨 SKIN_CHOICE는 실행 중에 값이 바뀌므로 기본값 객체를 그대로 쓰면 기본값까지 바뀐다)
function chosen(): SkinChoice {
  return { ...(parseSkin(readPerfSetting(PERF_SKIN_KEY)) ?? parseSkin(readBootSetting(SKIN_KEY)) ?? DEFAULT_SKIN) };
}

// 지금 스킨(시작할 때 고른 값으로 정하고, 스토어에서 색을 고르면 그 자리에서 바뀐다: setSkinChoice). 객체는 그대로 두고 값만 바꾼다(가져간 곳이 같은 객체를 본다)
export const SKIN_CHOICE: SkinChoice = chosen();
const partsOf = (c: SkinChoice) => ({ plank: PLANK_SKINS[c.plank] as SkinPart, frame: FRAME_SKINS[c.frame] as SkinPart | null, wall: WALL_SKINS[c.wall] as SkinPart });
export const SKIN = partsOf(SKIN_CHOICE);
// 틀이 있는지는 시작할 때 정해진다: 틀이 있으면 빛 모델의 둘레에 구멍 안쪽 면이 들어가고, 없으면 판만 벽에 달린다(카메라·판 모양·빛 배치가 달라 바꾸면 앱을 다시 켠다)
export const FRAME_ON = SKIN.frame !== null;
export const frameOnOf = (c: SkinChoice) => FRAME_SKINS[c.frame] !== null;
// 실행 중에 바꿀 수 있는 스킨(틀 여부가 지금과 같은 것: 색·재질만 다르다)
export const liveSkinOK = (c: SkinChoice) => frameOnOf(c) === FRAME_ON;
// 스킨 색·재질을 바꾼다(빛 맞추기·장면 면 색은 domain/light-model switchSkin이 함께 바꾼다). 틀 여부가 다르면 바꾸지 않는다
export function setSkinChoice(c: SkinChoice) {
  if (!liveSkinOK(c)) return false;
  Object.assign(SKIN_CHOICE, { plank: c.plank, frame: c.frame, wall: c.wall });
  Object.assign(SKIN, partsOf(SKIN_CHOICE));
  return true;
}
// 시작 설정에 저장된 스킨(적용한 값). 미리보기로 바꾼 뒤 적용하지 않고 나가면 이 값으로 되돌린다
export function savedSkin(): SkinChoice {
  return chosen();
}
export const ALL_SKINS: SkinChoice[] = (Object.keys(PLANK_SKINS) as SkinChoice['plank'][]).flatMap((plank) =>
  (Object.keys(FRAME_SKINS) as SkinChoice['frame'][]).flatMap((frame) => (Object.keys(WALL_SKINS) as SkinChoice['wall'][]).map((wall) => ({ plank, frame, wall }))),
);

// 움푹 파인 책장의 구도와 모서리(2026-11-04 사용자 '천장이 시안과 다르다, 모서리 부드러움, 선반 붙은 측면'). 시안(841px)에서 잰 값에 맞췄다.
// - dist·eyeY: 줄 카메라 거리와 판 위 눈높이(DU). 시안의 안쪽 면 폭 약 19px, 판 윗면 약 15px, 천장 띠 약 6px가 같은 카메라로 나오는 자리다. 눈이 천장보다 낮아야 천장이 보인다(전 책장의 눈높이 344는 줄 간격 약 200보다 높아 천장이 안 보인다)
// - thickMm: 판 두께(시안 앞면 약 29px)
// - jointMm·jointK: 안쪽 모서리 그늘(light-model jointShade). 넓게 강하게 주면 벽이 시안보다 어둡다(16mm·0.6이면 판 바로 아래 167, 시안 190). 좁게 0.22면 시안처럼 천장·판 바로 아래만 어두워지고 천장과 뒷벽이 이어진다
// - lipMm: 평평한 벽 면이 판 앞면보다 앞에 있는 거리(2026-11-05 사용자 사진 '벽이 선반보다 조금 앞, 그만큼 모서리가 둥글고 그 둥근 만큼 빛 반사'). 판은 구멍 안에 끼어 있어 테가 판 끝 바깥으로 끊기지 않고 이어진다
// - rimMm: 구멍 앞 끝 둥근 테 반지름. 벽이 앞에 나온 만큼 둥글다(lipMm과 같은 값). 같은 사진에서 테가 약 3~4px 안에 또렷하게 꺾인다: 원호라 어두워짐은 안쪽 절반에 몰린다
// - sideMm·sideK: 안쪽 면이 위 면(천장·판 아랫면) 아래에서 어두워지는 범위와 세기. 안쪽 면은 창빛을 받지 않아 판 그림자가 없으므로 위에서 가려지는 몫을 따로 둔다. 시안 안쪽 면은 판 바로 아래 172에서 약 55px에 걸쳐 215까지 밝아진다
// - cornerK: 뒷벽 꼭지점 둥근 그늘 세기(2026-11-04 사용자 '안쪽 꼭지점이 더 곡선이어야'). 위 면과 안쪽 면이 함께 가리는 곳이 둥글게 어두워져 안쪽 면과 뒷벽 경계가 곡선으로 녹아든다. 시안 꼭지점 약 170 → 뒷벽 약 190
// - plankSpec: 판 표면 반사 몫 배수(반무광 마감). 낮은 눈에서 판 윗면을 스치듯 보면 반사가 뒷벽의 밝은 빛을 비춰 윗면이 밝아진다(시안 윗면 202~217, 1배면 197)
// - coveMm: 안쪽 모서리 곡면 반지름(2026-11-04 사용자 '선반이랑 벽 만나는 곳을 부드럽게 이어지게'). 벽·틀·판이 맞닿는 곳에서 두 면의 법선이 서서히 돌아 모서리에서 같아진다(light-model coveNormal)
// - cornerMm: 뒷벽 네 꼭지점 둥글기(2026-11-04 사용자 '안쪽 꼭지점 모서리가 더 곡선이어야'). 판 윗면의 뒤쪽 꼭지점도 같은 값
export const LOOK = { dist: 3300, eyeY: 150, thickMm: 19, jointMm: 8, jointK: 0.22, rimMm: 4, coveMm: 7, cornerMm: 9, sideMm: 26, sideK: 0.6, plankSpec: 2, cornerK: 0.22, softMm: 3, rimCorner: 1.5, lipMm: 4 };
// 측정 번들 전용: 딥링크 ?look=거리,눈높이,판 두께,그늘 높이,그늘 세기,테 반지름,곡면 반지름,꼭지점 둥글기,옆면 범위,옆면 세기,판 윤기,꼭지점 그늘,번짐,테 모서리,벽 앞 거리 를 저장하면 다음 실행부터 적용, ?look=off로 지운다(useHomePerf). 배포본은 이 값을 읽지 않는다
export const PERF_LOOK_KEY = 'perf-look';
{
  const saved = readPerfSetting(PERF_LOOK_KEY);
  const v = saved ? saved.split(',').map(Number) : [];
  if (v.length === 15 && v.every(Number.isFinite)) {
    const [dist, eyeY, thickMm, jointMm, jointK, rimMm, coveMm, cornerMm, sideMm, sideK, plankSpec, cornerK, softMm, rimCorner, lipMm] = v;
    Object.assign(LOOK, { dist, eyeY, thickMm, jointMm, jointK, rimMm, coveMm, cornerMm, sideMm, sideK, plankSpec, cornerK, softMm, rimCorner, lipMm });
    console.log('[look] 적용', saved);
  }
}
