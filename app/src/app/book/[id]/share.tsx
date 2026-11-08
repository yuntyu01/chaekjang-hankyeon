// 책 공유(2026-11-09 사용자 '책 공유할 때 밑에 한줄평이랑 별점이랑'): 카드 미리보기 → 넣을 것 고르기 → 이미지로 공유.
// 한 줄 감상·별점은 여기서 바로 적을 수 있고 책 기록(평가 칸)에 그대로 저장된다. 이미지는 폭 360 카드를 화면 뒤에 따로 그려 뜬다(기기 화면 폭과 상관없이 같은 모양)
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ALL_PARTS, bookShareData, type ShareParts } from '@/features/book/book-share';
import { BookShareCard } from '@/features/book/BookShareCard';
import { ShareImageError, shareViewPng } from '@/services/share-image';
import { libraryStore, useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { appAlert } from '@/ui/alert';
import { PERF_ENABLED } from '@/ui/perf';
import { Btn, Chip, Empty, Field, H2, Row, Screen, Stars } from '@/ui/kit';
import { colors, space, type } from '@/ui/theme';

const EXPORT_W = 360;
const PART_LABEL: Record<keyof ShareParts, string> = { note: '한 줄 감상', rating: '별점', time: '독서 시간', period: '읽은 기간' };

export default function BookShareScreen() {
  // shot=1(측정 번들 전용): 내보내는 카드를 폭 360 그대로 화면에 띄운다(에뮬레이터 화면 사진 = 내보내는 그림과 같은 화소)
  const { id, shot } = useLocalSearchParams<{ id: string; shot?: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const { width } = useWindowDimensions();
  const b = lib.books[id];
  const [note, setNote] = useState(b?.note ?? '');
  const [parts, setParts] = useState<ShareParts>(ALL_PARTS);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const shotRef = useRef<View>(null);
  const ready = useRef(false);
  const placed = place.books[id];
  const base = useMemo(() => bookShareData(lib, id, placed), [lib, id, placed]);
  if (PERF_ENABLED) console.log('[share] open', id);
  if (!b || !base)
    return (
      <Screen title="책 공유">
        <Empty title="책을 찾을 수 없어요" action="책장으로" onAction={() => router.dismissTo('/')} />
      </Screen>
    );
  const data = { ...base, note: note.trim() || undefined };
  if (PERF_ENABLED && shot === '1')
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}>
        <BookShareCard data={data} parts={parts} width={EXPORT_W} />
      </ScrollView>
    );
  const has: Record<keyof ShareParts, boolean> = { note: !!data.note, rating: !!data.rating, time: !!data.readTime, period: !!data.period };
  const saveNote = () => {
    const v = note.trim() || undefined;
    if (v !== (b.note ?? undefined)) libraryStore.updateBook(id, { note: v });
  };
  const share = async () => {
    if (busy) return;
    saveNote();
    setBusy(true);
    ready.current = false;
    setExporting(true);
    try {
      await shareViewPng(shotRef, { name: 'chaekjang_book', dialogTitle: '책 공유', ready: () => ready.current });
    } catch (e) {
      const err = e as ShareImageError;
      appAlert(err.stage === 'share' ? '공유 창을 열지 못했어요' : err.stage === 'unavailable' ? '공유할 수 없어요' : '공유 이미지를 만들지 못했어요', err.message);
    } finally {
      setExporting(false);
      setBusy(false);
    }
  };
  // 미리보기는 화면에 맞춰 줄인 같은 카드(옵션이 보이게 화면 폭의 3/4 정도)
  const previewW = Math.min(width - space.page * 2, Math.max(260, width * 0.74), 380);
  return (
    <View style={{ flex: 1 }}>
      <Screen title="책 공유" compact footer={<Btn label={busy ? '이미지 만드는 중' : '이미지로 공유'} size="l" disabled={busy} onPress={share} />}>
        <View style={st.previewWrap}>
          <View style={st.preview}>
            <BookShareCard data={data} parts={parts} width={previewW} />
          </View>
        </View>

        <H2>카드에 넣을 것</H2>
        <Row>
          {(Object.keys(PART_LABEL) as (keyof ShareParts)[]).map((k) => (
            <Chip key={k} label={PART_LABEL[k]} on={parts[k] && has[k]} onPress={has[k] ? () => setParts((p) => ({ ...p, [k]: !p[k] })) : undefined} />
          ))}
        </Row>
        {!has.time || !has.period ? <Text style={[type.caption, { marginTop: space.s }]}>{[!has.time ? '독서 시간은 타이머로 읽으면 생겨요' : null, !has.period ? '읽은 기간은 시작일·완독일을 적으면 생겨요' : null].filter(Boolean).join(' · ')}</Text> : null}

        <H2>내 평가</H2>
        <View style={st.rateRow}>
          <Text style={type.row}>별점</Text>
          <Stars value={b.rating} onChange={(v) => libraryStore.updateBook(id, { rating: v })} size={26} />
        </View>
        <Field label="한 줄 감상" value={note} onChangeText={setNote} onEndEditing={saveNote} placeholder="이 책은 나에게…" maxLength={140} multiline submitBehavior="blurAndSubmit" returnKeyType="done" style={{ minHeight: 56 }} />
      </Screen>
      {/* 공유 이미지용(화면 뒤에 같은 카드를 폭 360으로) */}
      {exporting ? (
        <View pointerEvents="none" style={st.shot}>
          <View ref={shotRef} collapsable={false}>
            <BookShareCard data={data} parts={parts} width={EXPORT_W} onReady={() => { ready.current = true; }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  previewWrap: { alignItems: 'center', marginTop: space.s },
  // 바탕이 흰색이라 카드 가장자리를 옅은 선과 그림자로 보인다(내보내는 그림에는 없다)
  preview: { borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: 'rgba(25,31,40,0.08)' }] },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: space.touch, marginBottom: space.m },
  shot: { position: 'absolute', left: 0, top: 0, zIndex: -1 },
});
