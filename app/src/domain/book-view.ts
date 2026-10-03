import type { Book3, Cam } from './book3';

// Books use the scene camera in every pose. A private elevated camera makes
// a lying cover appear lifted away from its supporting shelf.
export function bookViewCam(cam: Cam, _book: Book3): Cam {
  'worklet';
  return cam;
}
