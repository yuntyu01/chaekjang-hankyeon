// 기기 없이 책 몸체를 PNG로 그려 보는 QA 전용 jest 설정(웹 Skia = CanvasKit).
// 실행: QA_OUT=/tmp/bodies.png npx jest -c scripts/qa/render-bodies.jest.config.js
module.exports = {
  preset: 'jest-expo/web',
  rootDir: '../..',
  testMatch: ['**/scripts/qa/render-bodies.qa.js'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '\\.[jt]sx?$': ['babel-jest', { presets: [require.resolve('expo/node_modules/babel-preset-expo')] }] },
};
