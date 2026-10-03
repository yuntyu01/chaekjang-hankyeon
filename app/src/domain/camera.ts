// 공통 카메라와 좌표 변환(순수, UI 스레드 워클릿에서도 쓴다). 책·선반·그림자·터치가 모두 이것 하나로 투영한다.
// 선반 공간(한 줄): x 오른쪽(책 줄 왼쪽 끝 0), y 위(판 윗면 0), z 벽 쪽(책 기준선 0, 판 앞 끝 -SHELF_FRONT, 벽 SHELF_DEPTH).
// 직교 투영으로 살짝 내려다본다(사선): 깊이 1이 화면에서 오른쪽 kx, 위로 ky.
//   화면 x = x + z·kx,  화면 y(아래가 +) = -(y + z·ky)   (원점 = 그 줄의 책 기준선 왼쪽 끝)
// 정확한 직교식 -(y·cosφ + z·sinφ)과는 세로 배율(1/cosφ, 3°에서 0.14%)만 다르다.
// 보기 각(pitch)은 카메라만 바꾼다: 책 배치·충돌·줄 간격(3D)은 카메라를 읽지 않는다.
// 워클릿은 만들어질 때 쓰는 함수를 붙잡으므로, 쓰이는 함수를 먼저 정의한다.

export type Cam = { kx: number; ky: number; taper?: { x: number; y: number; z: number; strength: number } };
export type Point = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

// 기본 3°(시안에 가깝게 윗면·옆면을 줄이면서 돌린 눕힌 책의 기울기는 남기는 값), 꾸미기에서 8°까지 내려다본다.
export const VIEW_PITCH_MIN = 3;
export const VIEW_PITCH_MAX = 8;
// 옆면을 조금 보이게 하는 사선(카메라 좌우 회전이 아니다). 모든 책이 같은 쪽 옆면을 보인다.
export const VIEW_KX = 0.012;

export function kyOf(deg: number) {
  'worklet';
  return Math.tan((deg * Math.PI) / 180);
}

export function camAt(deg: number): Cam {
  'worklet';
  return { kx: VIEW_KX, ky: kyOf(deg) };
}

export function clampPitch(deg: number) {
  'worklet';
  return Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, deg));
}

// 기본 보기(3°) 카메라(서랍·상세처럼 선반 밖에서 한 권만 그릴 때, 줄 칸 기준). 이 객체는 고치지 않는다(워클릿으로 넘어가면 복사된다).
export const BASE_CAM: Cam = camAt(VIEW_PITCH_MIN);

// 선반 공간 → 화면 방향(설계 단위, 원점 = 책 기준선 왼쪽 끝, 아래가 +)
export function project(cam: Cam, v: Vec3): Point {
  'worklet';
  let x = v.x + v.z * cam.kx;
  let y = -(v.y + v.z * cam.ky);
  if (cam.taper) {
    const t = cam.taper;
    const d = 1 + (v.z - t.z) * t.strength;
    x=t.x+(x-t.x)/d; y=t.y+(y-t.y)/d;
  }
  return {x,y};
}

// 설계 단위 → 캔버스 px: X = x·s + tx, Y = y·s + ty. 한 줄의 tx·ty = 그 줄 책 기준선 왼쪽 끝의 캔버스 위치.
export type Affine = { s: number; tx: number; ty: number };

export function toPx(cam: Cam, px: Affine, v: Vec3): Point {
  'worklet';
  const q = project(cam, v);
  return { x: q.x * px.s + px.tx, y: q.y * px.s + px.ty };
}

// 방향(길이 있는 벡터)의 화면 변화량(설계 단위): 면 그림 행렬·가림 순서가 쓴다
export function projectDir(cam: Cam, v: Vec3): Point {
  'worklet';
  return { x: v.x + v.z * cam.kx, y: -(v.y + v.z * cam.ky) };
}

// 사용자 쪽에서 벽 쪽으로 가는 시선 방향(화면의 한 점으로 모이는 3D 방향): (-kx, -ky, 1)
export function viewDir(cam: Cam): Vec3 {
  'worklet';
  return { x: -cam.kx, y: -cam.ky, z: 1 };
}

// 면이 카메라를 향하는 정도(바깥 법선 n, 길이 1): > 0이면 보인다
export function facingOf(cam: Cam, n: Vec3) {
  'worklet';
  const l = Math.hypot(cam.kx, cam.ky, 1);
  return (n.x * cam.kx + n.y * cam.ky - n.z) / l;
}
