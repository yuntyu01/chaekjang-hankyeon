// 공통 화면 부품. 아이보리 종이 바탕, 먹색 글자, 제목은 명조, 메뉴·숫자는 고딕(시스템). 색은 책에서 온다.
import { router } from 'expo-router';
import { ChevronLeft, Star } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '@/ui/theme';

export const ui = {
  pad: 20,
  radius: 12,
  card: '#FFFDF8',
  soft: '#F3ECE0',
  accent: '#1F2533',
};

// 화면 틀: 위 안전 영역 + 머리줄(뒤로·제목·오른쪽 행동) + 스크롤 본문
export function Screen({
  title,
  right,
  back = true,
  scroll = true,
  children,
  footer,
  bottomPad = 0,
}: {
  title?: string;
  right?: ReactNode;
  back?: boolean;
  scroll?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  bottomPad?: number;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView contentContainerStyle={{ paddingHorizontal: ui.pad, paddingBottom: 32 + bottomPad + (footer ? 0 : insets.bottom) }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingHorizontal: ui.pad }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View style={s.header}>
        {back ? (
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로" style={s.back}>
            <ChevronLeft size={24} color={colors.ink} strokeWidth={1.6} />
          </Pressable>
        ) : null}
        <Text style={[s.title, !back && { marginLeft: ui.pad }]} numberOfLines={1} accessibilityRole="header">
          {title ?? ''}
        </Text>
        <View style={s.right}>{right}</View>
      </View>
      {body}
      {footer ? <View style={{ paddingHorizontal: ui.pad, paddingTop: 10, paddingBottom: 12 + insets.bottom, backgroundColor: 'rgba(251,247,240,0.96)' }}>{footer}</View> : null}
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
        primary && { backgroundColor: colors.ink, borderColor: colors.ink },
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
      <Text style={[s.chipText, on && { color: colors.bg }]}>{label}</Text>
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

export function Stars({ value, onChange, size = 24 }: { value?: number; onChange?: (v: number | undefined) => void; size?: number }) {
  return (
    <Row gap={4}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(value === n ? undefined : n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`별점 ${n}점`}>
          <Star size={size} color={colors.ink} fill={value && n <= value ? colors.ink : 'transparent'} strokeWidth={1.3} />
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
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingRight: ui.pad - 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  title: { flex: 1, fontFamily: fonts.serif, fontSize: 19, color: colors.ink },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h2: { fontFamily: fonts.serif, fontSize: 17, color: colors.ink },
  muted: { fontSize: 13, color: colors.inkSoft },
  btn: { minHeight: 46, borderRadius: 23, borderWidth: 1, borderColor: '#CFC6B8', paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ui.card },
  btnText: { fontSize: 15, color: colors.ink },
  label: { fontSize: 12.5, color: colors.inkSoft, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: '#E3D9C9', backgroundColor: ui.card, paddingHorizontal: 12, fontSize: 15, color: colors.ink },
  chip: { height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#D8CEBF', paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ui.card },
  chipText: { fontSize: 13.5, color: colors.ink },
  dot: { width: 10, height: 10, borderRadius: 5 },
  card: { backgroundColor: ui.card, borderRadius: ui.radius, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6DCCB', padding: 16, overflow: 'hidden' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  item: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6DCCB' },
  itemLabel: { fontSize: 15, color: colors.ink },
  itemValue: { fontSize: 14, color: colors.inkSoft },
});
