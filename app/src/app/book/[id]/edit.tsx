// 책 정보 수정(판본 정보). 잘못 인식·입력한 값을 고친다. 비운 값은 '확인 전'이 된다.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { pickPhoto, deniedMessage } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Empty, Field, Muted, RealCover, Row, Screen } from '@/ui/kit';
import { colors } from '@/ui/screenTheme';

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function EditBook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
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
  if (!b || !e) return <Screen title="책 정보 수정"><Empty title="책을 찾을 수 없어요" /></Screen>;
  const save = async () => {
    let coverUri = f.coverUri;
    if (coverUri !== e.coverUri && f.coverSource === 'photo' && coverUri) {
      coverUri = await keepImage(coverUri, 'cover');
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
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }} gap={16}>
        <RealCover uri={f.coverUri} title={f.title} color={colors.input} width={90} />
        <View style={{ flex: 1, gap: 8 }}>
          <Btn
            label="표지 사진 바꾸기"
            kind="secondary"
            onPress={async () => {
              const r = await pickPhoto('library');
              if (r.ok) setF({ ...f, coverUri: r.uri, coverSource: 'photo' });
              else if (r.reason === 'denied') setMsg(deniedMessage('library'));
            }}
          />
          {f.coverUri ? <Btn label="표지 지우기" kind="ghost" onPress={() => setF({ ...f, coverUri: undefined, coverSource: undefined })} /> : null}
          {msg ? <Muted>{msg}</Muted> : null}
        </View>
      </Row>
      <View style={{ height: 16 }} />
      <Field label="제목" value={f.title} onChangeText={(t) => setF({ ...f, title: t })} />
      <Field label="저자" value={f.authors} onChangeText={(t) => setF({ ...f, authors: t })} />
      <Field label="출판사" value={f.publisher} onChangeText={(t) => setF({ ...f, publisher: t })} />
      <Field label="출간" value={f.publishedAt} onChangeText={(t) => setF({ ...f, publishedAt: t })} placeholder="YYYY 또는 YYYY-MM" />
      <Field label="ISBN" value={f.isbn} onChangeText={(t) => setF({ ...f, isbn: t })} keyboardType="number-pad" />
      <Field label="쪽수" value={f.pages} onChangeText={(t) => setF({ ...f, pages: t })} keyboardType="number-pad" hint="비우면 ‘확인 전’으로 표시돼요." />
      <Row style={{ flexWrap: 'nowrap' }} gap={10}>
        <View style={{ flex: 1 }}>
          <Field label="판형 가로(mm)" value={f.width} onChangeText={(t) => setF({ ...f, width: t })} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="판형 세로(mm)" value={f.height} onChangeText={(t) => setF({ ...f, height: t })} keyboardType="number-pad" />
        </View>
      </Row>
      <Muted>크기를 바꾸면 책장에서 책 크기도 바뀌어요. 자리가 모자라면 그 선반 끝 책이 서랍으로 옮겨질 수 있어요.</Muted>
    </Screen>
  );
}
