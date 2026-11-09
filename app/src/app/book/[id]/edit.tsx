// 책 정보 수정(판본 정보). 잘못 인식·입력한 값을 고친다. 비운 값은 '확인 전'이 된다.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { pickPhoto, deniedMessage } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Empty, Field, H2, Muted, RealCover, Row, Screen } from '@/ui/kit';
import { useLeaveGuard } from '@/ui/leave-guard';
import { colors, space } from '@/ui/theme';

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function EditBook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const [f0] = useState(() => ({
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
  const [f, setF] = useState(f0);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 고친 칸이 있으면 나가기 전에 묻는다(2026-11-09). 저장하고 닫을 때는 풀어 둔다
  const release = useLeaveGuard(JSON.stringify(f) !== JSON.stringify(f0), '고친 내용');
  if (!b || !e)
    return (
      <Screen title="책 정보 수정">
        <Empty title="책을 찾을 수 없어요" body="삭제되었거나 예시 책장 책이에요." action="책장으로" onAction={() => router.dismissTo('/')} />
      </Screen>
    );
  const save = async () => {
    if (saving) return;
    let coverUri = f.coverUri;
    if (coverUri !== e.coverUri && f.coverSource === 'photo' && coverUri) {
      // 사진을 앱 안으로 옮기는 동안 두 번 눌리지 않게, 실패하면 알린다(2026-11-09 점검: 조용히 멈췄다)
      setSaving(true);
      try {
        coverUri = await keepImage(coverUri, 'cover');
      } catch {
        setSaving(false);
        setMsg('표지 사진을 저장하지 못했어요. 다시 골라 주세요.');
        return;
      }
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
    release();
    router.back();
  };
  return (
    <Screen title="책 정보 수정" footer={<Btn label="저장" onPress={save} busy={saving} disabled={!f.title.trim()} />}>
      {/* 책 추가 '책 확인'과 같은 짜임: 표지 96 · 사이 16 · 작은 보조 버튼 */}
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start', marginTop: space.m }} gap={space.l}>
        <RealCover uri={f.coverUri} title={f.title} color={colors.input} width={96} />
        <View style={{ flex: 1, gap: space.s, alignItems: 'flex-start' }}>
          <Btn
            label="표지 사진 바꾸기"
            kind="secondary"
            size="s"
            onPress={async () => {
              const r = await pickPhoto('library');
              if (r.ok) setF({ ...f, coverUri: r.uri, coverSource: 'photo' });
              else if (r.reason === 'denied') setMsg(deniedMessage('library'));
            }}
          />
          {f.coverUri ? <Btn label="표지 지우기" kind="ghost" size="s" onPress={() => setF({ ...f, coverUri: undefined, coverSource: undefined })} style={{ paddingHorizontal: 0 }} /> : null}
          {msg ? <Muted>{msg}</Muted> : null}
        </View>
      </Row>
      {/* 기본 정보(제목 필수) / 추가 서지정보(모두 선택)를 구역 이름과 간격으로 나눈다. 입력칸 바깥에 카드를 겹치지 않는다 */}
      <H2>기본 정보</H2>
      <Field label="제목 (필수)" value={f.title} onChangeText={(t) => setF({ ...f, title: t })} />
      <Field label="저자 (선택)" value={f.authors} onChangeText={(t) => setF({ ...f, authors: t })} />
      <H2>추가 서지정보 (선택)</H2>
      <Field label="출판사" value={f.publisher} onChangeText={(t) => setF({ ...f, publisher: t })} />
      <Field label="출간" value={f.publishedAt} onChangeText={(t) => setF({ ...f, publishedAt: t })} placeholder="YYYY 또는 YYYY-MM" />
      <Field label="ISBN" value={f.isbn} onChangeText={(t) => setF({ ...f, isbn: t })} keyboardType="number-pad" />
      <Field label="쪽수" value={f.pages} onChangeText={(t) => setF({ ...f, pages: t })} keyboardType="number-pad" hint="비우면 ‘확인 전’으로 표시돼요." />
      <Row style={{ flexWrap: 'nowrap' }} gap={space.m}>
        <View style={{ flex: 1 }}>
          <Field label="판형 가로(mm)" value={f.width} onChangeText={(t) => setF({ ...f, width: t })} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="판형 세로(mm)" value={f.height} onChangeText={(t) => setF({ ...f, height: t })} keyboardType="number-pad" />
        </View>
      </Row>
      <Muted>크기를 바꾸면 책장에서 책 크기도 바뀌어요. 자리가 모자라면 그 선반 끝 책이 책장에서 빠질 수 있어요(전체 책에는 그대로 있어요).</Muted>
    </Screen>
  );
}
