// 갈피 공유 두 모양(2026-11-10 사용자 시안): '책 페이지'와 '종이 메모'. 미리보기 둘 중 하나를 누르면 그 모양을 폭 1080px로 그려 공유창을 연다.
// 그림은 bookmark-scene 한 곳(시안에서 글자를 지운 바탕 + 같은 자리·글꼴의 글자)
import { Canvas, Picture, Skia, createPicture, useFonts, useImage, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/ui/kit';
import { colors, press, space, type } from '@/ui/theme';
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

const LABEL: Record<MarkStyle, string> = { page: '책 페이지', note: '종이 메모' };

export function MarkShareSheet({ visible, onClose, input, assets, busy, onPick, width }: { visible: boolean; onClose: () => void; input: MarkInput; assets: MarkAssets | null; busy: MarkStyle | null; onPick: (s: MarkStyle) => void; width: number }) {
  const w = Math.min(170, (width - space.page * 2 - space.m) / 2);
  return (
    <Sheet visible={visible} onClose={onClose} title="갈피 공유" description="모양을 고르면 이미지로 공유해요">
      <View style={st.row}>
        {(['page', 'note'] as const).map((s) => (
          <Pressable key={s} onPress={busy ? undefined : () => onPick(s)} accessibilityRole="button" accessibilityLabel={`${LABEL[s]} 모양으로 공유`} accessibilityState={{ busy: busy === s }} style={({ pressed }) => [st.item, pressed && press]}>
            <View style={st.thumb}>
              <MarkCard assets={assets} style={s} input={input} width={w} />
              {busy === s ? (
                <View style={st.busy}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}
            </View>
            <Text style={[type.row, { textAlign: 'center', marginTop: space.s }]}>{LABEL[s]}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.m, paddingBottom: space.s },
  item: { alignItems: 'center' },
  thumb: { borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  busy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.5)' },
});
