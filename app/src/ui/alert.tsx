// 앱이 직접 그리는 확인창(2026-11-09 사용자 '우리 앱 디자인이 적용 안 된 알림'): 운영체제 Alert 대신 이것을 쓴다.
// 부르는 법은 Alert.alert와 같다(제목, 본문, 버튼[{ text, onPress, style }]). 여러 개가 겹치면 차례로 하나씩 보인다.
// 버튼: 하나면 꽉 찬 주요 버튼, 둘이면 나란히(취소는 왼쪽 회색 선, 행동은 오른쪽. 삭제처럼 되돌릴 수 없는 행동은 빨간 글자),
// 셋 이상이면 세로로 쌓고 취소는 맨 아래 글자 버튼. 뒤로 가기·바깥 누르기는 취소 버튼이 있을 때만 취소로 닫는다(한 버튼 안내는 확인으로 닫는다)
import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { keepAll } from './keep-all';
import { Btn } from './kit';
import { colors, shape, space, type } from './theme';

export type AlertButton = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
type Req = { id: number; title: string; message?: string; buttons: AlertButton[]; cancelable: boolean };

let queue: Req[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function appAlert(title: string, message?: string, buttons?: AlertButton[], options?: { cancelable?: boolean }) {
  const list = buttons?.length ? buttons : [{ text: '확인' }];
  queue = [...queue, { id: ++seq, title, message: message || undefined, buttons: list, cancelable: options?.cancelable ?? true }];
  emit();
}

function close(req: Req, b?: AlertButton) {
  queue = queue.filter((q) => q.id !== req.id);
  emit();
  b?.onPress?.();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const current = () => queue[0] ?? null;

export function AlertHost() {
  const req = useSyncExternalStore(subscribe, current, current);
  if (!req) return null;
  const cancel = req.buttons.find((b) => b.style === 'cancel');
  const dismiss = () => {
    if (cancel) close(req, cancel);
    else if (req.buttons.length === 1) close(req, req.buttons[0]);
  };
  const actions = req.buttons.filter((b) => b !== cancel);
  const label = (b: AlertButton) => b.text ?? '확인';
  let body;
  if (req.buttons.length <= 2) {
    body = (
      <View style={st.row}>
        {cancel ? <Btn label={label(cancel)} kind="secondary" onPress={() => close(req, cancel)} style={st.flex} /> : null}
        {actions.map((b, i) => (
          <Btn key={i} label={label(b)} kind={b.style === 'destructive' ? 'danger' : i === 0 && !cancel && actions.length > 1 ? 'secondary' : 'primary'} onPress={() => close(req, b)} style={st.flex} />
        ))}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: space.s }}>
        {actions.map((b, i) => (
          <Btn key={i} label={label(b)} kind={b.style === 'destructive' ? 'danger' : i === 0 ? 'primary' : 'secondary'} onPress={() => close(req, b)} />
        ))}
        {cancel ? <Btn label={label(cancel)} kind="ghost" onPress={() => close(req, cancel)} /> : null}
      </View>
    );
  }
  return (
    <Modal key={req.id} transparent animationType="fade" visible onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <View style={st.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={req.cancelable ? dismiss : undefined} accessibilityLabel={cancel ? label(cancel) : '닫기'} />
        <View style={st.dialog} accessibilityViewIsModal accessibilityLiveRegion="polite">
          <ScrollView bounces={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 2 }}>
            <Text style={type.heading} accessibilityRole="header">{keepAll(req.title)}</Text>
            {req.message ? <Text style={[type.body, st.message]}>{keepAll(req.message)}</Text> : null}
          </ScrollView>
          <View style={{ marginTop: space.xl }}>{body}</View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', alignItems: 'center', padding: space.page },
  // 넓은 화면(태블릿·가로)에서도 확인창은 폰 폭 정도로
  dialog: { width: '100%', maxWidth: 400, maxHeight: '86%', backgroundColor: colors.raised, borderRadius: shape.dialog, padding: space.page, paddingTop: space.page + 2 },
  message: { color: colors.inkSoft, marginTop: space.s },
  row: { flexDirection: 'row', gap: space.s },
  flex: { flex: 1 },
});
