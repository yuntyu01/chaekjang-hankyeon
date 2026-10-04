import { project, type Cam } from './camera';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_X0, SHELF_X1 } from './geometry';

// The reference shelf has a narrow rear edge and broad front edge. Its front
// stays fixed, including the touch band; the top recedes by 7% toward the wall.
export function shelfViewCam(cam: Cam): Cam {
  'worklet';
  const center = project(cam, { x: (SHELF_X0 + SHELF_X1) / 2, y: 0, z: -SHELF_FRONT });
  return { ...cam, taper: { x: center.x, y: center.y, z: -SHELF_FRONT, strength: (1 / 0.93 - 1) / (SHELF_DEPTH + SHELF_FRONT) } };
}
