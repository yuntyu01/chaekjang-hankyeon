// 책을 꾹 눌렀다 움직이지 않고 떼면 책 밑에 뜨는 작은 도구 막대: 좌우 돌리기, 표지↔책등, 서랍.
// 돌리기 한 번 = 한 단계(기울임 → 똑바로 → 반대 기울임 → 눕힘). 바깥을 누르면 닫힌다.
import { Archive, BookOpen, RotateCcw, RotateCw } from 'lucide-react-native';
import { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { Pose } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { colors } from '@/ui/theme';

export type ToolsAnchor = { cx: number; y: number; below: boolean }; // 뷰포트 px. below면 y가 막대 윗끝, 아니면 아랫끝

const W = 236;
const H = 52;

export function BookTools({
  anchor,
  pose,
  width,
  msg,
  reduceMotion,
  onRotate,
  onCover,
  onDrawer,
  onClose,
}: {
  anchor: ToolsAnchor;
  pose: Pose;
  width: number;
  msg: string | null;
  reduceMotion: boolean;
  onRotate: (dir: -1 | 1) => void;
  onCover: () => void;
  onDrawer: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  const left = Math.max(12, Math.min(width - 12 - W, anchor.cx - W / 2));
  const top = anchor.below ? anchor.y : anchor.y - H;
  const tools: { key: string; label: string; icon: React.ReactNode; onPress: () => void }[] = [
    { key: 'l', label: ko.tools.left, icon: <RotateCcw size={20} color={colors.ink} />, onPress: () => onRotate(-1) },
    { key: 'r', label: ko.tools.right, icon: <RotateCw size={20} color={colors.ink} />, onPress: () => onRotate(1) },
    { key: 'c', label: pose === 'front' ? ko.tools.spine : ko.tools.cover, icon: <BookOpen size={20} color={colors.ink} />, onPress: onCover },
    { key: 'd', label: ko.placeShort.drawer, icon: <Archive size={20} color={colors.ink} />, onPress: onDrawer },
  ];
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="닫기" />
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(120)}
        exiting={reduceMotion ? undefined : FadeOut.duration(90)}
        style={[styles.bar, { left, top, width: W, height: H }]}>
        {tools.map((t) => (
          <Pressable key={t.key} onPress={t.onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={t.label} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
            {t.icon}
            <Text style={styles.label}>{t.label}</Text>
          </Pressable>
        ))}
      </Animated.View>
      {msg ? (
        <View style={[styles.msg, { left, width: W, top: anchor.below ? top + H + 6 : top - 28 }]} pointerEvents="none">
          <Text style={styles.msgText}>{msg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    backgroundColor: colors.sheet,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: 4,
  },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 10 },
  pressed: { backgroundColor: colors.line },
  label: { fontSize: 10.5, color: colors.inkSoft },
  msg: { position: 'absolute', alignItems: 'center' },
  msgText: { fontSize: 12, color: colors.danger, backgroundColor: colors.sheet, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
});
