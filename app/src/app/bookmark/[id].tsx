// 갈피 상세: 문장·출처를 크게, 메모, 수정·삭제, 연결된 책 열기, 이미지로 공유(메모는 기본 제외).
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';

import { ymd } from '@/features/book/labels';
import { drawCard, shareCard } from '@/features/bookmark/shareCard';
import { dropImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { useBookShared } from '@/ui/book3d/art';
import { Btn, Card, Chip, Empty, Field, Muted, Row, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/theme';

export default function BookmarkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const shared = useBookShared();
  const m = lib.bookmarks[id];
  const b = m && lib.books[m.myBookId];
  const e = b && lib.editions[b.editionId];
  const color = (b?.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#8A8378';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m?.text ?? '');
  const [page, setPage] = useState(m?.page ? String(m.page) : '');
  const [memo, setMemo] = useState(m?.memo ?? '');
  const [withMemo, setWithMemo] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = useMemo(
    () => (m && e ? { text: m.text, title: e.title, author: e.authors.join(', ') || undefined, page: m.page, memo: withMemo ? m.memo : undefined, color } : null),
    [m, e, withMemo, color],
  );
  // 미리보기: 화면 밖 표면 그림을 PNG로 바꿔 일반 이미지로 보여 준다(GPU 표면 그림은 다른 캔버스에 바로 그릴 수 없다)
  const img = useMemo(() => (preview && card && shared.regular ? `data:image/png;base64,${drawCard(card, shared.regular).encodeToBase64()}` : null), [preview, card, shared.regular]);
  if (!m || !e) return <Screen title="갈피"><Empty title="갈피를 찾을 수 없어요" /></Screen>;

  if (editing)
    return (
      <Screen
        title="갈피 수정"
        footer={
          <Btn
            label="저장"
            disabled={!text.trim()}
            onPress={() => {
              const n = Number(page);
              libraryStore.updateBookmark(id, { text: text.trim(), page: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined, memo: memo.trim() || undefined });
              setEditing(false);
            }}
          />
        }>
        <Field label="문장" value={text} onChangeText={setText} multiline style={{ fontFamily: fonts.serif, fontSize: 16, lineHeight: 28, minHeight: 160 }} />
        <Field label="쪽수 (선택)" value={page} onChangeText={setPage} keyboardType="number-pad" />
        <Field label="한 줄 메모 (선택)" value={memo} onChangeText={setMemo} />
      </Screen>
    );

  return (
    <Screen title="" right={<Btn label="수정" kind="ghost" onPress={() => setEditing(true)} style={{ minHeight: 36 }} />}>
      <Card stripe={color} style={{ paddingVertical: 28 }}>
        <Text style={{ fontFamily: fonts.serif, fontSize: 19, lineHeight: 36, color: colors.ink }} selectable>
          {m.text}
        </Text>
        <View style={{ width: 36, height: 2, backgroundColor: color, marginTop: 22, marginBottom: 12 }} />
        <Text style={{ fontFamily: fonts.serif, fontSize: 15.5, color: colors.ink }}>{e.title}</Text>
        <Muted style={{ marginTop: 2 }}>{[e.authors.join(', '), m.page ? `${m.page}쪽` : null, ymd(m.createdAt)].filter(Boolean).join(' · ')}</Muted>
      </Card>
      {m.memo ? (
        <Card style={{ marginTop: 12 }}>
          <Muted>메모 (나만 보기)</Muted>
          <Text style={{ fontSize: 14.5, lineHeight: 22, color: colors.ink, marginTop: 4 }}>{m.memo}</Text>
        </Card>
      ) : null}
      {m.photoUri ? <Image source={{ uri: m.photoUri }} style={{ width: '100%', aspectRatio: 0.75, borderRadius: 8, marginTop: 12 }} resizeMode="contain" accessibilityLabel="페이지 사진" /> : null}

      <View style={{ gap: 10, marginTop: 20 }}>
        <Btn label="이미지로 공유" onPress={() => setPreview(true)} />
        {preview && img ? (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Image source={{ uri: img }} style={{ width: 288, height: 360, borderRadius: 4 }} accessibilityLabel="공유 이미지 미리보기" />
            <Row>
              {m.memo ? <Chip label={withMemo ? '메모 포함' : '메모 제외'} on={withMemo} onPress={() => setWithMemo((v) => !v)} /> : null}
            </Row>
            <Btn
              label="공유하기"
              busy={busy}
              style={{ alignSelf: 'stretch' }}
              onPress={async () => {
                if (!card || !shared.regular) return;
                setBusy(true);
                try {
                  const r = await shareCard(card, shared.regular);
                  if (!r.ok) Alert.alert('공유할 수 없어요', '이 기기에서 공유 창을 열 수 없어요.');
                } catch (err) {
                  Alert.alert('이미지를 만들지 못했어요', String((err as Error)?.message ?? err));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </View>
        ) : null}
        <Btn label="연결된 책 열기" kind="secondary" onPress={() => router.push(`/book/${m.myBookId}`)} />
        <Btn
          label="삭제"
          kind="danger"
          onPress={() =>
            Alert.alert('갈피를 삭제할까요?', '되돌릴 수 없어요.', [
              { text: '취소', style: 'cancel' },
              {
                text: '삭제',
                style: 'destructive',
                onPress: () => {
                  void dropImage(m.photoUri);
                  libraryStore.deleteBookmark(id);
                  router.back();
                },
              },
            ])
          }
        />
      </View>
    </Screen>
  );
}
