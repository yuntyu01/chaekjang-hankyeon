// 갈피 남기기(2026-11-05 사용자 '전이 나은데 버튼도 전처럼, 찍고 나야지 문장을 쓰는 것 아닌가'): 책 → 사진 버튼 → 문장 → 쪽수 → 메모 순서.
// - 문장은 바로 적어도 되고, 사진을 찍거나 골라 간직할 부분을 자르면 기기 안 문장 인식이 바로 돌아 문장 칸을 채운다(사진은 밖으로 보내지 않는다). 읽은 글자는 사진과 비교해 고칠 수 있고, 인식하지 못한 부분을 지어내지 않는다.
// - 사진을 고른 뒤 '사진만 저장'을 켜면 글자 없이 종이·테이프 갈피 모양의 사진으로 저장한다. 끄면 원본 사진을 함께 보관할지 고른다.
// 저장에 실패하면 글·사진을 그대로 두고 다시 시도할 수 있다.
// 책은 들어올 때 고른 값을 유지하고, 책 고르기에서 새 책을 등록하면 이 화면으로 돌아와 그 책을 고른다. 쪽수·한 줄 메모는 선택(메모는 공유 이미지에 넣지 않는다).
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { BookPicker } from '@/features/bookmark/BookPicker';
import { PhotoPlate } from '@/features/bookmark/PhotoPlate';
import { lowConfidenceLines, ocrText, type LineMode } from '@/domain/ocr-text';
import { ocr } from '@/services/connectors';
import { deniedMessage, pickPhoto } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { uiBus } from '@/store/ui-bus';
import { Btn, Chip, Field, ListItem, Loading, Muted, Notice, Row, Screen, SelectField, Toggle } from '@/ui/kit';
import { space } from '@/ui/theme';
import type { OcrResult } from '../../../modules/text-recognition';

type Photo = { uri: string; ratio?: number };
type Recog = { uri: string; state: 'running' } | { uri: string; state: 'done'; result: OcrResult } | { uri: string; state: 'failed'; message: string };

export default function NewBookmark() {
  // session: 독서를 끝내고 저장한 기록에서 왔을 때 그 기록 id(갈피에 선택적으로 연결). 갈피 탭에서 쓰면 없다
  const { book, text: initialText, page: initialPage, mode: initialMode, session, boardX, boardY } = useLocalSearchParams<{ boardX?: string; boardY?: string; book?: string; text?: string; page?: string; mode?: string; session?: string }>();
  const { lib } = useLibrary();
  const { width: winW } = useWindowDimensions();
  const [bookId, setBookId] = useState<string | undefined>(book && lib.books[book] ? book : undefined);
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState(initialText ?? '');
  const [page, setPage] = useState(initialPage ?? '');
  const [memo, setMemo] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  // 갈피 탭의 '사진 갈피'로 들어오면 사진만 저장을 켠 채로
  const [photoOnly, setPhotoOnly] = useState(initialMode === 'photo');
  const [keepPhoto, setKeepPhoto] = useState(true); // 글자로 저장할 때 원본 사진도 함께 보관
  const [lineMode, setLineMode] = useState<LineMode>('join');
  const [recog, setRecog] = useState<Recog | null>(null);
  const edited = useRef(false); // 인식 결과를 사용자가 고쳤으면 줄 방식을 바꿀 때 덮어쓰지 않는다
  const [msg, setMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const e = bookId ? lib.editions[lib.books[bookId]?.editionId] : undefined;
  const asPhoto = !!photo && photoOnly;
  const canSave = !!bookId && !saving && (asPhoto ? true : !!text.trim());

  // 책 고르기 → 새 책 등록 → 돌아오면 그 책을 고른다
  useFocusEffect(
    useCallback(() => {
      const id = uiBus.takePickedBook();
      if (id && libraryStore.get().lib.books[id]) setBookId(id);
    }, []),
  );

  const runOcr = async (p: Photo) => {
    if (!ocr.available || !ocr.recognize) return;
    setRecog({ uri: p.uri, state: 'running' });
    try {
      const result = await ocr.recognize(p.uri);
      setRecog((r) => (r?.uri === p.uri ? { uri: p.uri, state: 'done', result } : r));
      // 비어 있던 문장만 채운다(직접 적은 글을 덮지 않는다)
      setText((t) => (t.trim() ? t : ocrText(result, lineMode)));
      edited.current = false;
    } catch (err) {
      setRecog((r) => (r?.uri === p.uri ? { uri: p.uri, state: 'failed', message: String((err as Error)?.message ?? err) } : r));
    }
  };

  const fromPhoto = async (from: 'camera' | 'library') => {
    // 간직할 부분 자르기·돌리기는 사진 고르기 단계의 자르기 화면에서
    const r = await pickPhoto(from, { crop: true });
    if (!r.ok) {
      if (r.reason === 'denied') setMsg(deniedMessage(from));
      else if (r.reason === 'error') setMsg(`사진을 가져오지 못했어요. ${r.message ?? ''}`);
      return;
    }
    const p = { uri: r.uri, ratio: r.width && r.height ? r.width / r.height : undefined };
    setPhoto(p);
    setMsg(null);
    setRecog(null);
    if (!photoOnly) void runOcr(p);
  };

  const choosePhotoOnly = (on: boolean) => {
    setPhotoOnly(on);
    // 글자로 저장으로 돌아오면 아직 읽지 않은 사진을 읽는다(같은 사진은 한 번만)
    if (!on && photo && recog?.uri !== photo.uri) void runOcr(photo);
  };

  const changeLineMode = (m: LineMode) => {
    setLineMode(m);
    if (recog?.state === 'done' && !edited.current) setText(ocrText(recog.result, m));
  };

  const save = async () => {
    if (!canSave || !bookId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const n = Number(page);
      const photoUri = photo && (asPhoto || keepPhoto) ? await keepImage(photo.uri, 'page') : undefined;
      // 갈피 보드의 '+ 갈피'에서 왔으면 그때 보던 곳의 빈 자리에 붙인다. 그 밖에는 자리를 비워 두면 보드가 자동으로 놓는다
      const spot = boardX && boardY && Number.isFinite(Number(boardX)) && Number.isFinite(Number(boardY)) ? { boardX: Number(boardX), boardY: Number(boardY) } : {};
      const id = libraryStore.addBookmark({ ...spot, myBookId: bookId, text: text.trim(), page: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined, memo: memo.trim() || undefined, photoUri, photoRatio: photoUri ? photo?.ratio : undefined, sessionId: session && lib.sessions[session] && lib.sessions[session].myBookId === bookId ? session : undefined });
      await libraryStore.flushPending();
      // 화면을 바꾼 뒤에는 이 화면의 상태를 건드리지 않는다: 사라지는 화면 갱신과 새 화면 붙이기가 한 프레임에 겹치면
      // 새 구조(Fabric)가 'The specified child already has a parent'로 앱을 죽였다(2026-11-01 에뮬 재현)
      router.replace(`/bookmark/${id}`);
    } catch (err) {
      // 적은 글·사진은 이 화면에 그대로 있다
      setSaveError(`저장하지 못했어요. 적은 내용과 사진은 그대로 있어요. 다시 시도해 주세요. (${String((err as Error)?.message ?? err)})`);
      setSaving(false);
    }
  };

  const recognizing = recog?.state === 'running';
  const empty = recog?.state === 'done' && !ocrText(recog.result, 'keep');
  const unsure = recog?.state === 'done' ? lowConfidenceLines(recog.result) : 0;

  return (
    <Screen title="갈피 남기기" footer={<Btn label="갈피 저장" onPress={save} busy={saving} disabled={!canSave} />}>
      <View style={{ height: space.m }} />
      <SelectField label="책" value={e?.title} sub={e?.authors.length ? e.authors.join(', ') : undefined} placeholder="책을 골라 주세요" onPress={() => setPicking(true)} />

      {!photo ? (
        <View style={{ marginBottom: space.l }}>
          <Muted style={{ marginBottom: space.s }}>사진을 찍으면 글자를 바로 읽어 아래에 채워요</Muted>
          <Row style={{ flexWrap: 'nowrap' }}>
            <Btn label="페이지 찍기" kind="secondary" size="s" onPress={() => fromPhoto('camera')} style={{ flex: 1 }} />
            <Btn label="사진 고르기" kind="secondary" size="s" onPress={() => fromPhoto('library')} style={{ flex: 1 }} />
          </Row>
          {msg ? <Muted style={{ marginTop: space.s }}>{msg}</Muted> : null}
        </View>
      ) : null}

      {photo ? (
        <View style={{ marginBottom: space.l }}>
          <View style={{ alignItems: 'center' }}>
            {/* 자른 사진(눌러서 크게 보기). 사진만 저장이면 이 모양 그대로 저장된다 */}
            <PhotoPlate uri={photo.uri} ratio={photo.ratio} width={Math.min(photoOnly ? 300 : 220, winW - space.page * 2)} seed="new" />
            <Row style={{ marginTop: space.s, justifyContent: 'center' }}>
              <Chip label="다시 찍기" onPress={() => fromPhoto('camera')} />
              <Chip label="다른 사진" onPress={() => fromPhoto('library')} />
              <Chip label="사진 빼기" onPress={() => { setPhoto(null); setRecog(null); }} />
            </Row>
          </View>
          <ListItem label="사진만 저장" sub="글자 없이 사진 그대로 남겨요" right={<Toggle label="사진만 저장" value={photoOnly} onValueChange={choosePhotoOnly} />} />
          {!photoOnly ? (
            <>
              {!ocr.available ? <Notice>{ocr.reason}</Notice> : null}
              {recognizing ? <Loading label="사진 속 글자를 읽는 중이에요" /> : null}
              {recog?.state === 'failed' || empty ? (
                <View style={{ gap: space.s, marginTop: space.s }}>
                  <Notice tone="error">{recog?.state === 'failed' ? '글자를 읽지 못했어요. 다시 읽거나, 직접 적거나, 사진만 저장할 수 있어요.' : '사진에서 글자를 찾지 못했어요. 글자가 크고 반듯하게 보이도록 다시 찍거나, 직접 적거나, 사진만 저장할 수 있어요.'}</Notice>
                  <Btn label="다시 읽기" kind="secondary" size="s" onPress={() => void runOcr(photo)} />
                </View>
              ) : null}
              {recog?.state === 'done' && !empty ? (
                <View style={{ marginTop: space.s }}>
                  <Muted>읽은 글자를 사진과 비교해 고쳐 주세요.{unsure ? ` 흐릿하게 읽힌 줄이 ${unsure}개 있어요.` : ''}</Muted>
                  <Row style={{ marginTop: space.s }}>
                    <Chip label="줄 끝 이어 쓰기" on={lineMode === 'join'} onPress={() => changeLineMode('join')} />
                    <Chip label="줄바꿈 그대로(시)" on={lineMode === 'keep'} onPress={() => changeLineMode('keep')} />
                  </Row>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {!asPhoto ? (
        <Field label="문장" value={text} onChangeText={(t) => { setText(t); edited.current = true; }} placeholder="마음에 남은 문장을 옮겨 적어 주세요" multiline style={{ minHeight: 160 }} />
      ) : null}
      {photo && !photoOnly ? <ListItem label="원본 사진도 보관" right={<Toggle label="원본 사진도 보관" value={keepPhoto} onValueChange={setKeepPhoto} />} /> : null}

      <Field label="쪽수 (선택)" unit="쪽" value={page} onChangeText={setPage} keyboardType="number-pad" />
      <Field label="한 줄 메모 (선택)" value={memo} onChangeText={setMemo} placeholder="나만 보는 메모예요. 공유 이미지에는 넣지 않아요" multiline submitBehavior="blurAndSubmit" returnKeyType="done" style={{ minHeight: 80 }} />
      {saveError ? <Notice tone="error">{saveError}</Notice> : null}

      <BookPicker
        lib={lib}
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          if (id) setBookId(id);
          setPicking(false);
        }}
        onAddNew={() => {
          setPicking(false);
          router.push({ pathname: '/book/add', params: { returnTo: 'pick' } });
        }}
      />
    </Screen>
  );
}
