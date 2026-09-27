// 자동 생성: app/scripts/extract-body-assets.py. 직접 고치지 말 것.
// [임시 자산] 시안 원본에서 뽑은 평평한 재료(색·모티프·책등 그림·표지 그림·붓결). 최종 재장정 아트로 교체한다.

export type BodyArt = { face: string; motif: number; motifTop: number; motifBottom: number; motifCx: number; scene: boolean };
export type CoverArt = { image: number; titleTop: number; ink: string; edge: string };

export const BRUSH_DETAIL = require('../../assets/body/brush-detail.png');
export const BRUSH_TILE_PX = 256; // 원본 px(시안 941px 폭 기준)

export const BODY_ART: Record<string, BodyArt> = {
  b01: { face: '#FBEDDD', motif: require('../../assets/body/motif/b01.png'), motifTop: 0.4987, motifBottom: 0.8483, motifCx: 0.5383, scene: false },
  b02: { face: '#3D5F57', motif: require('../../assets/body/motif/b02.png'), motifTop: 0.5, motifBottom: 0.9479, motifCx: 0.5342, scene: false },
  b03: { face: '#F9E9D6', motif: require('../../assets/body/motif/b03.png'), motifTop: 0.6168, motifBottom: 0.9898, motifCx: 0.5284, scene: true },
  b05: { face: '#BE5D47', motif: require('../../assets/body/motif/b05.png'), motifTop: 0.5693, motifBottom: 0.9158, motifCx: 0.7123, scene: false },
  b17: { face: '#B4C8D6', motif: require('../../assets/body/motif/b17.png'), motifTop: 0.6183, motifBottom: 0.9288, motifCx: 0.7711, scene: false },
  b06: { face: '#FAEDDE', motif: require('../../assets/body/motif/b06.png'), motifTop: 0.4986, motifBottom: 0.9237, motifCx: 0.6797, scene: true },
  b08: { face: '#B5C7D7', motif: require('../../assets/body/motif/b08.png'), motifTop: 0.5196, motifBottom: 0.9896, motifCx: 0.5245, scene: true },
  b09: { face: '#F8E8D4', motif: require('../../assets/body/motif/b09.png'), motifTop: 0.6425, motifBottom: 0.9785, motifCx: 0.5305, scene: true },
  b10: { face: '#1D426B', motif: require('../../assets/body/motif/b10.png'), motifTop: 0.7974, motifBottom: 0.9895, motifCx: 0.5244, scene: true },
  b18: { face: '#4E6B60', motif: require('../../assets/body/motif/b18.png'), motifTop: 0.7506, motifBottom: 0.972, motifCx: 0.6754, scene: false },
  b11: { face: '#F8C69F', motif: require('../../assets/body/motif/b11.png'), motifTop: 0.6486, motifBottom: 0.9757, motifCx: 0.6863, scene: false },
  b14: { face: '#893E41', motif: require('../../assets/body/motif/b14.png'), motifTop: 0.678, motifBottom: 0.9492, motifCx: 0.6451, scene: false },
  b15: { face: '#F7E5D0', motif: require('../../assets/body/motif/b15.png'), motifTop: 0.6276, motifBottom: 0.9483, motifCx: 0.5913, scene: false },
  b12: { face: '#E39E8A', motif: require('../../assets/body/motif/b12.png'), motifTop: 0.2, motifBottom: 0.8, motifCx: 0.5, scene: false },
  b13: { face: '#F7E8D5', motif: require('../../assets/body/motif/b13.png'), motifTop: 0.2, motifBottom: 0.8, motifCx: 0.5, scene: false },
};

export const COVER_ART: Record<string, CoverArt> = {
  b04: { image: require('../../assets/body/cover/b04.png'), titleTop: 0.2479, ink: '#69859D', edge: '#1E4260' },
  b07: { image: require('../../assets/body/cover/b07.png'), titleTop: 0.2283, ink: '#58605F', edge: '#435650' },
  b16: { image: require('../../assets/body/cover/b16.png'), titleTop: 0.0696, ink: '#80726E', edge: '#DDAFAF' },
};
