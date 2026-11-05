// 자리가 없을 때 전용 시트(2026-11-05 사용자 '이것도 전용 디자인 만들어줘', 운영체제 확인창 대신): 꽂으려던 책이 선반 판 위에 서 있고, 아래에서 선반을 열거나 보관한다.
// 선반 판은 지금 책장의 판 색. 바깥을 누르거나 닫으면 보관한다(책이 사라지지 않게. 전체 책에서 언제든 꽂을 수 있다).
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { askNoRoomHostReady, type NoRoomRequest } from '@/features/book/no-room';
import { ko } from '@/i18n/ko';
import { SKIN } from '@/scene-config/skin';
import { useLibrary } from '@/store/library-store';
import { LibraryCover } from '@/ui/BookVisual';
import { Btn, Sheet, TextLink } from '@/ui/kit';
import { space, type } from '@/ui/theme';

const SHOWN = 3;
const CLOSE_MS = 280; // 시트가 내려간 뒤 다음 화면을 띄운다(시트 둘이 겹쳐 뜨지 않게)

export function NoRoomSheet() {
  const [req, setReq] = useState<NoRoomRequest | null>(null);
  const { lib } = useLibrary();
  useEffect(() => askNoRoomHostReady(setReq), []);
  const answer = (fn?: () => void) => {
    setReq(null);
    if (fn) setTimeout(fn, CLOSE_MS);
  };
  const ids = (req?.ids ?? []).filter((id) => lib.books[id]);
  const rest = (req?.ids.length ?? 0) - Math.min(ids.length, SHOWN);
  return (
    <Sheet visible={!!req} onClose={() => answer(req?.onKeep)} title={ko.allBooks.noRoomTitle} description={ko.allBooks.noRoomBody(req?.ids.length ?? 0)}>
      <View style={st.shelf} accessible accessibilityLabel={`꽂으려던 책 ${req?.ids.length ?? 0}권`}>
        <View style={st.books}>
          {ids.slice(0, SHOWN).map((id) => (
            <View key={id} style={st.book} pointerEvents="none"><LibraryCover lib={lib} id={id} width={68} /></View>
          ))}
          {rest > 0 ? <Text style={[type.sub, st.more]}>외 {rest}권</Text> : null}
        </View>
        <View style={[st.plank, { backgroundColor: SKIN.plank.color }]} />
      </View>
      <Btn label={ko.allBooks.openAndPlace} size="l" onPress={() => answer(req?.onOpen)} />
      <TextLink label={ko.allBooks.keep} tone="soft" onPress={() => answer(req?.onKeep)} style={st.keep} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  shelf: { marginTop: space.s, marginBottom: space.xl },
  books: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.m, minHeight: 100 },
  book: { width: 68, alignItems: 'center' },
  more: { marginBottom: space.xs },
  plank: { height: 8, borderRadius: 2, marginHorizontal: -space.xs },
  keep: { alignSelf: 'center', marginTop: space.s },
});
