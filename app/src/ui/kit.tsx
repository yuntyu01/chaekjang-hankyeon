// 공통 화면 부품. 색·글꼴·간격은 ui/screenTheme 토큰만 쓴다(설정 시안 기준: 아이보리 바탕, 짙은 갈색 글자, 둥근 고딕, 얇은 구분선).
// 설정·목록은 카드 대신 여백과 구분선으로 나누고, 입력창처럼 구분이 필요한 곳만 표면색을 깐다.
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Search, Star, X } from '@/ui/icons';
import { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MINI_TIMER_SPACE, miniTimerStore } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { colors, fonts, icon, shape, space, type } from '@/ui/screenTheme';
import { PaperSurface } from '@/ui/PaperSurface';

export const ui = {
  pad: space.page,
  radius: shape.input,
  card: colors.raised,
  soft: colors.surface,
  accent: colors.accent,
};

// 화면 틀: 위 안전 영역 + 머리줄(뒤로·가운데 제목·오른쪽 행동) + 스크롤 본문 + 아래 고정 버튼(footer).
// 뒤로가 없는 화면(탭 첫 화면·완료 화면)은 제목을 왼쪽에 둔다. 키보드가 열리면 아래 고정 버튼이 키보드 위로 올라온다.
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
    <ScrollView contentContainerStyle={{ paddingHorizontal: space.page, paddingBottom: space.section + bottomPad + timerPad + (footer ? 0 : insets.bottom) }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, paddingHorizontal: space.page }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.bg }}>
      <PaperSurface color={colors.bg} radius={0} grain={0.03} shaded={false} />
      {back ? (
        <View style={s.header}>
          {/* 제목은 화면 가운데(양옆 버튼 폭과 상관없이) */}
          <View pointerEvents="none" style={s.titleCenter}>
            <Text style={type.title} numberOfLines={1} accessibilityRole="header">
              {title ?? ''}
            </Text>
            {subtitle ? <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로" style={s.back}>
            <ChevronLeft size={28} color={colors.title} strokeWidth={icon.stroke} />
          </Pressable>
          <View style={s.right}>{right}</View>
        </View>
      ) : (
        <View style={s.headerLeft}>
          <View style={{ flex: 1 }}>
            <Text style={type.title} accessibilityRole="header">
              {title ?? ''}
            </Text>
            {subtitle ? <Text style={[type.sub, { marginTop: 4 }]}>{subtitle}</Text> : null}
          </View>
          {right ? <View style={[s.right, { marginRight: -10 }]}>{right}</View> : null}
        </View>
      )}
      {/* 안드로이드도 padding: 화면 끝까지 그리는(edge-to-edge) 창은 키보드가 열려도 줄지 않아 아래 저장 버튼이 가려진다.
          창이 줄어드는 환경이면 겹치는 높이가 0이라 두 번 비키지 않는다. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {body}
        {footer ? (
          <View onLayout={(e) => miniTimerStore.setBottom(e.nativeEvent.layout.height)} style={[s.footer, { paddingBottom: 12 + insets.bottom }]}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

// 구역 이름(시안의 '독서 환경'·'내 기록'): 작은 회갈색 글자, 위로 넉넉한 간격
export function H2({ children, style, first }: { children: ReactNode; style?: StyleProp<ViewStyle>; first?: boolean }) {
  return (
    <View style={[{ marginTop: first ? space.group + 8 : space.section, marginBottom: space.tight + 2 }, style]}>
      <Text style={type.section} accessibilityRole="header">
        {children}
      </Text>
    </View>
  );
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text style={[s.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[type.body, style]}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  size = 'm',
  disabled,
  busy,
  icon: iconNode,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'm' | 's';
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = kind === 'primary';
  const off = !!disabled || !!busy;
  const ink = primary ? (disabled ? colors.disabledInk : colors.onAccent) : kind === 'danger' ? colors.danger : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      hitSlop={size === 's' ? { top: 4, bottom: 4 } : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: !!busy }}
      style={({ pressed }) => [
        s.btn,
        size === 's' && s.btnSmall,
        primary && { backgroundColor: colors.accent, borderColor: colors.accent },
        primary && pressed && { backgroundColor: colors.accentPressed, borderColor: colors.accentPressed },
        primary && disabled && { backgroundColor: colors.disabled, borderColor: colors.disabled },
        kind === 'ghost' && { borderColor: 'transparent', backgroundColor: 'transparent' },
        kind === 'danger' && { borderColor: colors.line, backgroundColor: 'transparent' },
        !primary && disabled && { opacity: 0.45 },
        !primary && pressed && { backgroundColor: colors.surface },
        style,
      ]}>
      {busy ? <ActivityIndicator color={ink} size="small" /> : iconNode}
      <Text style={[s.btnText, size === 's' && { fontSize: 15 }, { color: ink }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

// 입력창: 표면색 바탕, 테두리 없음, 누르면 갈색 테두리. 이름은 위에 작게, 도움말·오류는 아래에.
export function Field({ label, hint, error, ...p }: TextInputProps & { label: string; hint?: string; error?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: space.group - 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={label}
        {...p}
        onFocus={(e) => {
          setFocus(true);
          p.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          p.onBlur?.(e);
        }}
        style={[s.input, p.multiline && s.inputMulti, focus && s.inputFocus, !!error && { borderColor: colors.danger }, p.editable === false && { opacity: 0.55 }, p.style]}
      />
      {error ? <Text style={[s.muted, { marginTop: 6, color: colors.danger }]}>{error}</Text> : hint ? <Text style={[s.muted, { marginTop: 6 }]}>{hint}</Text> : null}
    </View>
  );
}

// 고르는 칸(연결할 책 등): 입력창과 같은 모양, 누르면 고르는 시트가 열린다
export function SelectField({ label, value, placeholder, sub, onPress }: { label: string; value?: string; placeholder: string; sub?: string; onPress: () => void }) {
  return (
    <View style={{ marginBottom: space.group - 4 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${value ?? placeholder}`} style={({ pressed }) => [s.select, pressed && { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.input, { color: value ? colors.ink : colors.inkFaint }]} numberOfLines={2}>
            {value ?? placeholder}
          </Text>
          {sub ? <Text style={[type.caption, { marginTop: 2 }]} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <ChevronRight size={20} color={colors.inkSoft} strokeWidth={icon.stroke} />
      </Pressable>
    </View>
  );
}

// 검색창: 돋보기 + 입력 + 지우기(입력이 있을 때)
export function SearchField({ value, onChangeText, busy, onSubmit, style, ...p }: TextInputProps & { value: string; onChangeText: (t: string) => void; busy?: boolean; onSubmit?: () => void }) {
  return (
    <View style={[s.search, style as StyleProp<ViewStyle>]}>
      <Pressable onPress={onSubmit} disabled={!onSubmit} accessibilityRole={onSubmit ? 'button' : undefined} accessibilityLabel={onSubmit ? '검색' : undefined} style={s.searchIcon}>
        <Search size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType={onSubmit ? 'search' : 'done'}
        placeholderTextColor={colors.inkFaint}
        style={s.searchInput}
        {...p}
      />
      {busy ? (
        <ActivityIndicator size="small" color={colors.inkSoft} style={{ width: space.touch }} />
      ) : value ? (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="검색어 지우기" style={s.searchIcon}>
          <View style={s.clear}>
            <X size={14} color={colors.raised} strokeWidth={2.2} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({ label, on, onPress, color }: { label: string; on?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} hitSlop={{ top: 4, bottom: 4 }} style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && { backgroundColor: colors.surface }]}>
      {color ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.chipText, on && { color: colors.onAccent }, { maxWidth: 230 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap }, style]}>{children}</View>;
}

// 카드: 정말 한 덩어리로 묶여야 하는 것(안내 상자·요약)에만. 목록은 ListGroup을 쓴다.
export function Card({ children, style, onPress, stripe }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; stripe?: string }) {
  const inner = (
    <>
      {stripe ? <View style={[s.stripe, { backgroundColor: stripe }]} /> : null}
      {children}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, stripe && { paddingLeft: 20 }, style, pressed && { backgroundColor: colors.surface }]} accessibilityRole="button">
      {inner}
    </Pressable>
  ) : (
    <View style={[s.card, stripe && { paddingLeft: 20 }, style]}>{inner}</View>
  );
}

// 안내 상자: 확인이 필요한 알림(판본 정보 없음 등). 표면색 바탕, 테두리 없음
export function Notice({ children, tone = 'info', style }: { children: ReactNode; tone?: 'info' | 'error'; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.notice, style]} accessibilityLiveRegion="polite">
      <Text style={[type.sub, { color: tone === 'error' ? colors.danger : colors.ink }]}>{children}</Text>
    </View>
  );
}

// 빈 화면·결과 없음: 짧은 안내 + 다음 행동
export function Empty({ title, body, action, onAction }: { title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[type.sub, { textAlign: 'center' }]}>{body}</Text> : null}
      {action && onAction ? <Btn label={action} onPress={onAction} style={{ marginTop: 10, minWidth: 180 }} /> : null}
    </View>
  );
}

// 불러오는 중
export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }} accessibilityRole="progressbar" accessibilityLabel={label ?? '불러오는 중'}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={type.sub}>{label}</Text> : null}
    </View>
  );
}

// 실제 표지(도서 이미지·사용자 사진). 없거나 못 읽으면 책 색 대체 표지(제목)
export function RealCover({ uri, title, color, width, ratio = 0.68 }: { uri?: string; title: string; color: string; width: number; ratio?: number }) {
  const [ok, setOk] = useState(true);
  const h = width / ratio;
  if (uri && ok)
    return <Image source={{ uri }} style={{ width, height: h, borderRadius: 3, backgroundColor: colors.surface }} resizeMode="cover" onError={() => setOk(false)} accessibilityLabel={`${title} 표지`} />;
  return (
    <View style={{ width, height: h, borderRadius: 3, backgroundColor: color, padding: 8, justifyContent: 'center' }} accessibilityLabel={`${title} 대체 표지`}>
      <Text style={{ fontFamily: fonts.serif, fontSize: Math.max(10, width / 8), color: colors.onAccent, textAlign: 'center' }} numberOfLines={4}>
        {title}
      </Text>
    </View>
  );
}

export function Stars({ value, onChange, size = 24, color = colors.star }: { value?: number; onChange?: (v: number | undefined) => void; size?: number; color?: string }) {
  return (
    <Row gap={4}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(value === n ? undefined : n)} hitSlop={{ top: Math.max(8, (space.touch - size) / 2), bottom: Math.max(8, (space.touch - size) / 2), left: 2, right: 2 }} accessibilityRole="button" accessibilityLabel={`별점 ${n}점`} accessibilityState={{ selected: !!value && n <= value }}>
          <Star size={size} color={color} fill={value && n <= value ? color : 'transparent'} strokeWidth={1.3} />
        </Pressable>
      ))}
    </Row>
  );
}

// 켜고 끄는 스위치(시안: 갈색 둥근 바탕 안에 흰 손잡이). 안드로이드 기본 Switch는 손잡이가 바탕 밖으로 커서 시안과 달라 직접 그린다.
const TRACK_W = 50;
const TRACK_H = 30;
const KNOB = 24;
export function Toggle({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [value, x]);
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}>
      <Animated.View style={[s.track, { backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.accent] }) }]}>
        <Animated.View style={[s.knob, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, TRACK_W - KNOB - 6] }) }] }]} />
      </Animated.View>
    </Pressable>
  );
}

// 목록 한 줄(설정·메뉴·시트): 이름(+아래 설명) · 값 · 오른쪽 화살표 또는 스위치. 최소 56 높이.
export function ListItem({
  label,
  sub,
  value,
  onPress,
  danger,
  chevron,
  right,
  icon: iconNode,
  selected,
}: {
  label: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
  right?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
}) {
  const arrow = chevron ?? (!!onPress && !right);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [s.item, pressed && { opacity: 0.6 }]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      accessibilityLabel={[label, sub, value].filter(Boolean).join(', ')}>
      {iconNode ? <View style={s.itemIcon}>{iconNode}</View> : null}
      <View style={{ flex: 1, paddingVertical: sub ? 14 : 12, paddingRight: right || value || arrow ? 12 : 0 }}>
        <Text style={[type.row, danger && { color: colors.danger }]}>{label}</Text>
        {sub ? <Text style={[type.sub, { marginTop: 4 }]}>{sub}</Text> : null}
      </View>
      {value ? (
        <Text style={s.itemValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {arrow ? <ChevronRight size={20} color={colors.inkSoft} strokeWidth={icon.stroke} style={{ marginLeft: 6, marginRight: -4 }} /> : null}
    </Pressable>
  );
}

// 목록 묶음: 줄 사이에만 얇은 구분선(마지막 줄 아래는 없음)
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={style}>
      {items.map((c, i) => (
        <Fragment key={c.key ?? i}>
          {i ? <View style={s.divider} /> : null}
          {c}
        </Fragment>
      ))}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[s.divider, style]} />;
}

// 하단 시트: 어두운 덮개 + 위쪽만 둥근 판(손잡이·제목·내용). 바깥을 누르거나 뒤로 가면 닫힌다.
export function Sheet({ visible, onClose, title, children, scroll = false, maxHeight }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; scroll?: boolean; maxHeight?: DimensionValue }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + space.item, maxHeight }]}>
        <View style={s.handle} />
        {title ? (
          <Text style={[type.heading, { marginBottom: space.tight }]} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </Modal>
  );
}

// 가운데 확인창(앱이 직접 그리는 것만. 운영체제 Alert는 그대로 쓴다)
export function Dialog({ visible, onClose, title, body, children }: { visible: boolean; onClose: () => void; title: string; body?: string; children?: ReactNode }) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={s.dialogWrap}>
        <View style={s.dialog} accessibilityViewIsModal>
          <Text style={type.heading} accessibilityRole="header">
            {title}
          </Text>
          {body ? <Text style={[type.body, { color: colors.inkSoft, marginTop: 10 }]}>{body}</Text> : null}
          {children ? <View style={{ gap: 8, marginTop: space.group }}>{children}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

// 화면 맨 아래 작은 이름표(시안: 짧은 선 + '책장 한켠')
export function BrandFooter({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 56 }, style]} accessible accessibilityLabel="책장 한켠">
      <View style={{ width: 20, height: shape.hairline * 2, backgroundColor: colors.inkFaint }} />
      <Text style={type.sub}>책장 한켠</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  headerLeft: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.page, paddingTop: 20, paddingBottom: 8 },
  titleCenter: { position: 'absolute', left: 64, right: 64, top: 4, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  back: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  right: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', minWidth: space.touch, marginRight: 10 },
  footer: { paddingHorizontal: space.page, paddingTop: 10, backgroundColor: colors.bg, borderTopWidth: shape.hairline, borderTopColor: colors.line },
  muted: { ...type.sub },
  btn: { minHeight: 52, borderRadius: shape.button, borderWidth: shape.border, borderColor: colors.border, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'transparent' },
  btnSmall: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 14, borderRadius: shape.input },
  btnText: { ...type.button, flexShrink: 1, textAlign: 'center' },
  label: { ...type.label, marginBottom: 8 },
  input: { ...type.input, minHeight: 50, borderRadius: shape.input, borderWidth: shape.border, borderColor: colors.surface, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12 },
  inputMulti: { minHeight: 110, textAlignVertical: 'top', lineHeight: 24 },
  inputFocus: { borderColor: colors.accent },
  select: { minHeight: 50, borderRadius: shape.input, borderWidth: shape.border, borderColor: colors.surface, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { minHeight: 50, borderRadius: shape.input, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingRight: 2 },
  searchIcon: { width: space.touch, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  searchInput: { ...type.input, flex: 1, paddingVertical: 12 },
  clear: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 38, paddingVertical: 8, borderRadius: shape.pill, borderWidth: shape.border, borderColor: colors.border, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...type.sub, color: colors.ink, fontSize: 15 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  card: { backgroundColor: colors.raised, borderRadius: shape.button, borderWidth: shape.hairline, borderColor: colors.line, padding: 18, overflow: 'hidden' },
  notice: { backgroundColor: colors.surface, borderRadius: shape.input, paddingVertical: 14, paddingHorizontal: 16 },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  item: { minHeight: space.row, flexDirection: 'row', alignItems: 'center' },
  itemIcon: { width: 32, alignItems: 'flex-start' },
  itemValue: { ...type.sub, fontSize: 15, flexShrink: 1, textAlign: 'right', marginLeft: 12, maxWidth: '55%' },
  divider: { height: shape.hairline, backgroundColor: colors.line },
  track: { width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, padding: 3, justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.raised, shadowColor: '#3B2A24', shadowOpacity: 0.18, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  sheet: { backgroundColor: colors.raised, borderTopLeftRadius: shape.sheet, borderTopRightRadius: shape.sheet, paddingHorizontal: space.page, paddingTop: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 14 },
  dialogWrap: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: space.page },
  dialog: { backgroundColor: colors.raised, borderRadius: shape.dialog, padding: space.page },
});
