import { DEFAULT_SKIN, parseSkin, savedSkin, setSkinChoice, SKIN, SKIN_CHOICE, skinToString } from '@/scene-config/skin';

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
  // 실행 중 스킨 바꾸기(스토어 미리보기): 저장값이 없을 때 지금 스킨이 기본값 객체 자체면 기본값까지 바뀌어 '바뀐 것 없음'·되돌리기가 틀렸다(2026-11-10 에뮬)
  it('미리보기로 바꿔도 기본값·저장된 스킨은 그대로다', () => {
    expect(setSkinChoice({ plank: 'walnut', frame: 'pine', wall: 'sage' })).toBe(true);
    expect(skinToString(SKIN_CHOICE)).toBe('walnut,pine,sage');
    expect(SKIN.plank.name).toBe('호두나무');
    expect(DEFAULT_SKIN).toEqual({ plank: 'pine', frame: 'white', wall: 'white' });
    expect(savedSkin()).toEqual({ plank: 'pine', frame: 'white', wall: 'white' });
    // 틀 여부가 다르면 실행 중에 못 바꾼다
    expect(setSkinChoice({ plank: 'oak', frame: 'none', wall: 'white' })).toBe(false);
    expect(skinToString(SKIN_CHOICE)).toBe('walnut,pine,sage');
    setSkinChoice(DEFAULT_SKIN);
  });
});
