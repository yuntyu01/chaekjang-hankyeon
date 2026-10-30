import { colors as shelfColors, fonts as shelfFonts } from './theme';

// Screen UI only: shelf materials, lighting and geometry retain their own tokens.
export const colors = {
  ...shelfColors,
  bg: '#FCFAF7', // 시안보다 한 톤 밝은, 흰색에 가까운 바탕
  // 글자·선 색은 2026-10-16 시안에서 채취: 본문은 거의 검정에 가까운 따뜻한 먹색, 보조 글자는 진한 회갈색, 선은 분홍기 없는 회색
  ink: '#2B2320',
  inkSoft: '#665A53',
  inkFaint: '#A59C95',
  title: '#1F1815',
  rule: '#E3DFD9',
};
export const fonts = { ...shelfFonts, serif: 'ReadingSerif', serifMedium: 'ReadingSerifMedium', serifBold: 'ReadingSerifSemiBold' };
export const screenTheme = {
  paper: '#FCF5EC',
  surface: '#F6F0E6',
  border: '#E6DAC9',
  primary: '#836157',
  blue: '#7298B5',
  blueLight: '#EAECF0',
  radius: 12,
  gap: { page: 24, section: 28, related: 8 },
  shadow: { shadowColor: '#6F5843', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
};
