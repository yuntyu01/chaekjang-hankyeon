import { DEFAULT_SKIN, parseSkin, skinToString } from '@/scene-config/skin';

describe('스토어에서 고른 스킨 저장값', () => {
  it('저장한 값을 그대로 되읽는다', () => {
    const c = { plank: 'walnut', frame: 'none', wall: 'sage' } as const;
    expect(parseSkin(skinToString(c))).toEqual(c);
  });
  it('모르는 값이나 빈 값은 버린다', () => {
    expect(parseSkin(null)).toBeNull();
    expect(parseSkin('')).toBeNull();
    expect(parseSkin('없는선반,white,white')).toBeNull();
    expect(parseSkin('pine,white')).toBeNull();
  });
  it('기본 스킨도 저장값으로 오갈 수 있다', () => {
    expect(parseSkin(skinToString(DEFAULT_SKIN))).toEqual(DEFAULT_SKIN);
  });
});
