// 화면 공통 기준(2026-10-26 설정 시안): 대비·글자 크기·간격 범위, 글꼴 등록, 화면 코드가 토큰을 벗어나지 않는지.
import { colors, fonts, night, space, type } from '../screenTheme';

// 노드 형식 정의 없이 쓰는 최소한의 fs·path(light-calibration 시험과 같은 방식)
declare const __dirname: string;
declare const require: (m: string) => unknown;
type Dirent = { name: string; isDirectory: () => boolean };
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string; existsSync: (p: string) => boolean; readdirSync: (p: string, o: { withFileTypes: true }) => Dirent[] };
const path = require('path') as { join: (...p: string[]) => string; relative: (a: string, b: string) => string };
const SRC = path.join(__dirname, '..', '..');

// WCAG 상대 휘도 대비
function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// 2026-10-26 색상 기준(갈피 수정 시안): 바탕·입력칸·구분선·버튼 글자는 사용자 지정값, 글자색·대표색은 시안에서 뽑은 값
describe('색: 지정한 기준값', () => {
  it('배경·입력칸·대표색·글자·구분선·버튼 글자', () => {
    expect(colors.bg).toBe('#FEFEFD');
    expect(colors.input).toBe('#F6F5F2');
    expect(colors.accent).toBe('#6C534A');
    expect(colors.ink).toBe('#1A1716');
    expect(colors.inkSoft).toBe('#6A5854');
    expect(colors.title).toBe('#624C47');
    expect(colors.line).toBe('#E8E5E0');
    expect(colors.border).toBe('#E8E5E0');
    expect(colors.onAccent).toBe('#FFFFFF');
  });
  it('화면 배경과 입력칸 배경은 다른 토큰이고, 입력칸은 바탕과 구별된다', () => {
    expect(colors.input).not.toBe(colors.bg);
    expect(contrast(colors.input, colors.bg)).toBeGreaterThan(1.05);
  });
  it('바탕·입력칸·시트·작은 강조 바탕은 노란 크림이나 진한 베이지가 아니다(빨강−파랑 차 10 이하, 밝기 높음)', () => {
    for (const c of [colors.bg, colors.input, colors.surface, colors.raised, colors.accentSoft]) {
      const [r, , b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      expect(r - b).toBeLessThanOrEqual(10);
      expect(lum(c)).toBeGreaterThan(0.8);
    }
  });
  it('비활성·오류는 서로, 그리고 강조색·입력칸과 구별된다', () => {
    expect(new Set([colors.disabled, colors.danger, colors.accent, colors.input]).size).toBe(4);
    expect(contrast(colors.disabled, colors.input)).toBeGreaterThan(1.05);
  });
});

describe('색: 읽을 수 있는 대비', () => {
  it('본문·제목은 바탕·입력칸·시트 위에서 7:1 이상', () => {
    for (const bg of [colors.bg, colors.input, colors.raised]) {
      expect(contrast(colors.ink, bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.title, bg)).toBeGreaterThanOrEqual(7);
    }
  });
  it('강조색·오류색은 바탕·입력칸·시트 위에서 4.5:1 이상', () => {
    for (const bg of [colors.bg, colors.input, colors.raised]) {
      expect(contrast(colors.accent, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.danger, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('보조 글자는 바탕·입력칸·시트 위에서 4.5:1 이상', () => {
    for (const bg of [colors.bg, colors.input, colors.raised]) expect(contrast(colors.inkSoft, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('주요 버튼 글자는 강조색 위에서 4.5:1 이상', () => {
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onAccent, colors.accentPressed)).toBeGreaterThanOrEqual(4.5);
  });
  it('어두운 장면용 밝은 글자는 아주 어두운 바탕(타이머 장면 #182C44)에서 7:1 이상', () => {
    expect(contrast(night.ink, '#182C44')).toBeGreaterThanOrEqual(7);
  });
  it('구분선은 바탕과 구별되지만 옅다(1.1~1.6:1)', () => {
    const c = contrast(colors.line, colors.bg);
    expect(c).toBeGreaterThan(1.1);
    expect(c).toBeLessThan(1.6);
  });
});

describe('글자·간격 범위(지시: 제목 22~24를 출발점으로 시안에 맞춤 → 20~24, 본문·메뉴 16~17, 보조 13~15, 좌우 24~28, 묶음 사이 28~36)', () => {
  it('글자 크기', () => {
    expect(type.title.fontSize).toBeGreaterThanOrEqual(20);
    expect(type.title.fontSize).toBeLessThanOrEqual(24);
    for (const t of [type.row, type.body, type.input, type.button, type.label]) {
      expect(t.fontSize).toBeGreaterThanOrEqual(16);
      expect(t.fontSize).toBeLessThanOrEqual(17);
    }
    for (const t of [type.sub, type.section, type.caption]) {
      expect(t.fontSize).toBeGreaterThanOrEqual(13);
      expect(t.fontSize).toBeLessThanOrEqual(15); // 시안 글자 높이에 맞춰 보조 설명 15(Pretendard)
    }
  });
  it('간격과 터치 크기', () => {
    expect(space.page).toBeGreaterThanOrEqual(24);
    expect(space.page).toBeLessThanOrEqual(28);
    expect(space.section).toBeGreaterThanOrEqual(28);
    expect(space.section).toBeLessThanOrEqual(36);
    expect(space.touch).toBeGreaterThanOrEqual(44);
    expect(space.row).toBeGreaterThanOrEqual(48);
  });
  it('UI 글자는 모두 UI 글꼴(R·B) 가족', () => {
    for (const t of Object.values(type)) expect([fonts.ui, fonts.uiBold]).toContain(t.fontFamily);
  });
});

describe('글꼴 파일·등록', () => {
  it('UI 글꼴(Pretendard) 이름마다 assets 파일이 있고 루트 레이아웃 useFonts에 등록돼 있다', () => {
    const layout = fs.readFileSync(path.join(SRC, 'app', '_layout.tsx'), 'utf8');
    const useFonts = layout.slice(layout.indexOf('useFonts({'));
    const files: Record<string, string> = { PretendardRegular: 'Pretendard-Regular.otf', PretendardMedium: 'Pretendard-Medium.otf', PretendardSemiBold: 'Pretendard-SemiBold.otf' };
    for (const name of [fonts.ui, fonts.uiMedium, fonts.uiBold]) {
      expect(files[name]).toBeDefined();
      expect(fs.existsSync(path.join(SRC, '..', 'assets', 'fonts', files[name]))).toBe(true);
      expect(layout).toContain(`const ${name} = require('../../assets/fonts/${files[name]}')`);
      expect(useFonts.slice(0, useFonts.indexOf('})'))).toContain(name);
    }
  });
});

// 화면 코드 점검: 굵기는 글꼴 파일로 고르고(fontWeight 금지), 색은 토큰으로(hex 글자색 금지).
// 일부러 남긴 예외는 그 줄에 '내용 색'(공유 이미지처럼 밖으로 내보내는 그림) 또는 '측정용'(개발 측정 글자)을 적는다.
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === '__tests__' ? [] : files(path.join(dir, d.name))) : d.name.endsWith('.tsx') ? [path.join(dir, d.name)] : []));
}
// 내용 그림(갈피 종이 카드·사진 판·표지 그림)과 개발용 화면은 따로 된 재질 색을 쓴다
const CONTENT = /(BookmarkCard|BookmarkPaper|BookmarkTape|PhotoPlate|dev-[a-z]+|features[\\/]home[\\/]BookDetail)\.tsx$/;
const screens = [...files(path.join(SRC, 'app')), ...files(path.join(SRC, 'features')), path.join(SRC, 'ui', 'kit.tsx')].filter((f) => !CONTENT.test(f));

describe('화면 코드가 공통 기준을 쓴다', () => {
  it('fontWeight로 굵기를 덧입히지 않는다', () => {
    const bad = screens.filter((f) => /fontWeight\s*:/.test(fs.readFileSync(f, 'utf8')));
    expect(bad.map((f) => path.relative(SRC, f))).toEqual([]);
  });
  it('글자색(color:)을 hex로 따로 적지 않는다', () => {
    const bad = screens.flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => [l, i + 1] as const)
        .filter(([l]) => /[^a-zA-Z]color:\s*'#[0-9A-Fa-f]{3,8}'/.test(l) && !/내용 색|측정용/.test(l))
        .map(([, i]) => `${path.relative(SRC, f)}:${i}`),
    );
    expect(bad).toEqual([]);
  });
  it('fontSize를 쓰는 글자 스타일은 글꼴 토큰(type.* 또는 fonts.*)도 함께 쓴다', () => {
    const bad = screens.flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => [l, i + 1] as const)
        .filter(([l]) => /fontSize\s*:/.test(l) && !/fontFamily|\.\.\.type\.|type\.[a-z]+|\[(s|st|styles)\.[a-zA-Z]+|측정용/.test(l))
        .map(([, i]) => `${path.relative(SRC, f)}:${i}`),
    );
    expect(bad).toEqual([]);
  });
  it('누르는 동안 옅어지는 정도는 숫자로 따로 적지 않고 press 토큰을 쓴다', () => {
    const bad = screens.flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((l, i) => [l, i + 1] as const)
        .filter(([l]) => /pressed\s*(&&[^,\]]*\{\s*opacity\s*:|\?\s*0?\.\d)/.test(l))
        .map(([, i]) => `${path.relative(SRC, f)}:${i}`),
    );
    expect(bad).toEqual([]);
  });
});
