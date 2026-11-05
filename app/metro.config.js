// 시작 시간: 모듈을 처음 쓸 때 불러온다(inlineRequires, 2026-11-05 사용자 '앱 시작 고쳐'). 기본값은 꺼져 있어 라우터가 모든 화면과 셰이더 코드까지 시작 때 다 읽었다
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const options = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const base = options ? await options(...args) : {};
  return { ...base, transform: { ...base.transform, inlineRequires: true } };
};
module.exports = config;
