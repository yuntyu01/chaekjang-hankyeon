import { project, type Cam } from './camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_X0, SHELF_X1 } from './geometry';

// The reference shelf has a narrow rear edge and broad front edge. Its front
// stays fixed, including the touch band; the top recedes by 7% toward the wall.
// 원근 카메라(eye)는 판도 같은 원근으로 그려지므로 그대로 쓴다(예전 사선 카메라에만 판 원근을 덧붙인다).
export function shelfViewCam(cam: Cam): Cam {
  'worklet';
  if (cam.eye) return cam;
  const center = project(cam, { x: (SHELF_X0 + SHELF_X1) / 2, y: 0, z: -SHELF_FRONT });
  return { ...cam, taper: { x: center.x, y: center.y, z: -SHELF_FRONT, strength: (1 / 0.93 - 1) / (SHELF_DEPTH + SHELF_FRONT) } };
}
