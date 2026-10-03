// 갈피 상세(문학잡지형): 같은 책의 갈피를 좌우로 넘기며 읽는다. 카드는 길면 세로로 스크롤.
// 아래 막대: 책장한켠 · 수정 · 공유. 오른쪽 위 더 보기: 연결된 책 열기 · 삭제.
// 공유 이미지는 화면과 같은 카드를 뜬 것(개인 메모는 기본 제외, 미리보기에서 넣을 수 있다).
import { makeImageFromView } from '@shopify/react-native-skia';
import * as FS from 'expo-file-system/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ymd } from '@/features/book/labels';
import { BookmarkCard, PAGE_BG, type BookmarkCardData } from '@/features/bookmark/BookmarkCard';
import { bookmarksOf, toShelfBook, type Bookmark, type Library } from '@/domain/library';
import { dropImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { ChevronLeft, MoreHorizontal, PenLine, Share } from '@/ui/icons';
import { Btn, Chip, Empty, Field, ListItem, Row, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

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
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const first = lib.bookmarks[id];
  const list = useMemo(() => (first ? bookmarksOf(lib, first.myBookId).reverse() : []), [lib, first]);
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((m) => m.id === id)));
  const cur = list[index] ?? first;
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [share, setShare] = useState<{ withMemo: boolean; uri: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const shotRef = useRef<View>(null);
  const coverReady = useRef(false);

  if (!cur) return <Screen title="갈피"><Empty title="갈피를 찾을 수 없어요" /></Screen>;
  if (editing) return <EditBookmark m={editing} onDone={() => setEditing(null)} />;
  const curData = cardData(lib, cur);

  // 공유: 화면 밖에 그린 같은 카드를 이미지로 뜬다
  const shoot = async (withMemo: boolean) => {
    if (!share) coverReady.current = false;
    // 새 이미지를 만드는 동안 이전 미리보기를 그대로 두고(창이 사라지지 않게), 실패하면 알린다
    setShare((sh) => ({ withMemo, uri: sh?.uri ?? null }));
    setMaking(true);
    try {
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
      setShare({ withMemo, uri });
    } catch (e) {
      setShare(null);
      Alert.alert('공유 이미지를 만들지 못했어요', String((e as Error)?.message ?? e));
    } finally {
      setMaking(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: PAGE_BG, paddingTop: insets.top }}>
      <View style={st.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <ChevronLeft size={26} color={colors.ink} strokeWidth={1.4} />
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
            <ScrollView style={{ width }} contentContainerStyle={{ alignItems: 'center', paddingTop: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              {d ? <BookmarkCard data={d} showMemo width={Math.min(width, 440)} seed={item.id} /> : null}
            </ScrollView>
          );
        }}
      />

      {list.length > 1 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingBottom: 8 }}>
          <Row gap={10} style={{ justifyContent: 'center' }}>
            {list.slice(0, 12).map((m, i) => (
              <View key={m.id} style={[st.dot, i === index && { backgroundColor: colors.ink }]} />
            ))}
          </Row>
          <Text style={st.count}>{list.length}개의 갈피</Text>
        </View>
      ) : null}

      <View style={[st.bottom, { paddingBottom: insets.bottom + 10 }]}>
        <View>
          <View style={{ height: StyleSheet.hairlineWidth, width: 70, backgroundColor: '#A8A195', marginBottom: 6 }} />
          <Text style={st.brand}>책장한켠</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <View style={{ width: StyleSheet.hairlineWidth, height: 36, backgroundColor: '#CFC7B9' }} />
          <Pressable onPress={() => setEditing(cur)} hitSlop={10} accessibilityRole="button" accessibilityLabel="수정" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
            <PenLine size={22} color={colors.ink} strokeWidth={1.4} />
            <Text style={{ fontSize: 13, color: colors.ink }}>수정</Text>
          </Pressable>
          <Pressable onPress={() => shoot(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="이미지로 공유" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Share size={22} color={colors.ink} strokeWidth={1.4} />
            <Text style={{ fontSize: 13, color: colors.ink }}>공유</Text>
          </Pressable>
        </View>
      </View>

      {/* 공유 이미지용(화면 뒤에 같은 카드) */}
      {share && curData ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, zIndex: -1 }}>
          <View ref={shotRef} collapsable={false} style={{ width: SHARE_W, backgroundColor: PAGE_BG, paddingTop: 24, paddingBottom: 30, alignItems: 'center' }}>
            <BookmarkCard data={curData} showMemo={share.withMemo} width={SHARE_W} seed={cur.id} rasterizeBook onCoverReady={() => { coverReady.current = true; }} />
            <Text style={[st.brand, { marginTop: 4 }]}>책장한켠</Text>
          </View>
        </View>
      ) : null}

      <Modal visible={!!share?.uri} transparent animationType="fade" onRequestClose={() => setShare(null)}>
        <View style={st.dim}>
          <ScrollView style={{ maxHeight: '90%' }} contentContainerStyle={st.sheet}>
            <Text style={st.sheetTitle}>공유 이미지</Text>
            {share?.uri ? <Image source={{ uri: share.uri }} style={{ width: '100%', aspectRatio: 0.62, maxHeight: 460 }} resizeMode="contain" accessibilityLabel="공유 이미지 미리보기" /> : null}
            {cur.memo ? (
              <Row style={{ marginTop: 10 }}>
                <Chip label={making ? '만드는 중…' : share?.withMemo ? '메모 포함' : '메모 빼고'} on={!!share?.withMemo} onPress={() => !making && shoot(!share?.withMemo)} />
              </Row>
            ) : null}
            <View style={{ gap: 8, marginTop: 14 }}>
              <Btn
                label="공유하기"
                busy={busy || making}
                onPress={async () => {
                  if (!share?.uri) return;
                  setBusy(true);
                  try {
                    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(share.uri, { mimeType: 'image/png', dialogTitle: '갈피 공유' });
                    else Alert.alert('공유할 수 없어요', '이 기기에서 공유 창을 열 수 없어요.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Btn label="닫기" kind="ghost" onPress={() => setShare(null)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,18,15,0.3)' }} onPress={() => setMenu(false)} />
        <View style={[st.menu, { paddingBottom: insets.bottom + 16 }]}>
          <ListItem label="수정" onPress={() => { setMenu(false); setEditing(cur); }} />
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
  header: { minHeight: 58, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  headerTitle: { fontFamily: fonts.roundTitle, fontSize: 20, color: colors.ink },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#C9C2B6' },
  count: { fontFamily: fonts.serif, fontSize: 13, color: '#8C877E' },
  bottom: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12 },
  brand: { fontFamily: fonts.serif, fontSize: 16, color: '#8C877E', letterSpacing: 1 },
  dim: { flex: 1, backgroundColor: 'rgba(20,18,15,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: colors.bg, borderRadius: 16, padding: 18 },
  sheetTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.ink, marginBottom: 10 },
  menu: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22, paddingTop: 8 },
});
