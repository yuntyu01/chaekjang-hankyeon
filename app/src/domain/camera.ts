// 공통 카메라와 좌표 변환(순수, UI 스레드 워클릿에서도 쓴다). 책·선반·그림자·터치가 모두 이것 하나로 투영한다.
// 선반 공간(한 줄): x 오른쪽(책 줄 왼쪽 끝 0), y 위(판 윗면 0), z 벽 쪽(책 기준선 0, 판 앞 끝 -SHELF_FRONT, 벽 SHELF_DEPTH).
//
// 원근 카메라(eye): 줄 앞 VIEW_DIST 거리, 줄 가운데(VIEW_CX)에서 눈높이 eye.y로 벽을 똑바로 본다(시안에서 잰 구도).
//   깊이 비율 d = 1 + (z - eye.z) / dist,  화면 x = eye.x + (x - eye.x) / d,  화면 y(아래가 +) = -(eye.y + (y - eye.y) / d)
//   책 기준선(z = 0)에서는 화면 = 선반 공간 그대로(d = 1)라 배치·터치 좌표가 원근과 상관없다.
//   깊어질수록 줄 가운데·눈높이 쪽으로 모인다: 가운데 왼쪽 책은 오른쪽 옆면, 오른쪽 책은 왼쪽 옆면이 보이고,
//   눈보다 낮은 면(판 윗면·낮은 책 머리)은 위가, 눈높이의 책 머리는 거의 보이지 않는다.
// 사선(kx, ky): eye가 없는 카메라는 예전처럼 직교 + 사선이다(화면 x = x + z·kx, 화면 y = -(y + z·ky)).
//   eye가 있으면 kx·ky는 요약 값이다(판 윗면 높이·줄 가운데에서 깊이 1당 화면 변화). 줄 칸 높이 같은 배치 계산이 쓴다.
//   면이 보이는지·가림 순서처럼 방향이 필요한 곳은 그 자리의 값(viewAt)을 쓴다.
// 보기 각(pitch)은 눈높이만 바꾼다(eye.y = dist·tan(각)): 책 배치·충돌·줄 간격(3D)은 카메라를 읽지 않는다.
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.

export type Eye = { x: number; y: number; z: number; dist: number };
export type Cam = { kx: number; ky: number; eye?: Eye };
export type Point = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

// 시안 책장에서 잰 구도(853px 시안, 1.666px/mm):
// - 판 윗면 230mm가 약 12px(7.2mm)로 보인다 → 판 높이에서 깊이 1당 0.031(약 1.8°).
// - 판 오른쪽 끝이 벽 쪽으로 가운데를 향해 약 3.6% 들어간다 → 거리 약 230mm / 0.036 = 6.4m.
// - 책 머리(판 위 약 200mm)는 윗면이 거의 보이지 않는다 → 눈높이 ≈ 0.031 × 6.4m ≈ 200mm.
// 시안 구도는 1.8°(눈 ≈ 책 머리)였고, 2026-10-06 사용자 요청으로 기본을 4°(눈 ≈ 판 위 450mm, 책 머리 윗면이 조금 보인다)로 올렸다.
// 꾸미기에서 8°까지 눈을 올려 내려다본다.
export const VIEW_PITCH_MIN = 4;
export const VIEW_PITCH_MAX = 8;
// 줄 앞 카메라 거리(DU, 6.45m × 0.7625DU/mm)
export const VIEW_DIST = 4918;
// 줄 가운데(선반 공간 x): 화면 가운데 = DESIGN_WIDTH / 2 - 책 줄 왼쪽 여백(geometry USABLE_LEFT) = 195 - 12
export const VIEW_CX = 183;
// 예전 사선 카메라의 옆면 기울기. 원근 카메라는 0(옆면은 원근이 정한다)
export const VIEW_KX = 0;

export function kyOf(deg: number) {
  'worklet';
  return Math.tan((deg * Math.PI) / 180);
}

export function camAt(deg: number): Cam {
  'worklet';
  const ky = kyOf(deg);
  return { kx: VIEW_KX, ky, eye: { x: VIEW_CX, y: VIEW_DIST * ky, z: 0, dist: VIEW_DIST } };
}

export function clampPitch(deg: number) {
  'worklet';
  return Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, deg));
}

// 기본 보기 카메라(줄 칸 기준). 이 객체는 고치지 않는다(워클릿으로 넘어가면 복사된다).
export const BASE_CAM: Cam = camAt(VIEW_PITCH_MIN);

// 같은 보기 각에서 눈을 가로로 옮긴 카메라(선반 밖에서 한 권만 그릴 때: 그 책 가운데에서 본다)
export function camCenteredAt(cam: Cam, x: number): Cam {
  'worklet';
  return cam.eye ? { ...cam, eye: { ...cam.eye, x } } : cam;
}

// 선반 공간 → 화면 방향(설계 단위, 원점 = 책 기준선 왼쪽 끝, 아래가 +)
export function project(cam: Cam, v: Vec3): Point {
  'worklet';
  if (cam.eye) {
    const e = cam.eye;
    const d = 1 + (v.z - e.z) / e.dist;
    return { x: e.x + (v.x - e.x) / d, y: -(e.y + (v.y - e.y) / d) };
  }
  return { x: v.x + v.z * cam.kx, y: -(v.y + v.z * cam.ky) };
}

// 그 자리(선반 공간 점 p)에서 본 사선 값: 깊이 1당 화면 변화(눈 쪽으로 가는 방향). 사선 카메라는 어디서나 같다.
// 면이 보이는지(법선이 (kx, ky, -1) 쪽), 가림 순서, 반사광 방향이 쓴다.
export function viewAt(cam: Cam, p: Vec3): { kx: number; ky: number } {
  'worklet';
  if (!cam.eye) return { kx: cam.kx, ky: cam.ky };
  const e = cam.eye;
  const r = e.dist + p.z - e.z;
  return { kx: (e.x - p.x) / r, ky: (e.y - p.y) / r };
}

// 설계 단위 → 캔버스 px: X = x·s + tx, Y = y·s + ty. 한 줄의 tx·ty = 그 줄 책 기준선 왼쪽 끝의 캔버스 위치.
export type Affine = { s: number; tx: number; ty: number };

export function toPx(cam: Cam, px: Affine, v: Vec3): Point {
  'worklet';
  const q = project(cam, v);
  return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty };
}

// 방향(길이 있는 벡터)의 화면 변화량(설계 단위, 사선 근사: 원근 카메라는 판 높이·줄 가운데 값)
export function projectDir(cam: Cam, v: Vec3): Point {
  'worklet';
  return { x: v.x + v.z * cam.kx, y: -(v.y + v.z * cam.ky) };
}

// 사용자 쪽에서 벽 쪽으로 가는 시선 방향(화면의 한 점으로 모이는 3D 방향): (-kx, -ky, 1). p를 주면 그 자리 값
export function viewDir(cam: Cam, p?: Vec3): Vec3 {
  'worklet';
  const k = p ? viewAt(cam, p) : cam;
  return { x: -k.kx, y: -k.ky, z: 1 };
}

// 면이 카메라를 향하는 정도(바깥 법선 n, 길이 1): > 0이면 보인다. p를 주면 그 자리에서 본다
export function facingOf(cam: Cam, n: Vec3, p?: Vec3) {
  'worklet';
  const k = p ? viewAt(cam, p) : cam;
  const l = Math.hypot(k.kx, k.ky, 1);
  return (n.x * k.kx + n.y * k.ky - n.z) / l;
}
