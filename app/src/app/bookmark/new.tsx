// 갈피 작성 두 가지: 문장 갈피(직접 입력) / 사진 갈피(페이지를 찍어 그대로 붙인다. 옮겨 적기는 선택).
// 문장 갈피: 쪽수·한 줄 메모는 선택, 날짜는 자동.
// 사진으로 가져오기: 페이지 촬영/선택 → (OCR 연결되면) 문장 선택 → 수정·확인 → 저장. 페이지 전체를 자동으로 저장하지 않는다.
// OCR이 연결되지 않은 지금은 사진을 보면서 옮겨 적는다(사진은 선택해서 함께 보관).
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronRight, ImageIcon } from '@/ui/icons';
import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { BookPicker } from '@/features/bookmark/BookPicker';
import { PhotoPlate } from '@/features/bookmark/PhotoPlate';
import { ocr } from '@/services/connectors';
import { deniedMessage, pickPhoto } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { BookVisual, LibraryCover } from '@/ui/BookVisual';
import { usePlacementStore } from '@/store/placement-store';
import { Btn, Chip, Field, Muted, Row, Screen, Tabs } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

export default function NewBookmark() {
  const { book, text: initialText, page: initialPage, mode: initialMode } = useLocalSearchParams<{ book?: string; text?: string; page?: string; mode?: string }>();
  const [mode, setMode] = useState<'text' | 'photo'>(initialMode === 'photo' ? 'photo' : 'text');
  const [ratio, setRatio] = useState<number | undefined>();
  const isPhoto = mode === 'photo';
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const [bookId, setBookId] = useState<string | undefined>(book && lib.books[book] ? book : undefined);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState(initialText ?? '');
  const [page, setPage] = useState(initialPage ?? '');
  const [memo, setMemo] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(false);
  const [lines, setLines] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSave = !!bookId && (isPhoto ? !!photo : !!text.trim());
  const e = bookId ? lib.editions[lib.books[bookId]?.editionId] : undefined;

  const fromPhoto = async (from: 'camera' | 'library') => {
    const r = await pickPhoto(from, { crop: isPhoto });
    if (!r.ok) {
      if (r.reason === 'denied') setMsg(deniedMessage(from));
      else if (r.reason === 'error') setMsg(`사진을 가져오지 못했어요. ${r.message ?? ''}`);
      return;
    }
    setPhoto(r.uri);
    setRatio(r.width && r.height ? r.width / r.height : undefined);
    setMsg(null);
    if (isPhoto) return;
    if (ocr.available && ocr.recognize) setLines(await ocr.recognize(r.uri));
    else setMsg(ocr.reason ?? null);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const n = Number(page);
    const photoUri = photo && (isPhoto || keepPhoto) ? await keepImage(photo, 'page') : undefined;
    const id = libraryStore.addBookmark({ myBookId: bookId!, text: text.trim(), page: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined, memo: memo.trim() || undefined, photoUri, photoRatio: photoUri ? ratio : undefined });
    setSaving(false);
    router.replace(`/bookmark/${id}`);
  };

  const pickSource = () => Alert.alert('사진으로 문장 가져오기', '페이지 사진을 보면서 옮겨 적을 수 있어요.', [{ text: '페이지 찍기', onPress: () => void fromPhoto('camera') }, { text: '사진 고르기', onPress: () => void fromPhoto('library') }, { text: '취소', style: 'cancel' }]);
  return (
    <Screen title={isPhoto ? '사진 갈피 남기기' : '갈피 남기기'} footer={<Btn label="갈피 저장" onPress={save} busy={saving} disabled={!canSave} />}>
      <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={e ? `연결할 책 ${e.title}, 바꾸기` : '연결할 책 고르기'} style={st.book}>
        {bookId && lib.books[bookId] ? (
          <View pointerEvents="none" style={st.cover}>{place.books[bookId] ? <BookVisual book={place.books[bookId]} width={76} /> : <LibraryCover lib={lib} id={bookId} width={76} />}</View>
        ) : (
          <View style={[st.cover, st.noCover]}><Text style={st.noCoverText}>책</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[st.bookTitle, !e && { color: colors.inkSoft }]} numberOfLines={2}>{e ? e.title : '책을 골라 주세요'}</Text>
          {e?.authors.length ? <Muted style={{ marginTop: 4 }}>{e.authors.join(', ')}</Muted> : null}
        </View>
        <ChevronRight size={26} color={colors.ink} strokeWidth={1.5} />
      </Pressable>
      <Tabs items={[{ id: 'text', label: '직접 쓰기' }, { id: 'photo', label: '사진에서 가져오기' }]} value={mode} onChange={setMode} style={{ marginTop: 22, marginBottom: 22 }} />

      {isPhoto ? (
        <View style={{ marginBottom: 18 }}>
          {photo ? (
            <View style={{ alignItems: 'center' }}>
              <PhotoPlate uri={photo} ratio={ratio} width={320} seed="new" />
              <Row style={{ marginTop: 10 }}>
                <Chip label="다시 찍기" onPress={() => fromPhoto('camera')} />
                <Chip label="다른 사진" onPress={() => fromPhoto('library')} />
              </Row>
            </View>
          ) : (
            <View style={st.drop}>
              <Muted style={{ textAlign: 'center', lineHeight: 20 }}>마음에 남은 페이지를 찍어 그대로 붙여 두세요.{'\n'}찍은 뒤 문장 부분만 잘라 낼 수 있어요.</Muted>
              <Row style={{ flexWrap: 'nowrap', width: '100%' }}>
                <Btn label="페이지 찍기" icon={<Camera size={16} color="#FFF" strokeWidth={1.6} />} onPress={() => fromPhoto('camera')} style={{ flex: 1 }} />
                <Btn label="사진 고르기" kind="secondary" icon={<ImageIcon size={16} color={colors.ink} strokeWidth={1.6} />} onPress={() => fromPhoto('library')} style={{ flex: 1 }} />
              </Row>
            </View>
          )}
          {msg ? <Muted style={{ marginTop: 8, lineHeight: 19 }}>{msg}</Muted> : null}
        </View>
      ) : null}
      <Field label="쪽수" value={page} onChangeText={setPage} keyboardType="number-pad" suffix="쪽" />
      <Field label={isPhoto ? '옮겨 적기 · 선택' : '남길 문장'} value={text} onChangeText={setText} placeholder={isPhoto ? '사진 속 문장을 적어 두면 찾기 쉬워요' : '마음에 남은 문장을 옮겨 적어 주세요'} multiline style={{ fontSize: 16, lineHeight: 27, minHeight: isPhoto ? 100 : 140 }} />
      <Field label="나의 생각 · 선택" value={memo} onChangeText={setMemo} placeholder="이 문장이 마음에 남은 이유" multiline hint="공유 이미지에는 넣지 않아요." style={{ minHeight: 100, lineHeight: 24 }} />

      {isPhoto ? null : <>
      <Pressable onPress={pickSource} accessibilityRole="button" style={st.photoLink}>
        <Camera size={22} color={colors.ink} strokeWidth={1.5} />
        <Text style={st.photoLinkText}>사진으로 문장 가져오기</Text>
      </Pressable>
      {msg ? <Muted style={{ marginTop: 4, lineHeight: 19 }}>{msg}</Muted> : null}
      {lines?.length ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          <Muted>인식한 줄을 눌러 문장에 넣어요(그대로 저장되지 않아요)</Muted>
          {lines.map((l, i) => (
            <Chip key={i} label={l} onPress={() => setText((t) => (t ? `${t} ${l}` : l))} />
          ))}
        </View>
      ) : null}
      {photo ? (
        <View style={{ marginTop: 12 }}>
          <Image source={{ uri: photo }} style={{ width: '100%', aspectRatio: 0.75, borderRadius: 8, backgroundColor: '#EEE6D8' }} resizeMode="contain" accessibilityLabel="가져온 페이지 사진" />
          <Row style={{ marginTop: 8 }}>
            <Chip label={keepPhoto ? '사진도 함께 보관함' : '사진은 보관하지 않음'} on={keepPhoto} onPress={() => setKeepPhoto((v) => !v)} />
            <Chip label="사진 치우기" onPress={() => setPhoto(null)} />
          </Row>
        </View>
      ) : null}
      </>}
      <BookPicker
        lib={lib}
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setBookId(id);
          setPicking(false);
        }}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  book: { flexDirection: 'row', alignItems: 'center', gap: 22, paddingTop: 10, paddingBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  cover: { width: 84, minHeight: 110, alignItems: 'center', justifyContent: 'center' },
  noCover: { height: 116, borderRadius: 4, backgroundColor: '#F1EAE2', borderWidth: 1, borderColor: colors.rule, borderStyle: 'dashed' },
  noCoverText: { fontSize: 14, color: colors.inkFaint },
  bookTitle: { fontWeight: '700', fontSize: 19, color: colors.title },
  drop: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#CFC6B6', borderRadius: 12, paddingVertical: 28, paddingHorizontal: 16, alignItems: 'center', gap: 12, backgroundColor: '#FBF6EE' },
  photoLink: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, alignSelf: 'flex-start' },
  photoLinkText: { fontSize: 14.5, color: colors.ink },
});
