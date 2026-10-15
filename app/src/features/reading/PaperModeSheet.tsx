// 종이 모드 설정 시트(Android): 미리보기, 켜기/끄기, 색상 두 가지, 색감·종이 결 세기, 기본값 복원.
// 종이 모드는 독서 타이머와 따로 움직인다(여기서 타이머 상태를 읽거나 바꾸지 않는다).
// 켜기는 다른 앱 위 표시 권한부터: 처음 누르면 짧게 설명하고 시스템 설정을 연다. 돌아오면 실제 권한을 다시 읽고, 없으면 꺼진 채로 둔다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Modal, PanResponder, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_PAPER, PaperPreview, paperMode, usePaperState, type PaperPalette, type PaperSettings } from '../../../modules/paper-mode';
import { Btn } from '@/ui/kit';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';

const BROWN = '#81573E';
const SWATCH: Record<PaperPalette, string> = { bright: '#FCF9F1', warm: '#FBF5E8' };

// 책장 한켠 로고(책 세 권과 선반). 알림 아이콘(modules/paper-mode/android/res/drawable)과 같은 모양
export function PaperModeGlyph({ size = 18, color = BROWN }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="244 232 560 560">
      <Path d="M295,384 L295,700 Q295,742 337,742 L746,742" stroke={color} strokeWidth={48} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M362,310 L404,310 Q428,310 428,334 L428,680 Q428,704 404,704 L362,704 Q338,704 338,680 L338,334 Q338,310 362,310 Z" fill={color} />
      <Path d="M469,259 L528,259 Q552,259 552,283 L552,680 Q552,704 528,704 L469,704 Q445,704 445,680 L445,283 Q445,259 469,259 Z" fill={color} />
      <G rotation={-7.5} origin="637, 508">
        <Path d="M611,317 L663,317 Q687,317 687,341 L687,675 Q687,699 663,699 L611,699 Q587,699 587,675 L587,341 Q587,317 611,317 Z" fill={color} />
      </G>
    </Svg>
  );
}

type Step = 'idle' | 'explain' | 'waiting';

export function PaperModeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [state, refresh] = usePaperState();
  const [look, setLook] = useState<PaperSettings>(() => paperMode.settings());
  const [step, setStep] = useState<Step>('idle');
  const [note, setNote] = useState<string | null>(null);
  const waiting = useRef(false);

  useEffect(() => {
    if (visible) {
      setLook(paperMode.settings());
      setNote(null);
      setStep('idle');
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 값 저장: 끄는 중에도 바로 반영(켜져 있으면 서비스가 그림을 다시 만든다). 끄는 동안은 너무 자주 보내지 않는다
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (patch: Partial<PaperSettings>, final = true) => {
    const next = { ...look, ...patch };
    setLook(next);
    if (pending.current) clearTimeout(pending.current);
    const now = Date.now();
    if (final || now - last.current > 150) {
      last.current = now;
      paperMode.save(next);
    } else pending.current = setTimeout(() => paperMode.save(next), 150);
  };

  const begin = async () => {
    // 알림 권한(Android 13+): 실행 중 알림의 '끄기'를 위해 한 번 묻는다. 거부해도 종이 모드는 켜지고, 앱 안에서 끌 수 있다
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
      if (!(await PermissionsAndroid.check(perm))) await PermissionsAndroid.request(perm).catch(() => undefined);
    }
    paperMode.save(look);
    if (!paperMode.start()) setNote('다른 앱 위 표시 권한이 없어 켜지 못했어요.');
    refresh();
  };

  // 설정에서 돌아오면 실제 권한을 다시 본다: 허용했으면 이어서 켜고, 아니면 꺼진 채로 둔다
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' || !waiting.current) return;
      waiting.current = false;
      setStep('idle');
      if (paperMode.state().canDrawOverlays) void begin();
      else setNote('권한이 허용되지 않아 종이 모드는 꺼진 채로 두었어요.');
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);

  const toggle = (on: boolean) => {
    setNote(null);
    if (!on) {
      waiting.current = false;
      setStep('idle');
      paperMode.stop();
      return;
    }
    if (paperMode.state().canDrawOverlays) void begin();
    else setStep('explain');
  };

  const running = state.running;
  const status = running
    ? state.starting
      ? '켜는 중이에요.'
      : state.shown
        ? state.notificationsEnabled
          ? '켜져 있어요. 다른 앱으로 가도 유지되고, 알림에서도 끌 수 있어요.'
          : '켜져 있어요. 알림이 꺼져 있어 알림에서는 끌 수 없어요. 여기서 끄거나, 알림창의 실행 중인 앱 목록에서 멈출 수 있어요.'
        : '켜져 있어요. 화면이 잠겨 있는 동안은 쉬어요.'
    : state.lastError === 'permission'
      ? '다른 앱 위 표시 권한이 없어 꺼졌어요.'
      : step !== 'idle'
        ? '아직 꺼져 있어요. 권한을 허용하면 켜져요.'
        : state.lastError === 'start'
          ? '시스템이 시작을 막아 꺼졌어요. 다시 켜 보세요.'
          : '꺼져 있어요.';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,18,15,0.32)' }} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 14, maxHeight: height * 0.88 }]}>
        <ScrollView contentContainerStyle={{ gap: 18 }} showsVerticalScrollIndicator={false}>
          <View style={st.handle} />
          <View style={{ gap: 6 }}>
            <Text style={st.title}>종이 모드</Text>
            <Text style={st.help}>다른 앱에서 읽을 때 화면 위에 옅은 종이 색과 결을 한 겹 얹어요. 화면 전체에 함께 적용되고, 화면 내용은 읽거나 저장하지 않아요.</Text>
          </View>

          <Preview look={look} live={running && state.shown} />

          <View style={st.row}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={st.label}>켜기</Text>
              <Text style={st.status} accessibilityLiveRegion="polite">{status}</Text>
            </View>
            <Switch
              value={running || step !== 'idle'}
              onValueChange={toggle}
              trackColor={{ false: '#DCD1C2', true: '#C9A88F' }}
              thumbColor={running ? BROWN : '#FFFDF8'}
              accessibilityLabel="종이 모드 켜기"
            />
          </View>

          {step !== 'idle' ? (
            <View style={st.explain}>
              <Text style={st.explainTitle}>다른 앱 위에 표시 권한이 필요해요</Text>
              <Text style={st.help}>
                종이 모드는 화면 맨 위에 터치를 받지 않는 옅은 막을 한 장 얹는 방식이에요. 다음 화면에서 ‘책장 한켠’의 다른 앱 위에 표시를 허용한 뒤 돌아오면 켜져요.
                일부 앱과 시스템 화면에서는 보안 때문에 효과가 가려질 수 있어요.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn label="취소" kind="secondary" style={{ flex: 1 }} onPress={() => { waiting.current = false; setStep('idle'); }} />
                <Btn label="설정 열기" style={{ flex: 1 }} onPress={() => { waiting.current = true; setStep('waiting'); paperMode.openOverlaySettings(); }} />
              </View>
            </View>
          ) : null}
          {note ? <Text style={[st.status, { color: colors.danger }]}>{note}</Text> : null}
          {state.limited ? <Text style={st.status}>이 기기의 터치 보호 기준 때문에 효과를 조금 약하게 적용하고 있어요.</Text> : null}

          <View style={{ gap: 10 }}>
            <Text style={st.label}>색상</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['bright', 'warm'] as const).map((p) => {
                const on = look.palette === p;
                return (
                  <Pressable key={p} onPress={() => change({ palette: p })} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[st.choice, on && st.choiceOn]}>
                    <View style={[st.swatch, { backgroundColor: SWATCH[p] }]} />
                    <Text style={[st.choiceText, on && { color: colors.ink }]}>{p === 'bright' ? '밝은 종이' : '따뜻한 종이'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Slider label="색감" value={look.tint} onChange={(v, final) => change({ tint: v }, final)} />
          <Slider label="종이 결" value={look.grain} offAtZero onChange={(v, final) => change({ grain: v }, final)} />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn label="기본값으로" kind="secondary" style={{ flex: 1 }} onPress={() => change(DEFAULT_PAPER)} />
            <Btn label="닫기" kind="ghost" style={{ flex: 1 }} onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// 미리보기: 작은 글자·회색 보조 글자·그림·어두운 바탕을 실제 오버레이와 같은 합성으로 덮는다(글자 뒤에만 종이를 깔지 않는다).
// 종이 모드가 켜져 있으면 이 화면도 이미 실제 오버레이 아래에 있어, 겹쳐 그리지 않고 실제 효과를 그대로 보여 준다
function Preview({ look, live }: { look: PaperSettings; live: boolean }) {
  return (
    <View style={st.preview} accessibilityLabel="종이 모드 미리보기">
      <View style={{ flexDirection: 'row', gap: 12, padding: 14, backgroundColor: '#FFFFFF' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ fontSize: 15, color: '#000000', fontWeight: '600' }}>제3장 · 느린 계절</Text>
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: '#111111' }}>
            창밖의 비는 오후 내내 그치지 않았다. 나는 책장을 넘기다 말고 젖은 유리에 비친 불빛을 오래 바라보았다.
          </Text>
          <Text style={{ fontSize: 10.5, color: '#757575' }}>각주 12 · 회색 보조 글자</Text>
        </View>
        <Image source={require('../../../assets/covers/summer-forest.png')} style={{ width: 64, height: 86, borderRadius: 3 }} />
      </View>
      <View style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#1E2228' }}>
        <Text style={{ fontSize: 11.5, color: '#F2F2F2' }}>어두운 바탕의 글자도 함께 확인해요</Text>
      </View>
      {PaperPreview ? <PaperPreview pointerEvents="none" style={StyleSheet.absoluteFill} palette={look.palette} tint={look.tint} grain={look.grain} active={!live} /> : null}
      {live ? <Text style={st.liveTag}>실제 화면에 적용 중</Text> : null}
    </View>
  );
}

// 0~1 값 막대. 끌거나 눌러 바꾸고, 놓을 때 저장한다(final). 화면 읽기 프로그램은 위·아래로 10%씩
function Slider({ label, value, onChange, offAtZero }: { label: string; value: number; onChange: (v: number, final: boolean) => void; offAtZero?: boolean }) {
  const [w, setW] = useState(1);
  const at = (x: number) => Math.round(Math.min(1, Math.max(0, x / w)) * 100) / 100;
  // 막대 안 자리(locationX)로 값을 정한다. 자식(채움·손잡이)은 터치를 받지 않아 늘 막대 기준이다
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => onChange(at(e.nativeEvent.locationX), false),
        onPanResponderMove: (e) => onChange(at(e.nativeEvent.locationX), false),
        onPanResponderRelease: (e) => onChange(at(e.nativeEvent.locationX), true),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, onChange],
  );
  const pct = Math.round(value * 100);
  const text = offAtZero && pct === 0 ? '끔' : `${pct}%`;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={st.label}>{label}</Text>
        <Text style={st.value}>{text}</Text>
      </View>
      <View
        onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))}
        style={st.track}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: pct, text }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(Math.min(1, Math.max(0, Math.round((value + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)) * 10) / 10)), true)}
        {...pan.panHandlers}>
        <View pointerEvents="none" style={st.rail} />
        <View pointerEvents="none" style={[st.fill, { width: `${pct}%` }]} />
        <View pointerEvents="none" style={[st.thumb, { left: value * w - 11 }]} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { backgroundColor: colors.bg, paddingHorizontal: 24, paddingTop: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { width: 30, height: 3, borderRadius: 2, backgroundColor: '#D5C8B9', alignSelf: 'center', marginTop: -10 },
  title: { fontFamily: fonts.roundTitle, fontSize: 21, color: colors.ink },
  help: { fontSize: 13, lineHeight: 20, color: colors.inkSoft },
  label: { fontFamily: fonts.round, fontSize: 15, color: colors.ink },
  value: { fontSize: 13, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
  status: { fontSize: 12.5, lineHeight: 18, color: colors.inkSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  preview: { borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: screenTheme.border },
  liveTag: { position: 'absolute', right: 10, bottom: 9, fontSize: 10.5, color: '#C9CDD3' },
  explain: { gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: screenTheme.border, backgroundColor: '#FFFDF8' },
  explainTitle: { fontFamily: fonts.round, fontSize: 14.5, color: colors.ink },
  choice: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: screenTheme.border, backgroundColor: '#FFFDF8' },
  choiceOn: { borderColor: BROWN, borderWidth: 1.5 },
  choiceText: { fontFamily: fonts.round, fontSize: 14, color: colors.inkSoft },
  swatch: { width: 18, height: 18, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#CDBFAE' },
  track: { height: 32, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: '#E6DAC9' },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: '#B58D72' },
  thumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFDF8', borderWidth: 1.5, borderColor: BROWN },
});
