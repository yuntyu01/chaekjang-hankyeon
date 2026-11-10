// 책 공유(2026-11-09 사용자 '책 공유할 때 밑에 한줄평이랑 별점이랑'): 카드 미리보기 → 넣을 것 고르기 → 사진첩에 저장 또는 이미지로 공유(11-10 '밑에 다운로드 공유').
// 한 줄 감상·별점은 여기서 바로 적을 수 있고 책 기록(평가 칸)에 그대로 저장된다. 이미지는 미리보기와 같은 그림을 폭 1080px로 따로 그린다(기기 화면 폭과 상관없이 같은 모양)
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { bookShareData, DEFAULT_PARTS, type ShareParts } from '@/features/book/book-share';
import { BookShareCard } from '@/features/book/BookShareCard';
import { renderShareCardBase64, shareInputOf, useShareScene } from '@/features/book/useShareScene';
import { gallerySaveAvailable, savePngBase64, shareErrorTitle, ShareImageError, sharePngBase64 } from '@/services/share-image';
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
  // shot의 note·rating: 시안과 같은 내용으로 비교 사진을 찍을 때 덮어쓴다(측정 번들만, note의 '|'는 줄바꿈)
  const { id, shot, note: noteQ, rating: ratingQ } = useLocalSearchParams<{ id: string; shot?: string; note?: string; rating?: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const { width } = useWindowDimensions();
  const b = lib.books[id];
  const [note, setNote] = useState(b?.note ?? '');
  const [parts, setParts] = useState<ShareParts>(DEFAULT_PARTS);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2400);
    return () => clearTimeout(t);
  }, [saved]);
  const placed = place.books[id];
  const base = useMemo(() => bookShareData(lib, id, placed), [lib, id, placed]);
  // 그림 재료(바탕·오버레이·글꼴·표지)는 한 번 불러 미리보기와 내보내기가 함께 쓴다. 표지를 기다리는 동안 내보내기는 잠깐 기다린다
  const scene = useShareScene(base?.book);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
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
        <BookShareCard data={{ ...data, ...(noteQ ? { note: noteQ.replace(/\|/g, '\n') } : null), ...(ratingQ ? { rating: Number(ratingQ) } : null) }} parts={parts} width={EXPORT_W} scene={scene} />
      </ScrollView>
    );
  const has: Record<keyof ShareParts, boolean> = { note: !!data.note, rating: !!data.rating, time: !!data.readTime, period: !!data.period };
  const saveNote = () => {
    const v = note.trim() || undefined;
    if (v !== (b.note ?? undefined)) libraryStore.updateBook(id, { note: v });
  };
  // 저장·공유 모두 같은 그림(폭 1080px)을 그린다
  const run = async (kind: 'save' | 'share') => {
    if (busy) return;
    saveNote();
    setBusy(kind);
    try {
      // 표지를 받는 중이면 잠깐(최대 6초) 기다린다. 끝내 없으면 표지 색으로 그린다
      for (let t = 0; t < 6000 && (!sceneRef.current.assets || sceneRef.current.coverWaiting); t += 150) await new Promise((r) => setTimeout(r, 150));
      const A = sceneRef.current.assets;
      const png = A ? renderShareCardBase64(A, shareInputOf(data, parts)) : null;
      if (!png) throw new ShareImageError('image', '카드 이미지를 만들지 못했어요. 다시 눌러 주세요.');
      if (kind === 'save') {
        await savePngBase64(png, { name: 'chaekjang_book' });
        setSaved(true);
      } else await sharePngBase64(png, { name: 'chaekjang_book', dialogTitle: '책 공유' });
    } catch (e) {
      appAlert(shareErrorTitle(e), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // 미리보기는 화면에 맞춰 줄인 같은 카드(옵션이 보이게 화면 폭의 3/4 정도)
  const previewW = Math.min(width - space.page * 2, Math.max(260, width * 0.74), 380);
  return (
    <View style={{ flex: 1 }}>
      <Screen
        title="책 공유"
        compact
        footer={
          <View style={st.actions}>
            {gallerySaveAvailable ? <Btn label={saved ? '저장했어요' : '저장'} kind="secondary" size="l" busy={busy === 'save'} disabled={!!busy && busy !== 'save'} onPress={() => void run('save')} style={st.action} /> : null}
            <Btn label="공유" size="l" busy={busy === 'share'} disabled={!!busy && busy !== 'share'} onPress={() => void run('share')} style={st.action} />
          </View>
        }
      >
        <View style={st.previewWrap}>
          <View style={st.preview}>
            <BookShareCard data={data} parts={parts} width={previewW} scene={scene} />
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
    </View>
  );
}

const st = StyleSheet.create({
  previewWrap: { alignItems: 'center', marginTop: space.s },
  // 바탕이 흰색이라 카드 가장자리를 옅은 선과 그림자로 보인다(내보내는 그림에는 없다)
  preview: { borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: 'rgba(25,31,40,0.08)' }] },
  actions: { flexDirection: 'row', gap: space.s },
  action: { flex: 1 },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: space.touch, marginBottom: space.m },
});
