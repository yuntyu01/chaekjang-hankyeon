import { Rect } from '@shopify/react-native-skia';
import { type Binding } from '@/domain/binding-material';

// 재질 색 한 가지. 뽑아 온 띠에는 시안 그림의 빛(가로 명암)이 들어 있어 쓰지 않는다: 빛·결은 그릴 때 빛 셰이더가 장정 재질로 계산한다
export function ReferenceBinding({ material, w, h }: { material: Binding; w: number; h: number; s?: number }) {
  return <Rect x={0} y={0} width={w} height={h} color={material.colors[Math.floor(material.colors.length / 2)]} />;
}
