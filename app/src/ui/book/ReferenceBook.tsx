import { memo, useId } from 'react';
import Svg, { ClipPath, Defs, G, Image, Polygon } from 'react-native-svg';

import type { ReferenceArt } from '@/domain/types';

const SOURCE = require('../../../assets/reference/books-source.png');

// Crop in the renderer, without inpainting, resizing texture bands, rectangular
// patches, or duplicating the top face. Each book remains an independent node.
export const ReferenceBook = memo(function ReferenceBook({ art, scale, color }: { art: ReferenceArt; scale: number; color: string }) {
  const id = `book${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={art.width * scale} height={art.height * scale} viewBox={`0 0 ${art.width} ${art.height}`}>
      <Defs>
        <ClipPath id={id}>
          <Polygon points={art.outline.map((p) => `${p.x},${p.y}`).join(' ')} />
        </ClipPath>
      </Defs>
      <Polygon points={art.outline.map((p) => `${p.x},${p.y}`).join(' ')} fill={color} />
      <G clipPath={`url(#${id})`}>
        {/* Sample just inside the painted edge to exclude the source wall fringe. */}
        <G transform={`translate(-0.55 -0.55) scale(${(art.width + 1.1) / art.width} ${(art.height + 1.1) / art.height})`}>
          <G transform={`matrix(${art.matrix.join(' ')})`}>
            <Image href={SOURCE} x={0} y={0} width={941} height={1672} />
          </G>
        </G>
      </G>
    </Svg>
  );
});
