import { memo, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';

// Fibres stay fixed to each sheet. Incommensurate repeats keep the fine grain,
// longer fibres and pressed pulp from forming a visible tile at reading size.
export const BookmarkPaper = memo(function BookmarkPaper({ color, radius, seed, tape = false, colored = false }: {
  color: string; radius: number; seed: string; tape?: boolean; colored?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const grain = useMemo(() => {
    let state = 4129;
    for (const c of seed) state = (Math.imul(state, 31) + c.charCodeAt(0)) >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    let fine = '', broad = '', pulp = '', cloud = '';
    for (let i = 0; i < 290; i++) {
      const x = random() * 64, y = random() * 64;
      const dx = 0.35 + random() * 1.6, dy = (random() - 0.5) * 1.4;
      fine += `M${x.toFixed(2)} ${y.toFixed(2)}q${(dx * 0.48).toFixed(2)} ${(dy - 0.32).toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)}`;
    }
    for (let i = 0; i < 92; i++) {
      const x = random() * 91, y = random() * 91;
      broad += `M${x.toFixed(2)} ${y.toFixed(2)}q1.1 -.7 ${(1.7 + random() * 2.4).toFixed(2)} ${((random() - 0.5) * 1.8).toFixed(2)}`;
    }
    for (let i = 0; i < 150; i++) {
      const x = random() * 137, y = random() * 137;
      const w = .7 + random() * 2.1, h = .35 + random() * .9;
      pulp += `M${x.toFixed(2)} ${y.toFixed(2)}q${(w * .4).toFixed(2)} ${(-h).toFixed(2)} ${w.toFixed(2)} 0q${(-w * .35).toFixed(2)} ${(h * .8).toFixed(2)} ${(-w).toFixed(2)} 0Z`;
    }
    for (let i = 0; i < 26; i++) {
      const x = random() * 137, y = random() * 137;
      const w = 3 + random() * 5, h = 1.5 + random() * 3;
      cloud += `M${x.toFixed(2)} ${y.toFixed(2)}q${(w * .45).toFixed(2)} ${(-h).toFixed(2)} ${w.toFixed(2)} 0q${(-w * .25).toFixed(2)} ${(h * .85).toFixed(2)} ${(-w).toFixed(2)} 0Z`;
    }
    return { fine, broad, pulp, cloud };
  }, [seed]);
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={`${id}wash`} x1="0" y1="0" x2="75%" y2="100%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={colored ? 0.10 : 0.20} />
          <Stop offset="0.42" stopColor="#FFFFFF" stopOpacity="0" />
          <Stop offset="1" stopColor={colored ? '#536575' : '#A58A73'} stopOpacity={colored ? 0.045 : 0.022} />
        </LinearGradient>
        <Pattern id={`${id}fine`} width="64" height="64" patternUnits="userSpaceOnUse">
          <Path d={grain.fine} stroke={colored ? '#52616A' : '#87725C'} strokeWidth={tape ? 0.55 : 0.35} strokeOpacity={tape ? 0.115 : colored ? 0.20 : 0.12} fill="none" />
          <Path d={grain.fine} transform="translate(.2 .3)" stroke="#FFFFFF" strokeWidth={tape ? 0.65 : 0.45} strokeOpacity={tape ? 0.19 : colored ? 0.25 : 0.17} fill="none" />
        </Pattern>
        <Pattern id={`${id}soft`} width="91" height="91" patternUnits="userSpaceOnUse">
          <Path d={grain.broad} stroke={colored ? '#526570' : '#8E765C'} strokeWidth={tape ? 1.4 : 0.8} strokeOpacity={tape ? 0.036 : colored ? 0.06 : 0.04} strokeLinecap="round" fill="none" />
          <Path d={grain.broad} transform="translate(.15 .35)" stroke="#FFFFFF" strokeWidth={0.65} strokeOpacity={colored ? 0.075 : 0.045} strokeLinecap="round" fill="none" />
        </Pattern>
        <Pattern id={`${id}pulp`} width="137" height="137" patternUnits="userSpaceOnUse">
          <Path d={grain.cloud} fill={colored ? '#526570' : '#9A8268'} fillOpacity={colored ? 0.028 : 0.014} />
          <Path d={grain.cloud} transform="translate(23 51)" fill="#FFFFFF" fillOpacity={colored ? 0.05 : 0.035} />
          <Path d={grain.pulp} fill={colored ? '#53616B' : '#8E765C'} fillOpacity={colored ? 0.035 : 0.025} />
          <Path d={grain.pulp} transform="translate(37 19)" fill="#FFFFFF" fillOpacity={colored ? 0.085 : 0.055} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={color} />
      <Rect width="100%" height="100%" fill={`url(#${id}wash)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}soft)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}pulp)`} />
      <Rect width="100%" height="100%" fill={`url(#${id}fine)`} />
    </Svg>
  </View>;
});
