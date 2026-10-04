import { Canvas, ColorMatrix, Image } from '@shopify/react-native-skia';
import { useBookShared } from './book3d/art';
import marks from './art/reference-ui.generated.json';

export type ReferenceMark = keyof typeof marks;
// Fixed Korean interface marks retain their drawn letterforms. Accessibility
// remains on the native heading and tab buttons, and selected states recolor.
export function ReferenceUI({ name, width, height, color }: { name: ReferenceMark; width: number; height: number; color?: string }) {
  const { original }=useBookShared();
  const mark=marks[name];
  const [x,y,w,h]=mark.bounds;
  const [r,g,b]=color ? [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255) : mark.ink.map(c=>c/255);
  const matrix=[0,0,0,0,r,0,0,0,0,g,0,0,0,0,b,mark.alpha[0],0,0,0,mark.alpha[1]];
  return <Canvas style={{width,height}} pointerEvents="none" accessible={false}>
    {original ? <Image image={original} x={-x*width/w} y={-y*height/h} width={original.width()*width/w} height={original.height()*height/h} fit="fill"><ColorMatrix matrix={matrix}/></Image> : null}
  </Canvas>;
}
