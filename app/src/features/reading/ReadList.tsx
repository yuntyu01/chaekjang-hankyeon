// 읽기 탭(2026-11-11 사용자 시안: 공부 타이머 앱처럼 과목 대신 책). 맨 위 오늘 날짜와 오늘 읽은 시간, 아래 책마다 [재생 단추 · 책 이름 · 오늘 읽은 시간 · ⋮].
// 재생을 누르면 그 책으로 타이머가 시작되고 분위기 장면(창가의 빗소리 같은 ASMR 화면, /reading/session)으로 넘어간다.
// 장면에서 뒤로 나오면 이 목록이다(타이머는 계속 돈다): 재는 책 줄은 일시정지 단추와 흐르는 시간, 줄을 누르면 장면으로 돌아간다.
// 다른 책을 재는 중에 재생을 누르면 묻는다(앞 책 시간이 설명 없이 새 책으로 옮겨 가지 않게: 장면의 책 바꾸기와 같은 규칙).
// 재생 단추 색은 책장 갈피 색(책마다 다른 뚜렷한 색, 없으면 테마색).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bookTitle, useElapsed } from '@/features/reading/ActiveReading';
import { PauseIcon, PlayIcon } from '@/features/reading/ReadingScreen';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { luminance } from '@/domain/color';
import { memoShelfBook, today } from '@/domain/library';
import { hms, readListIds, todayRead } from '@/domain/reading-list';
import { ambient } from '@/services/ambient';
import { saveAndStartOther } from '@/store/finish-reading';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { settingsStore } from '@/store/settings-store';
import { appAlert } from '@/ui/alert';
import { FixedDigits } from '@/ui/FixedDigits';
import { AudioLines, MoreVertical, Plus } from '@/ui/icons';
import { Btn, IconButton, ListItem, Screen, Sheet } from '@/ui/kit';
import { colors, fonts, icon, press, space, type } from '@/ui/theme';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const PLAY = 46; // 재생 단추 지름(시안 과목 줄의 원)

// 흰 세모가 바탕과 2.5:1 이상 대비일 때만 흰색(밝기 0.37 이하), 아니면 짙은 글자색(연보라·하늘색·연회청 갈피)
const glyphOn = (bg: string) => (luminance(bg) > 0.37 ? colors.ink : colors.onAccent);

export function ReadList() {
  const { book: handoff } = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const { active } = useReading();
  const [focusId, setFocusId] = useState<string | undefined>();
  const [menu, setMenu] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const running = !!active?.runningSince;
  // 재는 동안만 1초마다 다시 그린다(멈춰 있으면 한 번)
  const liveMs = useElapsed(running);
  const now = new Date();
  const day = today(now);

  // 책 정보·책장·기록에서 '읽기'로 넘겨받은 책은 목록 맨 앞에 둔다(시작은 재생을 눌러서: 들르기만 해서 타이머가 생기지 않게)
  useEffect(() => {
    if (!handoff) return;
    if (lib.books[handoff]) setFocusId(handoff);
    router.setParams({ book: undefined });
  }, [handoff, lib.books]);

  const saved = useMemo(() => todayRead(lib, day), [lib, day]);
  const ids = useMemo(() => readListIds(lib, { day, activeId: active?.myBookId, focusId }), [lib, day, active?.myBookId, focusId]);
  // 지금 재는 시간은 시작한 날의 몫으로 더한다(자정을 넘겨도 끝낼 때 시작 날짜로 저장되는 것과 같게)
  const activeToday = active && today(new Date(active.startedAt)) === day ? liveMs : 0;
  const total = saved.total + activeToday;
  const msOf = (id: string) => (saved.byBook.get(id) ?? 0) + (active?.myBookId === id ? activeToday : 0);

  const openScene = () => router.push('/reading/session');
  const startNew = (id: string | undefined) => {
    readingStore.start(id, id ? lib.books[id]?.currentPage : undefined);
    void ambient.play(settingsStore.get().scene);
    openScene();
  };
  // 재생 단추(책마다): 재는 책이면 일시정지·다시 시작, 아니면 그 책으로 시작하고 장면으로
  const begin = (id: string | undefined) => {
    const st = readingStore.get();
    if (st.pending) return router.push('/reading/finish'); // 끝냈지만 저장하지 않은 기록부터
    const cur = st.active;
    if (!cur) return startNew(id);
    if (cur.myBookId === id) {
      if (cur.runningSince) return readingStore.pause();
      readingStore.resume();
      return openScene();
    }
    const title = (b?: string) => (b ? bookTitle(lib, b) : undefined) ?? '책 없이 읽기';
    appAlert('이 책을 읽을까요?', `지금 ‘${title(cur.myBookId)}’ 시간을 재는 중이에요.`, [
      { text: '계속 읽기', style: 'cancel' },
      { text: '이 기록의 책을 바꾸기', onPress: () => { readingStore.setBook(id, id ? lib.books[id]?.currentPage : undefined); openScene(); } },
      { text: '지금까지 저장하고 새로 읽기', onPress: () => void saveAndStartOther(id).then(openScene).catch((err) => appAlert('저장하지 못했어요', String((err as Error)?.message ?? err))) },
    ]);
  };
  // 줄을 누르면: 재는 책은 장면으로 돌아가고, 아니면 재생과 같다
  const tapRow = (id: string | undefined) => (active && active.myBookId === id ? openScene() : begin(id));

  const noBookActive = !!active && !active.myBookId;
  const showNoBook = noBookActive || saved.noBook > 0;

  const row = (id: string | undefined) => {
    const isActive = !!active && active.myBookId === id;
    const playing = isActive && running;
    const title = id ? bookTitle(lib, id) ?? '' : '책 없이 읽기';
    const tint = id ? memoShelfBook(lib, id)?.art.ribbon ?? colors.accent : colors.track;
    const ms = id ? msOf(id) : saved.noBook + (noBookActive ? activeToday : 0);
    return (
      <Pressable key={id ?? '~none'} onPress={() => tapRow(id)} style={({ pressed }) => [st.row, pressed && press]} accessibilityRole="button" accessibilityLabel={`${title}, 오늘 ${hms(ms)}${isActive ? (playing ? ', 읽는 중' : ', 일시정지') : ''}`}>
        <Pressable onPress={() => begin(id)} hitSlop={8} style={({ pressed }) => [st.play, { backgroundColor: tint }, pressed && st.playPressed]} accessibilityRole="button" accessibilityLabel={playing ? `${title} 일시정지` : `${title} 읽기 시작`}>
          {playing ? <PauseIcon width={5} height={18} gap={6} color={glyphOn(tint)} /> : <PlayIcon size={24} color={glyphOn(tint)} />}
        </Pressable>
        <Text style={[st.title, isActive && st.titleActive]} numberOfLines={1}>{title}</Text>
        <FixedDigits text={hms(ms)} style={[st.rowTime, ms === 0 && !isActive && { color: colors.inkSoft }]} />
        {id ? (
          <Pressable onPress={() => setMenu(id)} hitSlop={6} style={({ pressed }) => [st.more, pressed && press]} accessibilityRole="button" accessibilityLabel={`${title} 더 보기`}>
            <MoreVertical size={22} color={colors.inkSoft} strokeWidth={icon.stroke} />
          </Pressable>
        ) : <View style={st.more} />}
      </Pressable>
    );
  };

  return (
    <Screen back={false}>
      {/* 머리: 가운데 오늘 날짜, 오른쪽 소리만 듣기(시간을 재지 않는 분위기 장면) */}
      <View style={st.head}>
        <View style={st.headSide} />
        <Text style={st.date} accessibilityRole="header">{`${now.getMonth() + 1}. ${now.getDate()} (${WEEK[now.getDay()]})`}</Text>
        <View style={[st.headSide, { alignItems: 'flex-end' }]}>
          <IconButton label="소리만 듣기" onPress={() => router.push({ pathname: '/reading/session', params: { sound: '1' } })}>
            <AudioLines size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
          </IconButton>
        </View>
      </View>
      {/* 오늘 읽은 시간(모든 책 + 책 없이) */}
      <View style={st.totalBox}>
        <FixedDigits text={hms(total)} style={st.total} accessibilityLabel={`오늘 읽은 시간 ${hms(total)}`} />
        <Text style={st.totalLabel}>{active ? (running ? '읽는 중' : '일시정지') : '오늘 읽은 시간'}</Text>
      </View>
      <View style={st.line} />
      {ids.length || showNoBook ? (
        <View style={st.list}>
          {ids.map((id) => row(id))}
          {showNoBook ? row(undefined) : null}
        </View>
      ) : (
        <View style={st.empty}>
          <Text style={type.heading}>읽는 중인 책이 없어요</Text>
          <Text style={[type.sub, { marginTop: space.s, textAlign: 'center' }]}>책을 고르면 바로 시간을 잴 수 있어요.</Text>
        </View>
      )}
      {/* 목록에 없는 책(읽을 책·다 읽은 책)이나 책 없이 읽기 */}
      {ids.length || showNoBook ? (
        <Pressable onPress={() => setPicker(true)} style={({ pressed }) => [st.row, pressed && press]} accessibilityRole="button" accessibilityLabel="다른 책 고르기">
          <View style={[st.play, st.addCircle]}><Plus size={22} color={colors.inkSoft} strokeWidth={icon.stroke} /></View>
          <Text style={[st.title, { color: colors.inkSoft }]}>다른 책 고르기</Text>
        </Pressable>
      ) : (
        <Btn label="책 고르기" onPress={() => setPicker(true)} style={{ marginTop: space.l }} />
      )}
      <BookPicker lib={lib} visible={picker} allowNone onClose={() => setPicker(false)} onPick={(id) => { setPicker(false); if (id) setFocusId(id); begin(id); }} />
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu ? bookTitle(lib, menu) : undefined}>
        <ListItem label="책 정보" chevron onPress={() => { const id = menu; setMenu(null); router.push(`/book/${id}`); }} />
        <ListItem label="이 책 독서 기록" chevron onPress={() => { const id = menu; setMenu(null); router.push(`/book/${id}/stats`); }} />
      </Sheet>
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 56, marginTop: space.xs },
  headSide: { width: 56 },
  date: { ...type.navTitle, flex: 1, textAlign: 'center' },
  totalBox: { alignItems: 'center', paddingTop: space.xl, paddingBottom: space.xxl },
  total: { fontFamily: fonts.uiBold, fontSize: 56, lineHeight: 64, color: colors.ink, includeFontPadding: false },
  totalLabel: { ...type.caption, marginTop: space.s },
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: -space.page },
  list: { paddingTop: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l, minHeight: 72 },
  play: { width: PLAY, height: PLAY, borderRadius: PLAY / 2, alignItems: 'center', justifyContent: 'center' },
  playPressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
  addCircle: { backgroundColor: colors.surface },
  title: { ...type.row, flex: 1 },
  titleActive: { fontFamily: fonts.uiBold },
  rowTime: { fontFamily: fonts.ui, fontSize: 18, lineHeight: 26, color: colors.ink, includeFontPadding: false },
  more: { width: 28, height: space.touch, alignItems: 'center', justifyContent: 'center', marginLeft: -space.s, marginRight: -space.s },
  empty: { alignItems: 'center', paddingTop: space.xxl, paddingBottom: space.m },
});
