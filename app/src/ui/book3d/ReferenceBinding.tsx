import { Group, Rect } from '@shopify/react-native-skia';
import { type Binding } from '@/domain/binding-material';
import { MaterialGrain } from './MaterialGrain';

// 재질 색 한 가지 + 결. 뽑아 온 띠에는 시안 그림의 빛(가로 명암)이 들어 있어 쓰지 않는다: 빛은 그릴 때 빛 모델이 계산한다
export function ReferenceBinding({ material, w, h, s }: { material: Binding; w: number; h: number; s: number }) {
  return <Group>
    <Rect x={0} y={0} width={w} height={h} color={material.colors[Math.floor(material.colors.length / 2)]} />
    <MaterialGrain w={w} h={h} s={s} />
  </Group>;
}
