import { ColorMatrix, Group, Image, Skia, type SkCanvas, type SkFont, type SkImage } from '@shopify/react-native-skia';
import prints from '@/ui/art/reference-print.generated.json';
import motifs from '@/ui/art/reference-motifs.generated.json';
import glyphs from '@/ui/art/reference-glyphs.generated.json';

type Ink = { bounds: number[]; alpha: number[]; color?: string | null };
type Face = { face: number[]; decoration: Ink[] };
type Print = Face & { pose: string; title: Ink; motif: string; registration?: number[] };
export const ORIGINAL_ART = require('../../../assets/reference/bookshelf-original.png');
export function referencePrint(title: string): Print | undefined {
  return (prints as Record<string, Print>)[title];
}

function inkMatrix(layer: Ink, color: string) {
  const [r,g,b] = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255);
  const [a0,a1,a2,offset] = layer.alpha;
  return [0,0,0,0,r,0,0,0,0,g,0,0,0,0,b,a0,a1,a2,0,offset];
}
function InkLayer({ image, layer, color }: { image: SkImage; layer: Ink; color: string }) {
  const [x,y,w,h] = layer.bounds;
  return <Group clip={Skia.XYWHRect(x,y,w,h)}>
    <Image image={image} x={0} y={0} width={image.width()} height={image.height()} fit="fill">
      <ColorMatrix matrix={inkMatrix(layer,color)} />
    </Image>
  </Group>;
}

export function drawOriginalGlyph(canvas: SkCanvas, image: SkImage, text: string, font: SkFont, x: number, y: number, color: string) {
  const layer=(glyphs as Record<string,Ink>)[text];
  if (!layer) return false;
  const b=font.measureText(text);
  const [sx,sy,w,h]=layer.bounds;
  const paint=Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(inkMatrix(layer,color)));
  canvas.drawImageRect(image,Skia.XYWHRect(sx,sy,w,h),Skia.XYWHRect(x+b.x,y+b.y,b.width,b.height),paint,false);
  return true;
}

export function ReferenceGlyph({ image, text, font, x, y, color }: { image: SkImage; text: string; font: SkFont; x: number; y: number; color: string }) {
  const layer=(glyphs as Record<string,Ink>)[text];
  if (!layer) return null;
  const b=font.measureText(text), [sx,sy,w,h]=layer.bounds;
  return <Group matrix={[b.width/w,0,x+b.x-sx*b.width/w,0,b.height/h,y+b.y-sy*b.height/h,0,0,1]}><InkLayer image={image} layer={layer} color={color} /></Group>;
}
export const hasOriginalGlyph = (text: string) => text in glyphs;

// Preserve the original ink's antialiasing instead of thresholding thin strokes.
function faceMatrix(face: number[], w: number, h: number) {
  const [x,y,fw,fh,angle] = face;
  if (angle === 90) return [0,-w/fh,w+y*w/fh,h/fw,0,-x*h/fw,0,0,1];
  const a=angle*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return [c*w/fw,s*w/fw,-(c*x+s*y)*w/fw,-s*h/fh,c*h/fh,(s*x-c*y)*h/fh,0,0,1];
}

export function ReferencePrint({ image, template, w, h, ink, accent, title = true, decoration = true }: { image: SkImage; template: Print; w: number; h: number; ink: string; accent: string; title?: boolean; decoration?: boolean }) {
  return <Group matrix={faceMatrix(template.face,w,h)}>
    {title ? <Group matrix={template.registration}><InkLayer image={image} layer={template.title} color={ink} /></Group> : null}
    {decoration ? template.decoration.map((p,i)=><InkLayer key={i} image={image} layer={p} color={p.color ?? accent} />) : null}
  </Group>;
}

export function hasReferenceMotif(id: string) { return id in motifs; }
export function ReferenceMotif({ image, id, color }: { image: SkImage; id: string; color: string }) {
  const template=(motifs as Record<string,Face>)[id];
  if (!template) return null;
  const [, ,w,h]=template.face, scale=Math.min(24/w,60/h);
  return <Group transform={[{translateX:(24-w*scale)/2},{translateY:(60-h*scale)/2}]}>
    <Group matrix={faceMatrix(template.face,w*scale,h*scale)}>
      {template.decoration.map((p,i)=><InkLayer key={i} image={image} layer={p} color={p.color ?? color} />)}
    </Group>
  </Group>;
}
