// 갈피 탭: 저장한 문장을 읽는 카드 목록. 책별 필터·검색·추가. '오늘의 갈피'는 내가 저장한 문장 중 하나를 작게.
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Search, X } from '@/ui/icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ymd } from '@/features/book/labels';
import { today } from '@/domain/library';
import { mix } from '@/ui/book/BookBody';
import { WordWrap } from '@/features/bookmark/BookmarkCard';
import { useLibrary } from '@/store/library-store';
import { Card, Chip, Empty, Muted, Row, Screen, s as kit } from '@/ui/kit';
import { colors, fonts, navigation } from '@/ui/theme';

export default function BookmarksTab() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [book, setBook] = useState<string | null>(params.book ?? null);
  const all = useMemo(() => Object.values(lib.bookmarks).filter((m) => lib.books[m.myBookId]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [lib]);
  const booksWith = useMemo(() => [...new Set(all.map((m) => m.myBookId))], [all]);
  const list = all.filter((m) => (!book || m.myBookId === book) && (!q.trim() || m.text.includes(q.trim()) || (m.memo ?? '').includes(q.trim())));
  // 오늘의 갈피: 날짜로 정해지는 하나(하루 동안 같다)
  const todays = useMemo(() => {
    if (all.length < 2) return null;
    let h = 0;
    for (const ch of today()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return all[h % all.length];
  }, [all]);
  const info = (myBookId: string) => {
    const b = lib.books[myBookId];
    const e = lib.editions[b.editionId];
    return { title: e?.title ?? '', author: e?.authors.join(', ') ?? '', color: (b.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#8A8378' };
  };
  return (
    <Screen
      title="갈피"
      back={false}
      bottomPad={navigation.height}
      right={
        <>
          <Pressable onPress={() => setSearching((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel="갈피 검색">
            {searching ? <X size={22} color={colors.ink} strokeWidth={1.6} /> : <Search size={21} color={colors.ink} strokeWidth={1.6} />}
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/bookmark/new', params: book ? { book } : {} })} hitSlop={10} accessibilityRole="button" accessibilityLabel="갈피 추가">
            <Plus size={23} color={colors.ink} strokeWidth={1.6} />
          </Pressable>
        </>
      }>
      {searching ? <TextInput value={q} onChangeText={setQ} autoFocus placeholder="문장·메모에서 찾기" placeholderTextColor={colors.inkFaint} style={[kit.input, { marginBottom: 10 }]} /> : null}
      {booksWith.length > 1 ? (
        <Row style={{ marginBottom: 12 }}>
          <Chip label="모든 책" on={!book} onPress={() => setBook(null)} />
          {booksWith.map((id) => (
            <Chip key={id} label={info(id).title} color={info(id).color} on={book === id} onPress={() => setBook(book === id ? null : id)} />
          ))}
        </Row>
      ) : null}
      {todays && !book && !q ? (
        <Pressable onPress={() => router.push(`/bookmark/${todays.id}`)} accessibilityRole="button" style={{ marginBottom: 16 }}>
          <View style={{ borderLeftWidth: 2, borderLeftColor: info(todays.myBookId).color, paddingLeft: 12, paddingVertical: 4 }}>
            <Muted>오늘의 갈피</Muted>
            <Text style={{ fontFamily: fonts.serif, fontSize: 14, lineHeight: 23, color: colors.ink, marginTop: 4 }} numberOfLines={2}>
              {todays.text}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {!all.length ? (
        <Empty
          title="첫 갈피를 남겨 보세요"
          body={Object.keys(lib.books).length ? '마음에 남은 문장을 책과 함께 모아 둘 수 있어요.' : '먼저 책을 추가하면 그 책에 갈피를 남길 수 있어요.'}
          action={Object.keys(lib.books).length ? '갈피 남기기' : '책 추가'}
          onAction={() => router.push(Object.keys(lib.books).length ? '/bookmark/new' : '/book/add')}
        />
      ) : !list.length ? (
        <Empty title="맞는 갈피가 없어요" />
      ) : (
        <View style={{ gap: 12 }}>
          {list.map((m) => {
            const i = info(m.myBookId);
            const accent = mix(i.color, '#7F95AD', 0.35);
            // 문학잡지형 카드(목록): 왼쪽 치우친 조판, 쪽수 → 문장(명조, 넉넉한 행간) → 가는 줄 → 책·날짜. 긴 문장은 여섯 줄까지, 전체는 상세에서
            return (
              <Pressable key={m.id} onPress={() => router.push(`/bookmark/${m.id}`)} accessibilityRole="button" style={({ pressed }) => [st.card, pressed && { opacity: 0.85 }]}>
                <View style={st.pageRow}>
                  <View style={[st.bar, { backgroundColor: accent }]} />
                  <Text style={st.meta}>{m.page ? `p. ${m.page}` : ' '}</Text>
                </View>
                <View style={{ marginTop: 14, paddingRight: 8 }}>
                  <WordWrap text={m.text.replace(/\s*\n+\s*/g, ' ')} style={st.quote} maxLines={6} />
                  {m.text.length > 110 ? <Text style={[st.meta, { marginTop: 2 }]}>…</Text> : null}
                </View>
                <View style={st.rule} />
                <WordWrap text={i.author ? `${i.title}  ·  ${i.author}` : i.title} style={st.src} />
                <Text style={[st.meta, { marginTop: 4 }]}>{ymd(m.createdAt)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: '#F8F4EC', paddingLeft: 30, paddingRight: 22, paddingTop: 20, paddingBottom: 22, borderRadius: 2, elevation: 1, shadowColor: '#5C4A36', shadowOpacity: 0.08, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: -4 },
  bar: { width: 2.5, height: 18 },
  meta: { fontFamily: fonts.serif, fontSize: 13, color: '#8C877E' },
  quote: { fontFamily: fonts.serif, fontSize: 18.5, lineHeight: 32, color: colors.ink },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: '#CFC7B9', marginVertical: 14 },
  src: { fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 22, color: colors.ink },
  srcAuthor: { fontFamily: fonts.serif, fontSize: 14, color: colors.inkSoft },
});
