// 공통 화면 부품. 아이보리 종이 바탕, 먹색 글자, 제목은 명조, 메뉴·숫자는 고딕(시스템). 색은 책에서 온다.
import { router } from 'expo-router';
import { ChevronLeft, Star } from '@/ui/icons';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MINI_TIMER_SPACE, miniTimerStore } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { PaperSurface } from '@/ui/PaperSurface';

export const ui = {
  pad: 20,
  radius: 12,
  card: '#FFFDF8',
  soft: '#F3ECE0',
  accent: screenTheme.primary,
};

// 화면 틀: 위 안전 영역 + 머리줄(뒤로·제목·오른쪽 행동) + 스크롤 본문
export function Screen({
  title,
  subtitle,
  right,
  back = true,
  scroll = true,
  children,
  footer,
  bottomPad = 0,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
  scroll?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  bottomPad?: number;
}) {
  const insets = useSafeAreaInsets();
  // 진행 중 독서가 있으면 오른쪽 아래 미니 타이머가 마지막 내용을 가리지 않게 그만큼 더 내린다
  const { active } = useReading();
  const timerPad = active ? MINI_TIMER_SPACE : 0;
  // 화면 아래 고정 버튼이 있으면 미니 타이머를 그 위에 둔다(떠날 때 되돌린다)
  useEffect(() => () => miniTimerStore.setBottom(null), []);
  const body = scroll ? (
    <ScrollView contentContainerStyle={{ paddingHorizontal: ui.pad, paddingBottom: 32 + bottomPad + timerPad + (footer ? 0 : insets.bottom) }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingHorizontal: ui.pad }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
      <PaperSurface color={colors.bg} radius={0} grain={0.035} shaded={false} />
      <View style={[s.header, !back && { paddingTop: 28, paddingBottom: 6 }]}>
        {back ? (
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로" style={s.back}>
            <ChevronLeft size={30} color={colors.ink} strokeWidth={1.6} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, paddingLeft: back ? 0 : 24 }}>
        <Text style={[s.title, !back && { fontSize: 26, textAlign: 'left' }]} accessibilityRole="header">
          {title ?? ''}
        </Text>
        {subtitle ? <Text style={[s.muted, { marginTop: back ? 3 : 7 }]}>{subtitle}</Text> : null}
        </View>
        <View style={[s.right, back && { minWidth: 44 }]}>{right}</View>
      </View>
      {body}
      {footer ? <View onLayout={(e) => miniTimerStore.setBottom(e.nativeEvent.layout.height)} style={{ paddingHorizontal: ui.pad, paddingTop: 10, paddingBottom: 12 + insets.bottom, backgroundColor: 'rgba(251,247,240,0.96)' }}>{footer}</View> : null}
    </View>
  );
}

export function H2({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: 26, marginBottom: 10 }, style]}>
      <Text style={s.h2}>{children}</Text>
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        s.btn,
        primary && { backgroundColor: screenTheme.primary, borderColor: screenTheme.primary },
        kind === 'ghost' && { borderColor: 'transparent', backgroundColor: 'transparent' },
        kind === 'danger' && { borderColor: colors.danger },
        (disabled || busy) && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={primary ? colors.bg : colors.ink} size="small" /> : icon}
      <Text style={[s.btnText, primary && { color: colors.bg }, kind === 'danger' && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.inkFaint} {...p} style={[s.input, p.multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 10 }, p.style]} />
      {hint ? <Text style={[s.muted, { marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, on, onPress, color }: { label: string; on?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} style={[s.chip, on && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
      {color ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.chipText, on && { color: colors.bg }, { maxWidth: 230 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap }, style]}>{children}</View>;
}

export function Card({ children, style, onPress, stripe }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; stripe?: string }) {
  const inner = (
    <>
      {stripe ? <View style={[s.stripe, { backgroundColor: stripe }]} /> : null}
      {children}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, stripe && { paddingLeft: 18 }, style, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      {inner}
    </Pressable>
  ) : (
    <View style={[s.card, stripe && { paddingLeft: 18 }, style]}>{inner}</View>
  );
}

// 빈 화면: 짧은 안내 + 다음 행동
export function Empty({ title, body, action, onAction }: { title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
      <Text style={[s.h2, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[s.muted, { textAlign: 'center', lineHeight: 20 }]}>{body}</Text> : null}
      {action && onAction ? <Btn label={action} onPress={onAction} style={{ marginTop: 8, minWidth: 180 }} /> : null}
    </View>
  );
}

// 실제 표지(도서 이미지·사용자 사진). 없거나 못 읽으면 책 색 대체 표지(제목)
export function RealCover({ uri, title, color, width, ratio = 0.68 }: { uri?: string; title: string; color: string; width: number; ratio?: number }) {
  const [ok, setOk] = useState(true);
  const h = width / ratio;
  if (uri && ok)
    return <Image source={{ uri }} style={{ width, height: h, borderRadius: 3, backgroundColor: ui.soft }} resizeMode="cover" onError={() => setOk(false)} accessibilityLabel={`${title} 표지`} />;
  return (
    <View style={{ width, height: h, borderRadius: 3, backgroundColor: color, padding: 8, justifyContent: 'center' }} accessibilityLabel={`${title} 대체 표지`}>
      <Text style={{ fontFamily: fonts.serif, fontSize: Math.max(10, width / 8), color: '#FBF7F0', textAlign: 'center' }} numberOfLines={4}>
        {title}
      </Text>
    </View>
  );
}

export function Stars({ value, onChange, size = 24, color = colors.ink }: { value?: number; onChange?: (v: number | undefined) => void; size?: number; color?: string }) {
  return (
    <Row gap={4}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(value === n ? undefined : n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`별점 ${n}점`}>
          <Star size={size} color={color} fill={value && n <= value ? color : 'transparent'} strokeWidth={1.3} />
        </Pressable>
      ))}
    </Row>
  );
}

// 목록 한 줄(설정·메뉴)
export function ListItem({ label, value, onPress, danger }: { label: string; value?: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.item, pressed && { opacity: 0.7 }]} accessibilityRole={onPress ? 'button' : undefined}>
      <Text style={[s.itemLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value ? <Text style={s.itemValue}>{value}</Text> : null}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingRight: 6, paddingTop: 10, paddingBottom: 2 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  title: { fontFamily: fonts.round, fontSize: 20, color: colors.ink, textAlign: 'center', includeFontPadding: false },
  right: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  h2: { fontFamily: fonts.round, fontSize: 18, color: colors.ink },
  muted: { fontSize: 13, color: colors.inkSoft },
  btn: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: screenTheme.border, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ui.card },
  btnText: { fontFamily: fonts.round, fontSize: 16, color: colors.ink, flexShrink: 1, textAlign: 'center' },
  label: { fontSize: 12.5, color: colors.inkSoft, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: '#E3D9C9', backgroundColor: ui.card, paddingHorizontal: 12, fontSize: 15, color: colors.ink },
  chip: { minHeight: 36, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: '#D8CEBF', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ui.card },
  chipText: { fontSize: 13.5, color: colors.ink },
  dot: { width: 10, height: 10, borderRadius: 5 },
  card: { backgroundColor: ui.card, borderRadius: ui.radius, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6DCCB', padding: 16, overflow: 'hidden' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6DCCB' },
  itemLabel: { fontSize: 15, color: colors.ink, flexShrink: 1, paddingVertical: 12 },
  itemValue: { fontSize: 14, color: colors.inkSoft, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
});
