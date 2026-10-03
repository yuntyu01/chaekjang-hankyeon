// 갈피 상세(문학잡지형): 같은 책의 갈피를 좌우로 넘기며 읽는다. 카드는 길면 세로로 스크롤.
// 아래 막대: 책장한켠 · 수정 · 공유. 오른쪽 위 더 보기: 연결된 책 열기 · 삭제.
// 공유는 같은 카드를 이미지로 만들어 기기의 공유창을 바로 연다. 개인 메모는 기본 제외.
import { makeImageFromView } from '@shopify/react-native-skia';
import * as FS from 'expo-file-system/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ymd } from '@/features/book/labels';
import { BookmarkCard, PAGE_BG, type BookmarkCardData } from '@/features/bookmark/BookmarkCard';
import { bookmarksOf, toShelfBook, type Bookmark, type Library } from '@/domain/library';
import { dropImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { ChevronLeft, MoreHorizontal, PenLine, Share } from '@/ui/icons';
import { Btn, Empty, Field, ListItem, Row, Screen } from '@/ui/kit';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { PaperSurface } from '@/ui/PaperSurface';

export function cardData(lib: Library, m: Bookmark): BookmarkCardData | null {
  const b = lib.books[m.myBookId];
  const e = b && lib.editions[b.editionId];
  if (!e) return null;
  return {
    text: m.text,
    title: e.title,
    author: e.authors.join(', ') || undefined,
    page: m.page,
    date: ymd(m.createdAt),
    memo: m.memo,
    color: (b.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#8A8378',
    coverUri: e.coverUri,
    book: toShelfBook(lib, b.id) ?? undefined,
  };
}

const SHARE_W = 380;

export default function BookmarkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const first = lib.bookmarks[id];
  const list = useMemo(() => (first ? bookmarksOf(lib, first.myBookId).reverse() : []), [lib, first]);
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((m) => m.id === id)));
  const cur = list[index] ?? first;
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [share, setShare] = useState<{ withMemo: boolean; data: BookmarkCardData; seed: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sharing = useRef(false);
  const shotRef = useRef<View>(null);
  const coverReady = useRef(false);

  if (!cur) return <Screen title="갈피"><Empty title="갈피를 찾을 수 없어요" /></Screen>;
  if (editing) return <EditBookmark m={editing} onDone={() => setEditing(null)} />;
  const curData = cardData(lib, cur);

  // 공유: 화면 밖에 그린 같은 카드를 이미지로 뜬다
  const shoot = async (withMemo: boolean) => {
    if (sharing.current || !curData) return;
    sharing.current = true;
    coverReady.current = false;
    setBusy(true);
    // 넘기기 중에도 누른 갈피의 내용과 표지를 함께 고정한다.
    setShare({ withMemo, data: curData, seed: cur.id });
    let imageReady = false;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('공유할 수 없어요', '이 기기에서 공유 창을 열 수 없어요.');
        return;
      }
      for (let i = 0; i < 30 && curData?.book && !coverReady.current; i++) await new Promise((r) => setTimeout(r, 100));
      if (curData?.book && !coverReady.current) throw new Error('책 표지가 준비되지 않았어요. 다시 시도해 주세요.');
      let img = null;
      for (let k = 0; k < 3 && !img; k++) {
        await new Promise((r) => setTimeout(r, 400));
        img = await makeImageFromView(shotRef).catch(() => null);
      }
      if (!img) throw new Error('카드 이미지를 뜨지 못했어요');
      const uri = `${FS.cacheDirectory}gallpi_${Date.now().toString(36)}.png`;
      await FS.writeAsStringAsync(uri, img.encodeToBase64(), { encoding: FS.EncodingType.Base64 });
      imageReady = true;
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '갈피 공유' });
    } catch (e) {
      Alert.alert(imageReady ? '공유 창을 열지 못했어요' : '공유 이미지를 만들지 못했어요', String((e as Error)?.message ?? e));
    } finally {
      setShare(null);
      setBusy(false);
      sharing.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: PAGE_BG, paddingTop: insets.top }}>
      <PaperSurface color={PAGE_BG} radius={0} grain={0.035} shaded={false} />
      <View style={st.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <ChevronLeft size={30} color={colors.ink} strokeWidth={1.4} />
        </Pressable>
        <Text style={st.headerTitle}>갈피</Text>
        <Pressable onPress={() => setMenu(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="더 보기">
          <MoreHorizontal size={24} color={colors.ink} strokeWidth={1.4} />
        </Pressable>
      </View>

      <FlatList
        data={list}
        keyExtractor={(m) => m.id}
        horizontal
        pagingEnabled
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => {
          const d = cardData(lib, item);
          return (
            <ScrollView style={{ width }} contentContainerStyle={{ alignItems: 'center', paddingTop: fontScale > 1.2 ? 18 : Math.max(24, Math.min(62, height * 0.073 - 4)), paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
              {d ? <BookmarkCard data={d} showMemo width={Math.min(width, 440)} seed={item.id} /> : null}
            </ScrollView>
          );
        }}
      />

      {list.length > 1 ? (
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 6, paddingBottom: height * 0.047 }}>
          <Row gap={10} style={{ justifyContent: 'center' }}>
            {list.slice(0, 12).map((m, i) => (
              <View key={m.id} style={[st.dot, i === index && { backgroundColor: screenTheme.blue, width: 10, height: 10, borderRadius: 5 }]} />
            ))}
          </Row>
          <Text style={st.count}>{list.length}개의 갈피</Text>
        </View>
      ) : null}

      <View style={[st.bottom, { paddingBottom: insets.bottom + height * 0.044 }]}>
        <View>
          <View style={{ height: StyleSheet.hairlineWidth, width: 70, backgroundColor: '#A8A195', marginBottom: 6 }} />
          <Text style={st.brand}>책장 한켠</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <View style={{ width: StyleSheet.hairlineWidth, height: 36, backgroundColor: '#CFC7B9' }} />
          <Pressable onPress={() => setEditing(cur)} hitSlop={10} accessibilityRole="button" accessibilityLabel="수정" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
            <PenLine size={22} color={colors.ink} strokeWidth={1.4} />
            <Text style={{ fontSize: 13, color: colors.ink }}>수정</Text>
          </Pressable>
          <Pressable onPress={() => shoot(false)} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel={busy ? '공유 준비 중' : '이미지로 공유'} accessibilityState={{ disabled: busy, busy }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
            {busy ? <ActivityIndicator size="small" color={colors.ink} /> : <Share size={22} color={colors.ink} strokeWidth={1.4} />}
            <Text style={{ fontSize: 13, color: colors.ink }}>{busy ? '준비 중' : '공유'}</Text>
          </Pressable>
        </View>
      </View>

      {/* 공유 이미지용(화면 뒤에 같은 카드) */}
      {share ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, zIndex: -1 }}>
          <View ref={shotRef} collapsable={false} style={{ width: SHARE_W, backgroundColor: PAGE_BG, paddingTop: 24, paddingBottom: 30, alignItems: 'center' }}>
            <BookmarkCard data={share.data} showMemo={share.withMemo} width={SHARE_W} seed={share.seed} rasterizeBook onCoverReady={() => { coverReady.current = true; }} />
            <Text style={[st.brand, { marginTop: 4 }]}>책장 한켠</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,18,15,0.3)' }} onPress={() => setMenu(false)} />
        <View style={[st.menu, { paddingBottom: insets.bottom + 16 }]}>
          <ListItem label="수정" onPress={() => { setMenu(false); setEditing(cur); }} />
          {cur.memo ? <ListItem label="메모 포함해 공유" onPress={() => { setMenu(false); void shoot(true); }} /> : null}
          <ListItem label="연결된 책 열기" onPress={() => { setMenu(false); router.push(`/book/${cur.myBookId}`); }} />
          <ListItem
            label="삭제"
            danger
            onPress={() => {
              setMenu(false);
              Alert.alert('갈피를 삭제할까요?', '되돌릴 수 없어요.', [
                { text: '취소', style: 'cancel' },
                {
                  text: '삭제',
                  style: 'destructive',
                  onPress: () => {
                    void dropImage(cur.photoUri);
                    libraryStore.deleteBookmark(cur.id);
                    if (list.length <= 1) router.back();
                    else setIndex(Math.max(0, index - 1));
                  },
                },
              ]);
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

function EditBookmark({ m, onDone }: { m: Bookmark; onDone: () => void }) {
  const [text, setText] = useState(m.text);
  const [page, setPage] = useState(m.page ? String(m.page) : '');
  const [memo, setMemo] = useState(m.memo ?? '');
  return (
    <Screen
      title="갈피 수정"
      footer={
        <Btn
          label="저장"
          disabled={!text.trim()}
          onPress={() => {
            const n = Number(page);
            libraryStore.updateBookmark(m.id, { text: text.trim(), page: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined, memo: memo.trim() || undefined });
            onDone();
          }}
        />
      }>
      <Field label="문장 (줄바꿈으로 문단을 나눠요)" value={text} onChangeText={setText} multiline style={{ fontFamily: fonts.serif, fontSize: 16, lineHeight: 28, minHeight: 180 }} />
      <Field label="쪽수 (선택)" value={page} onChangeText={setPage} keyboardType="number-pad" />
      <Field label="한 줄 메모 (선택, 공유 이미지에는 기본으로 빠져요)" value={memo} onChangeText={setMemo} />
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { minHeight: 62, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.round, fontSize: 20, color: colors.ink },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#C9C2B6' },
  count: { fontFamily: fonts.serif, fontSize: 12, lineHeight: 21, color: '#9D958B', includeFontPadding: false },
  bottom: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12 },
  brand: { fontFamily: fonts.serifMedium, fontSize: 15, color: '#68524A', includeFontPadding: false },
  menu: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22, paddingTop: 8 },
});
