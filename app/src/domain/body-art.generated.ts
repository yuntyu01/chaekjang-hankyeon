// 자동 생성: app/scripts/extract-body-assets.py. 직접 고치지 말 것.
// [임시 자산] 시안 원본에서 뽑은 책 몸체 재료(색·모티프·붓결). 최종 재장정 아트로 교체한다.

export type BodyArt = { face: string; motif: number; motifTop: number; motifBottom: number; motifCx: number };

export const BRUSH_DETAIL = require('../../assets/body/brush-detail.png');
export const BRUSH_TILE_PX = 256; // 원본 px(시안 941px 폭 기준)

export const BODY_ART: Record<string, BodyArt> = {
  b02: { face: '#3C5E57', motif: require('../../assets/body/motif/b02.png'), motifTop: 0.4868, motifBottom: 0.9496, motifCx: 0.5357 },
};
