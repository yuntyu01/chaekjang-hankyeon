// 갈피 작성 두 가지: 문장 갈피(직접 입력) / 사진 갈피(페이지를 찍어 그대로 붙인다. 옮겨 적기는 선택).
// 문장 갈피: 쪽수·한 줄 메모는 선택, 날짜는 자동.
// 사진으로 가져오기: 페이지 촬영/선택 → (OCR 연결되면) 문장 선택 → 수정·확인 → 저장. 페이지 전체를 자동으로 저장하지 않는다.
// OCR이 연결되지 않은 지금은 사진을 보면서 옮겨 적는다(사진은 선택해서 함께 보관).
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ImageIcon } from '@/ui/icons';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { BookPicker } from '@/features/bookmark/BookPicker';
import { PhotoPlate } from '@/features/bookmark/PhotoPlate';
import { ocr } from '@/services/connectors';
import { deniedMessage, pickPhoto } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Card, Chip, Field, Muted, Row, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

export default function NewBookmark() {
  const { book, text: initialText, page: initialPage, mode: initialMode } = useLocalSearchParams<{ book?: string; text?: string; page?: string; mode?: string }>();
  const [mode, setMode] = useState<'text' | 'photo'>(initialMode === 'photo' ? 'photo' : 'text');
  const [ratio, setRatio] = useState<number | undefined>();
  const isPhoto = mode === 'photo';
  const { lib } = useLibrary();
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

  return (
    <Screen title={isPhoto ? '사진 갈피 남기기' : '갈피 남기기'} footer={<Btn label="갈피 저장" onPress={save} busy={saving} disabled={!canSave} />}>
      <Row gap={8} style={{ marginBottom: 14 }}>
        {([['text', '문장'], ['photo', '사진']] as const).map(([k, label]) => <Chip key={k} label={label} on={mode === k} onPress={() => setMode(k)} />)}
      </Row>
      <Muted>연결할 책</Muted>
      <Pressable onPress={() => setPicking(true)} accessibilityRole="button" style={{ marginTop: 6, marginBottom: 16 }}>
        <Card>
          <Text style={{ fontFamily: fonts.serif, fontSize: 16, color: e ? colors.ink : colors.inkSoft }}>{e ? e.title : '책을 골라 주세요'}</Text>
          {e?.authors.length ? <Muted style={{ marginTop: 2 }}>{e.authors.join(', ')}</Muted> : null}
        </Card>
      </Pressable>

      {isPhoto ? (
        <View style={{ marginBottom: 14 }}>
          {photo ? (
            <View style={{ alignItems: 'center' }}>
              <PhotoPlate uri={photo} ratio={ratio} width={320} seed="new" />
              <Row style={{ marginTop: 10 }}>
                <Chip label="다시 찍기" onPress={() => fromPhoto('camera')} />
                <Chip label="다른 사진" onPress={() => fromPhoto('library')} />
              </Row>
            </View>
          ) : (
            <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: '#CFC6B6', borderRadius: 10, paddingVertical: 28, paddingHorizontal: 16, alignItems: 'center', gap: 12, backgroundColor: '#FBF6EE' }}>
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
      <Field label={isPhoto ? '옮겨 적기 (선택, 검색에 쓰여요)' : '문장'} value={text} onChangeText={setText} placeholder={isPhoto ? '사진 속 문장을 적어 두면 찾기 쉬워요' : '마음에 남은 문장을 옮겨 적어 주세요'} multiline style={{ fontFamily: fonts.serif, fontSize: 16, lineHeight: 28, minHeight: isPhoto ? 90 : 140 }} />
      <Row style={{ flexWrap: 'nowrap' }} gap={10}>
        <View style={{ width: 110 }}>
          <Field label="쪽수 (선택)" value={page} onChangeText={setPage} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="한 줄 메모 (선택)" value={memo} onChangeText={setMemo} placeholder="공유 이미지에는 넣지 않아요" />
        </View>
      </Row>

      {isPhoto ? null : <>
      <Muted style={{ marginTop: 8 }}>사진으로 가져오기</Muted>
      <Row style={{ marginTop: 8, flexWrap: 'nowrap' }}>
        <Btn label="페이지 찍기" kind="secondary" icon={<Camera size={16} color={colors.ink} strokeWidth={1.6} />} onPress={() => fromPhoto('camera')} style={{ flex: 1 }} />
        <Btn label="사진 고르기" kind="secondary" icon={<ImageIcon size={16} color={colors.ink} strokeWidth={1.6} />} onPress={() => fromPhoto('library')} style={{ flex: 1 }} />
      </Row>
      {msg ? <Muted style={{ marginTop: 8, lineHeight: 19 }}>{msg}</Muted> : null}
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
