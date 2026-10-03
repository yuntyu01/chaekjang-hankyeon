import { memo, useId, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

// A small piece of washi, in 44 x 45 material coordinates. The silhouette,
// fibres and shadows use the same coordinates, including in a shared image.
export const BookmarkTape = memo(function BookmarkTape({ color, seed, width, height, paperEdge = 13 }: {
  color: string; seed: string; width: number; height: number; paperEdge?: number;
}) {
  const id = `tape${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const material = useMemo(() => {
    let state = 1729;
    for (const c of seed) state = (Math.imul(state, 31) + c.charCodeAt(0)) >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const n = (v: number) => v.toFixed(2);
    const edge: { x: number; y: number }[] = [];
    for (let x = 41.8; x > 2; x -= 2.25) edge.push({ x, y: 43.55 + random() * 0.9 });
    const torn = `M43.15 42.8Q43.05 43.65 41.8 ${n(edge[0].y)}${edge.slice(1).map(p => `L${n(p.x)} ${n(p.y)}`).join('')}L1.6 44Q.5 43.9 .62 42.6`;
    const shape = `M2.1 .9Q.8 .8 .75 2.2L.45 13.8Q.75 27 .62 42.6L1.6 44${[...edge].reverse().map(p => `L${n(p.x)} ${n(p.y)}`).join('')}Q43.05 43.65 43.15 42.8Q43.05 32 43.45 22L43.65 2.4Q43.65 .65 42 .65Q23 .3 2.1 .9Z`;
    let short = '', long = '', pulp = '', flecks = '', fringe = '';
    for (let i = 0; i < 340; i++) {
      const x = random() * 44, y = random() * 45;
      const dx = (0.6 + random() * 2.2) * (random() > .25 ? 1 : -1), dy = (random() - .5) * 1.8;
      short += `M${n(x)} ${n(y)}q${n(dx * .5)} ${n(dy - .35)} ${n(dx)} ${n(dy)}`;
    }
    for (let i = 0; i < 62; i++) {
      const x = random() * 44, y = random() * 45, dx = 2 + random() * 4;
      long += `M${n(x)} ${n(y)}q${n(dx * .4)} ${n((random() - .5) * 3)} ${n(dx)} ${n((random() - .5) * 2)}`;
    }
    for (let i = 0; i < 100; i++) {
      const x = random() * 44, y = random() * 45, r = .35 + random() * .7;
      pulp += `M${n(x)} ${n(y)}q${n(r)} ${n(-r)} ${n(r * 2.2)} 0q${n(-r)} ${n(r)} ${n(-r * 2.2)} 0Z`;
      flecks += `M${n(random() * 44)} ${n(random() * 45)}l.24 .16`;
    }
    for (const p of edge) fringe += `M${n(p.x)} ${n(p.y - .15)}l${n((random() - .5) * .7)} ${n(.22 + random() * .45)}`;
    return { shape, torn, short, long, pulp, flecks, fringe };
  }, [seed]);
  const join = paperEdge / height * 45;
  return <View pointerEvents="none" accessible={false} style={{ width, height }}>
    <Svg width={width * 68 / 44} height={height * 69 / 45} viewBox="-12 -8 68 69" style={{ position: 'absolute', left: -12 * width / 44, top: -8 * height / 45 }}>
      <Defs>
        <ClipPath id={`${id}face`}><Path d={material.shape} /></ClipPath>
        <ClipPath id={`${id}paper`}><Rect x={-12} y={join} width={68} height={55} /></ClipPath>
        <LinearGradient id={`${id}light`} x1="0" y1="0" x2="60%" y2="100%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.18} />
          <Stop offset="0.25" stopColor="#FFFFFF" stopOpacity={0.015} />
          <Stop offset="0.75" stopColor="#384D57" stopOpacity={0.045} />
          <Stop offset="1" stopColor="#FFF6E9" stopOpacity={0.16} />
        </LinearGradient>
        <LinearGradient id={`${id}pressed`} x1="0" y1="0" x2="0" y2="100%">
          <Stop offset="0" stopColor="#50606A" stopOpacity={0} />
          <Stop offset="0.4" stopColor="#50606A" stopOpacity={0.065} />
          <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0.065} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {/* Nested low-opacity contours soften the cast shadow without a bitmap
          filter, so Android captures and enlarged vectors use the same falloff. */}
      <G clipPath={`url(#${id}paper)`}>
        {[10, 8.5, 7, 5.5, 4, 2.5, 1, 0].map((spread, i) => <Path key={spread} d={material.shape} transform="translate(.8 2.7)" fill="#94765B" stroke="#94765B" strokeWidth={spread} strokeLinejoin="round" opacity={.012 + i * .001} />)}
        {[5, 3.5, 2, .5].map(spread => <Path key={spread} d="M2 40Q22 42.5 42 39.8L42 44.1Q21 45.8 2 44.7Z" transform="translate(.6 1.2)" fill="#89705A" stroke="#89705A" strokeWidth={spread} strokeLinejoin="round" opacity={.026} />)}
      </G>
      <Path d={material.shape} transform="translate(.3 .8)" fill="#6E6255" fillOpacity={0.17} stroke="#6E6255" strokeWidth={.7} strokeOpacity={.06} />
      <Path d={material.shape} fill={color} />
      <G clipPath={`url(#${id}face)`}>
        <Rect width={44} height={45} fill={`url(#${id}light)`} />
        <Path d={material.pulp} fill="#46606A" fillOpacity={0.045} />
        <Path d={material.short} stroke="#4D6269" strokeWidth={0.38} strokeOpacity={0.13} strokeLinecap="round" fill="none" />
        <Path d={material.short} transform="translate(.12 .22)" stroke="#F6F3E8" strokeWidth={0.42} strokeOpacity={0.18} strokeLinecap="round" fill="none" />
        <Path d={material.long} stroke="#61747A" strokeWidth={0.36} strokeOpacity={0.11} strokeLinecap="round" fill="none" />
        <Path d={material.long} transform="translate(0 .3)" stroke="#FFFCF0" strokeWidth={0.42} strokeOpacity={0.15} strokeLinecap="round" fill="none" />
        <Path d={material.flecks} stroke="#334B56" strokeWidth={0.45} strokeOpacity={0.11} strokeLinecap="round" />
        <Rect x={0} y={join - 2.2} width={44} height={4.4} fill={`url(#${id}pressed)`} />
      </G>
      {/* A thin lit upper edge and the exposed torn fibres; no heavy outline. */}
      <Path d="M.9 12L1.2 2.7Q1.3 1.3 3 1.35Q24 .8 41.8 1.1" stroke="#FFFCEF" strokeWidth={0.65} strokeOpacity={0.52} strokeLinecap="round" fill="none" />
      <Path d={material.torn} stroke="#566B70" strokeWidth={0.55} strokeOpacity={0.38} strokeLinejoin="round" fill="none" />
      <Path d={material.torn} transform="translate(0 -.65)" stroke="#FFF5E6" strokeWidth={0.5} strokeOpacity={0.34} fill="none" />
      <Path d={material.fringe} stroke="#F5F0DF" strokeWidth={0.3} strokeOpacity={0.55} strokeLinecap="round" />
    </Svg>
  </View>;
});
