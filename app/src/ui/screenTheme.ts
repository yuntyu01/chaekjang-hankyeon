import { colors as shelfColors, fonts } from './theme';

// Screen UI only: shelf materials, lighting and geometry retain their own tokens.
export const colors = {
  ...shelfColors,
  bg: '#FCF8F1',
  ink: '#59483F',
  inkSoft: '#918276',
  inkFaint: '#AA9B8B',
  title: '#59483F',
};
export { fonts };
export const screenTheme = {
  paper: '#FFFCF5',
  surface: '#F6F0E6',
  border: '#E6DAC9',
  primary: '#89695D',
  blue: '#A9BCC5',
  blueLight: '#E7ECEB',
  radius: 12,
  gap: { page: 24, section: 28, related: 8 },
  shadow: { shadowColor: '#6F5843', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
};
