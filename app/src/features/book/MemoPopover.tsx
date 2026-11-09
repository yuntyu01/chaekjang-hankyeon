// 메모 작은 상자(전체 책 목록, 2026-11-05 사용자 '메모 아이콘에서 약간 작은 박스가 뜨면서 간단하게'): 아이콘 옆에서 살짝 커지며 뜬다. 바깥을 누르거나 뒤로 가면 닫힌다.
// 화면 아래쪽 아이콘이면 위로 연다. 여기서 읽는 곳이라 최근 메모 몇 개만 보여 준다.
// 메모를 누르면 그 갈피·독서 기록으로, 더 있으면 '책 정보에서 모두 보기'로 간다(2026-11-09 UX 점검: 눌러도 반응이 없는 막다른 상자였다).
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { BookMemo } from '@/features/book/all-books';
import { ymd } from '@/features/book/labels';
import { colors, press, space, type } from '@/ui/theme';

export type MemoAnchor = { x: number; y: number; w: number; h: number };

const BOX_W = 268;
const EDGE = 16;
const ARROW = 12;
const SHOWN = 5;

type Props = { anchor: MemoAnchor | null; memos: BookMemo[]; onClose: () => void; onOpen: (m: BookMemo) => void; onMore: () => void };

export function MemoPopover({ anchor, memos, onClose, onOpen, onMore }: Props) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const open = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    open.setValue(0);
    if (anchor) Animated.timing(open, { toValue: 1, duration: reduce ? 0 : 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [anchor, open, reduce]);
  if (!anchor) return null;
  const below = anchor.y + anchor.h / 2 < height * 0.6;
  const right = Math.max(EDGE, width - anchor.x - anchor.w);
  // 뾰족한 끝이 아이콘 가운데를 가리키게
  const arrowRight = Math.max(10, width - anchor.x - anchor.w / 2 - right - ARROW / 2);
  const place = below ? { top: anchor.y + anchor.h + 2 } : { bottom: height - anchor.y + 2 };
  const rest = memos.length - SHOWN;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="메모 닫기" />
      <Animated.View
        accessibilityViewIsModal
        style={[st.box, place, { right, opacity: open, transformOrigin: below ? 'right top' : 'right bottom', transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <View style={[st.arrow, below ? st.arrowTop : st.arrowBottom, { right: arrowRight }]} />
        <ScrollView style={st.scroll} contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
          {memos.slice(0, SHOWN).map((m) => {
            const kind = m.kind === 'bookmark' ? '갈피' : '독서 기록';
            return (
              <Pressable key={m.id} onPress={() => onOpen(m)} accessibilityRole="button" accessibilityLabel={`${m.text}, ${ymd(m.at)} ${kind}. 눌러서 열기`} style={({ pressed }) => [st.row, pressed && press]}>
                <Text style={[type.sub, { color: colors.ink }]} numberOfLines={4}>{m.text}</Text>
                <Text style={[type.caption, { marginTop: 3 }]}>{ymd(m.at)} · {kind}</Text>
              </Pressable>
            );
          })}
          {rest > 0 ? (
            <Pressable onPress={onMore} accessibilityRole="button" style={({ pressed }) => [st.row, pressed && press]}>
              <Text style={[type.caption, { color: colors.inkSoft }]}>그 밖에 {rest}개 · 책 정보에서 모두 보기</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  box: { position: 'absolute', width: BOX_W, backgroundColor: colors.bg, borderRadius: 12, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: 'rgba(25,31,40,0.18)' }] },
  arrow: { position: 'absolute', width: ARROW, height: ARROW, backgroundColor: colors.bg, transform: [{ rotate: '45deg' }] },
  arrowTop: { top: -ARROW / 2 + 1 },
  arrowBottom: { bottom: -ARROW / 2 + 1 },
  scroll: { maxHeight: 260, borderRadius: 12 },
  content: { paddingHorizontal: space.m, paddingVertical: space.xs },
  row: { paddingVertical: space.s }, // 메모마다 누르는 줄(줄 사이 간격이 곧 누르는 곳)
});
