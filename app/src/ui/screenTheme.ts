import { colors as shelfColors, fonts as shelfFonts } from './theme';

// Screen UI only: shelf materials, lighting and geometry retain their own tokens.
export const colors = {
  ...shelfColors,
  bg: '#FCF6EE',
  ink: '#54433C',
  inkSoft: '#8C8077',
  inkFaint: '#A3978E',
  title: '#51403B',
};
export const fonts = { ...shelfFonts, serif: 'ReadingSerif', serifMedium: 'ReadingSerifMedium', serifBold: 'ReadingSerifSemiBold' };
export const screenTheme = {
  paper: '#FCF5EC',
  surface: '#F6F0E6',
  border: '#E6DAC9',
  primary: '#87685F',
  blue: '#7298B5',
  blueLight: '#EAECF0',
  radius: 12,
  gap: { page: 24, section: 28, related: 8 },
  shadow: { shadowColor: '#6F5843', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
};
