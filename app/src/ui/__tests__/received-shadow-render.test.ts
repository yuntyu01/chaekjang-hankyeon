/** @jest-environment node */
import type { Book3 } from '@/domain/book3';
import { receivedShadow3 } from '@/domain/received3';

declare const __dirname: string;
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');
const dir = `${__dirname}/../../../node_modules/canvaskit-wasm/bin/full`;
// CanvasKit's native objects are only used in this raster regression.
let CK: any;
beforeAll(async () => {
  (globalThis as { TextDecoder: unknown }).TextDecoder = require('util').TextDecoder;
  CK = await CanvasKitInit({ locateFile: (f: string) => `${dir}/${f}` });
}, 60000);

it('draws filled rectangular shadows and preserves a separate fading shadow', () => {
  const receiver: Book3 = { id: 'receiver', dims: { T: 100, H: 100, W: 10 }, roll: 0, yaw: 0, t: { x: 0, y: 0, z: 0 } };
  const block: Book3 = { id: 'opaque', dims: { T: 20, H: 20, W: 0.5 }, roll: 0, yaw: 0, t: { x: 10, y: 10, z: -1 } };
  const fading = { ...block, id: 'fading', t: { ...block.t, x: 60 }, alpha: 0.2 };
  // Front-on light gives two known 20×20 rectangular silhouettes on the spine.
  const face = receivedShadow3(receiver, [block, fading], 1, { x: 0, y: 0, z: -1 })!.faces.find((f) => f.f === 'spine')!;
  const surface = CK.MakeSurface(100, 100);
  const paint = new CK.Paint();
  surface.getCanvas().clear(CK.TRANSPARENT);
  try {
    for (const band of face.bands) for (const shadow of band) {
      const builder = new CK.PathBuilder();
      builder.moveTo(shadow.poly[0].x, shadow.poly[0].y);
      for (const p of shadow.poly.slice(1)) builder.lineTo(p.x, p.y);
      builder.close();
      const path = builder.detach();
      builder.delete();
      paint.setColor(CK.Color4f(0, 0, 0, shadow.w));
      const blur = CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, Math.max(0.01, shadow.sigma), true);
      paint.setMaskFilter(blur);
      surface.getCanvas().drawPath(path, paint);
      path.delete();
      blur.delete();
    }
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      const pixels = image.readPixels(0, 0, { width: 100, height: 100, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
      const alpha = (x: number, y: number) => pixels[(y * 100 + x) * 4 + 3] / 255;
      // A self-crossing polygon leaves holes inside this rectangle.
      for (const y of [14, 18, 22, 26]) for (const x of [14, 18, 22, 26]) expect(alpha(x, y)).toBeGreaterThan(0.99);
      expect(alpha(70, 20)).toBeCloseTo(0.2, 2);
      expect(alpha(45, 20)).toBe(0);
    } finally { image.delete(); }
  } finally { paint.delete(); surface.delete(); }
});
