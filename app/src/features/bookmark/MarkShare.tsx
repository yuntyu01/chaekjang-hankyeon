// 갈피 공유 두 모양(2026-11-10 사용자 시안): '책 페이지'와 '종이 메모'. 위에서 모양을 고르면 가운데 큰 미리보기가 바뀌고,
// 아래 '저장'(사진첩)·'공유'(공유창)를 누르면 그 모양을 폭 1080px로 그려 보낸다(11-10 댓글 '가운데 박스, 밑쪽에 다운로드 공유')
// 그림은 bookmark-scene 한 곳(시안에서 글자를 지운 바탕 + 같은 자리·글꼴의 글자)
import { Canvas, Picture, Skia, createPicture, useFonts, useImage, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Btn, Segmented, Sheet } from '@/ui/kit';
import { colors, space } from '@/ui/theme';
import { drawMarkScene, MARK_H, MARK_W, type MarkInput, type MarkStyle } from './bookmark-scene';

const FONT_SOURCES = {
  MarkQuote: [require('../../../assets/fonts/MaruBuri-Regular.ttf')],
  MarkUI: [require('../../../assets/fonts/Pretendard-Regular.otf')],
  MarkUIBold: [require('../../../assets/fonts/Pretendard-SemiBold.otf')],
  MarkSerif: [require('../../../assets/fonts/NotoSerifKR-Regular.otf')],
};

export type MarkAssets = { plates: Record<MarkStyle, SkImage>; fonts: SkTypefaceFontProvider };

export function useMarkAssets(): MarkAssets | null {
  const page = useImage(require('../../../assets/share/bookmark-page.png'));
  const note = useImage(require('../../../assets/share/bookmark-note.png'));
  const fonts = useFonts(FONT_SOURCES);
  return useMemo(() => (page && note && fonts ? { plates: { page, note }, fonts } : null), [page, note, fonts]);
}

// 공유 이미지(PNG base64)
export function renderMarkBase64(A: MarkAssets, style: MarkStyle, input: MarkInput, pxWidth = 1080): string | null {
  const h = Math.round((MARK_H * pxWidth) / MARK_W);
  const surface = Skia.Surface.Make(pxWidth, h);
  if (!surface) return null;
  drawMarkScene(Skia, surface.getCanvas(), pxWidth, style, A.plates[style], A.fonts, input);
  surface.flush();
  return surface.makeImageSnapshot().encodeToBase64();
}

// 한 모양 그림(미리보기·측정용)
export function MarkCard({ assets, style, input, width }: { assets: MarkAssets | null; style: MarkStyle; input: MarkInput; width: number }) {
  const height = (width * MARK_H) / MARK_W;
  const picture = useMemo(
    () => (assets ? createPicture((c) => drawMarkScene(Skia, c, width, style, assets.plates[style], assets.fonts, input), Skia.XYWHRect(0, 0, width, height)) : null),
    [assets, style, input, width, height],
  );
  return (
    <View style={{ width, height, backgroundColor: '#EEECE9' }}>
      {picture ? (
        <Canvas style={{ width, height }} pointerEvents="none">
          <Picture picture={picture} />
        </Canvas>
      ) : null}
    </View>
  );
}

const STYLES = [
  { id: 'page', label: '책 페이지' },
  { id: 'note', label: '종이 메모' },
] as const;

export type MarkAction = 'save' | 'share';

export function MarkShareSheet({
  visible,
  onClose,
  input,
  assets,
  busy,
  saved,
  canSave,
  onAction,
  width,
  height,
}: {
  visible: boolean;
  onClose: () => void;
  input: MarkInput;
  assets: MarkAssets | null;
  busy: MarkAction | null;
  saved: boolean; // 방금 저장함(버튼 글자 '저장했어요')
  canSave: boolean; // 사진첩 저장을 쓸 수 있는 기기
  onAction: (a: MarkAction, s: MarkStyle) => void;
  width: number;
  height: number;
}) {
  const [style, setStyle] = useState<MarkStyle>('page');
  useEffect(() => {
    if (visible) setStyle('page');
  }, [visible]);
  // 가운데 미리보기: 시트 안 폭과, 화면 높이에서 머리·고르기·버튼 자리를 뺀 높이 중 작은 쪽
  const pw = Math.max(160, Math.min(width - space.page * 2, ((height * 0.9 - 250) * MARK_W) / MARK_H, 320));
  return (
    <Sheet visible={visible} onClose={onClose} title="갈피 공유">
      <Segmented items={STYLES} value={style} onChange={setStyle} />
      <View style={st.center}>
        <View style={st.preview}>
          <MarkCard assets={assets} style={style} input={input} width={pw} />
        </View>
      </View>
      <View style={st.actions}>
        {canSave ? <Btn label={saved ? '저장했어요' : '저장'} kind="secondary" busy={busy === 'save'} disabled={!!busy && busy !== 'save'} onPress={() => onAction('save', style)} style={st.action} /> : null}
        <Btn label="공유" busy={busy === 'share'} disabled={!!busy && busy !== 'share'} onPress={() => onAction('share', style)} style={st.action} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: space.l },
  preview: { borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: 'rgba(25,31,40,0.08)' }] },
  actions: { flexDirection: 'row', gap: space.s },
  action: { flex: 1 },
});
