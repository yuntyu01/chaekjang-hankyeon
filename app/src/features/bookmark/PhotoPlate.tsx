// 사진 갈피의 사진: 흰 테두리를 두른 인화 사진을 마스킹 테이프로 붙인 모양(시안 '사진 갈피').
// 사진은 가로로 긴 틀에 맞춰 자르고(cover), 눌러서 원본 비율 그대로 크게 볼 수 있다.
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { X } from '@/ui/icons';
import { BookmarkPaper } from './BookmarkPaper';

export const photoFrameRatio = (r?: number) => Math.max(0.9, Math.min(1.5, r && r > 0 ? r : 1.35));

export function PhotoPlate({ uri, ratio, width, seed, compact = false, onReady }: { uri: string; ratio?: number; width: number; seed: string; compact?: boolean; onReady?: () => void }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const border = compact ? 4 : 6;
  const frameRatio = photoFrameRatio(compact ? Math.max(ratio ?? 1.35, 1.35) : ratio);
  const innerW = width - border * 2;
  return (
    <View style={{ width, paddingTop: compact ? 8 : 12 }}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="갈피 사진 크게 보기" style={[st.frame, { padding: border, transform: [{ rotate: compact ? '-0.4deg' : '-0.8deg' }] }]}>
        <View style={{ width: innerW, height: innerW / frameRatio, backgroundColor: '#E7E0D2', overflow: 'hidden' }}>
          {failed ? null : <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={onReady} onError={() => { setFailed(true); onReady?.(); }} accessibilityLabel="페이지 사진" />}
          {/* 종이 위 사진처럼 가장자리를 아주 조금 어둡게 */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { boxShadow: [{ inset: true, offsetX: 0, offsetY: 0, blurRadius: 14, color: 'rgba(60,45,30,0.16)' }] } as object]} />
        </View>
      </Pressable>
      <View pointerEvents="none" style={[st.tape, { width: compact ? 62 : 92, height: compact ? 20 : 30, left: width / 2 - (compact ? 31 : 46) + 2, top: compact ? 0 : 0 }]}>
        <BookmarkPaper color="#E4D9BE" tape radius={1.5} seed={`${seed}-washi`} />
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={st.modal} onPress={() => setOpen(false)} accessibilityLabel="닫기">
          <Image source={{ uri }} style={{ width: '100%', height: '82%' }} resizeMode="contain" />
          <View style={st.close}><X size={22} color="#FFFFFF" /></View>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  frame: { backgroundColor: '#FFFDF8', boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 1.6, color: 'rgba(90,66,40,0.2)' }, { offsetX: 1, offsetY: 6, blurRadius: 14, color: 'rgba(110,82,50,0.2)' }] },
  tape: { position: 'absolute', opacity: 0.86, transform: [{ rotate: '-0.8deg' }], overflow: 'hidden', borderRadius: 1.5, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(100,80,50,0.18)' }] },
  modal: { flex: 1, backgroundColor: 'rgba(18,14,10,0.92)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 54, right: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
