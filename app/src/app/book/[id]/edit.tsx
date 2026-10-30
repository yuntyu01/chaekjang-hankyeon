// 책 정보 수정(판본 정보). 잘못 인식·입력한 값을 고친다. 비운 값은 '확인 전'이 된다.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pickPhoto, deniedMessage } from '@/services/photos';
import { dropImage, keepImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { BookVisual, LibraryCover } from '@/ui/BookVisual';
import { usePlacementStore } from '@/store/placement-store';
import { Camera, ChevronDown, ChevronUp } from '@/ui/icons';
import { Btn, Empty, Field, Muted, RealCover, Row, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function EditBook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const [f, setF] = useState(() => ({
    title: e?.title ?? '',
    authors: e?.authors.join(', ') ?? '',
    publisher: e?.publisher ?? '',
    publishedAt: e?.publishedAt ?? '',
    isbn: e?.isbn13 ?? '',
    pages: e?.pageCount ? String(e.pageCount) : '',
    width: e?.size ? String(e.size.widthMm) : '',
    height: e?.size ? String(e.size.heightMm) : '',
    coverUri: e?.coverUri,
    coverSource: e?.coverSource,
  }));
  const [msg, setMsg] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  if (!b || !e) return <Screen title="책 정보 수정"><Empty title="책을 찾을 수 없어요" /></Screen>;
  const save = async () => {
    let coverUri = f.coverUri;
    if (coverUri !== e.coverUri && f.coverSource === 'photo' && coverUri) {
      coverUri = await keepImage(coverUri, 'cover');
      if (e.coverSource === 'photo') void dropImage(e.coverUri);
    }
    const w = num(f.width);
    const h = num(f.height);
    libraryStore.updateEdition(e.id, {
      title: f.title.trim() || e.title,
      authors: f.authors.split(',').map((a) => a.trim()).filter(Boolean),
      publisher: f.publisher.trim() || undefined,
      publishedAt: f.publishedAt.trim() || undefined,
      isbn13: f.isbn.replace(/[^\dXx]/g, '') || undefined,
      pageCount: num(f.pages),
      size: w && h ? { widthMm: Math.min(w, h), heightMm: Math.max(w, h) } : undefined,
      coverUri,
      coverSource: coverUri ? f.coverSource : undefined,
    });
    router.back();
  };
  return (
    <Screen title="책 정보 수정" footer={<Btn label="저장" onPress={save} disabled={!f.title.trim()} />}>
      <View style={st.hero}>
        {f.coverUri ? <RealCover uri={f.coverUri} title={f.title} color="#B7AE9F" width={140} /> : place.books[id] ? <BookVisual book={place.books[id]} width={150} /> : <LibraryCover lib={lib} id={id} width={150} />}
        <Pressable
          onPress={async () => {
            const r = await pickPhoto('library');
            if (r.ok) setF({ ...f, coverUri: r.uri, coverSource: 'photo' });
            else if (r.reason === 'denied') setMsg(deniedMessage('library'));
          }}
          accessibilityRole="button"
          style={st.photo}>
          <Camera size={24} color={colors.ink} strokeWidth={1.5} />
          <Text style={st.photoText}>{f.coverUri ? '표지 사진 바꾸기' : '표지 사진 넣기'}</Text>
        </Pressable>
        {f.coverUri ? (
          <Pressable onPress={() => setF({ ...f, coverUri: undefined, coverSource: undefined })} accessibilityRole="button" hitSlop={8}>
            <Text style={st.clear}>표지 사진 지우기</Text>
          </Pressable>
        ) : null}
        {msg ? <Muted style={{ marginTop: 6 }}>{msg}</Muted> : null}
      </View>
      <Text style={st.h}>기본 정보</Text>
      <Field label="제목" value={f.title} onChangeText={(t) => setF({ ...f, title: t })} />
      <Field label="저자" value={f.authors} onChangeText={(t) => setF({ ...f, authors: t })} placeholder="저자 이름" />
      <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} style={st.more}>
        <View style={{ flex: 1 }}>
          <Text style={st.moreTitle}>상세 정보</Text>
          <Text style={st.moreSub}>출판사 · 출간일 · ISBN · 쪽수 · 판형</Text>
        </View>
        {more ? <ChevronUp size={26} color={colors.ink} strokeWidth={1.5} /> : <ChevronDown size={26} color={colors.ink} strokeWidth={1.5} />}
      </Pressable>
      {more ? (
        <View style={{ paddingTop: 18 }}>
          <Field label="출판사" value={f.publisher} onChangeText={(t) => setF({ ...f, publisher: t })} />
          <Field label="출간일" value={f.publishedAt} onChangeText={(t) => setF({ ...f, publishedAt: t })} placeholder="YYYY 또는 YYYY-MM" />
          <Field label="ISBN" value={f.isbn} onChangeText={(t) => setF({ ...f, isbn: t })} keyboardType="number-pad" />
          <Field label="쪽수" value={f.pages} onChangeText={(t) => setF({ ...f, pages: t })} keyboardType="number-pad" suffix="쪽" hint="비우면 ‘확인 전’으로 표시돼요." />
          <Row style={{ flexWrap: 'nowrap' }} gap={10}>
            <View style={{ flex: 1 }}>
              <Field label="판형 가로" value={f.width} onChangeText={(t) => setF({ ...f, width: t })} keyboardType="number-pad" suffix="mm" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="판형 세로" value={f.height} onChangeText={(t) => setF({ ...f, height: t })} keyboardType="number-pad" suffix="mm" />
            </View>
          </Row>
          <Muted>크기를 바꾸면 책장에서 책 크기도 바뀌어요. 자리가 모자라면 그 선반 끝 책이 서랍으로 옮겨질 수 있어요.</Muted>
        </View>
      ) : null}
      <View style={st.divider} />
      <Muted style={{ fontSize: 14.5, marginTop: 18 }}>자세한 정보는 나중에 채워도 괜찮아요.</Muted>
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 10 },
  photo: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginTop: 14, paddingHorizontal: 8 },
  photoText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  clear: { fontSize: 13.5, color: colors.inkSoft, textDecorationLine: 'underline' },
  h: { fontWeight: '700', fontSize: 19, color: colors.title, marginTop: 24, marginBottom: 14 },
  more: { flexDirection: 'row', alignItems: 'center', minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule, paddingTop: 14 },
  moreTitle: { fontWeight: '700', fontSize: 19, color: colors.title },
  moreSub: { fontSize: 14.5, color: colors.inkSoft, marginTop: 6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.rule, marginTop: 14 },
});
