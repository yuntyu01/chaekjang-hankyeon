import { memo, useId } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Pattern, Path, Rect, Stop } from 'react-native-svg';

// Static vector material: no animation loop, bitmap of a screen, or text baked in.
let grainSeed = 4129;
const random = () => { grainSeed = (grainSeed * 1664525 + 1013904223) >>> 0; return grainSeed / 4294967296; };
const fibers = Array.from({ length: 190 }, (_, i) => {
  const x = random() * 64;
  const y = random() * 64;
  return `M${x.toFixed(2)} ${y.toFixed(2)}l${(0.22 + i % 4 * 0.14).toFixed(2)} ${i % 2 ? '.16' : '-.12'}`;
}).join('');

export const PaperSurface = memo(function PaperSurface({ color = '#FCF5EC', radius = 10, grain = 0.055, shaded = true, pigmented = false }: { color?: string; radius?: number; grain?: number; shaded?: boolean; pigmented?: boolean }) {
  const id = useId().replace(/:/g, '');
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={`${id}wash`} x1="0" y1="0" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={pigmented ? 0.13 : 0.38} />
          <Stop offset="0.38" stopColor="#FFFFFF" stopOpacity="0.02" />
          <Stop offset="1" stopColor={pigmented ? '#536574' : '#AB8056'} stopOpacity={pigmented ? 0.085 : 0.035} />
        </LinearGradient>
        <Pattern id={`${id}fiber`} width="64" height="64" patternUnits="userSpaceOnUse">
          <Path d={fibers} stroke="#6F5641" strokeWidth="0.3" strokeOpacity={grain} />
          <Path d={fibers} transform="translate(0.6 0.7)" stroke="#FFFFFF" strokeWidth="0.45" strokeOpacity={grain * 1.7} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={color} />
      {shaded ? <Rect width="100%" height="100%" fill={`url(#${id}wash)`} /> : null}
      <Rect width="100%" height="100%" fill={`url(#${id}fiber)`} />
    </Svg>
    <Image source={require('../../assets/bookshelf/paper-background.png')} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: pigmented ? 0.035 : Math.min(0.28, grain * 3) }]} />
  </View>;
});

export const ButtonShading = memo(function ButtonShading({ radius = 14 }: { radius?: number }) {
  const id = useId().replace(/:/g, '');
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
    <Svg width="100%" height="100%"><Defs><LinearGradient id={id} x1="0" y1="0" x2="100%" y2="100%"><Stop offset="0" stopColor="#573F4C" stopOpacity="0.09" /><Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.012" /><Stop offset="1" stopColor="#E1C9AC" stopOpacity={radius > 25 ? 0.065 : 0.16} /></LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${id})`} /></Svg>
  </View>;
});
