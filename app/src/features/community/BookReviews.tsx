// 책 정보의 '독자 후기'(2026-11-01 사용자 시안 '내 기록 | 독자 후기'): 같은 판본(ISBN-13)에 공개로 남긴 후기의 평균·수, 후기 목록, 내 공개 후기(남기기·고치기·지우기).
// 내 별점(개인 기록)과 공개 후기는 따로다: 개인 별점은 자동 공개되지 않고, 공개 후기를 남길 때 처음 값으로만 채워 준다.
// 평가하지 않은 사람은 0점으로 세지 않는다(서버 집계). ISBN이 없거나 커뮤니티를 쓸 수 없는 빌드·서버면 그리지 않는다(available false).
// 요약은 상자 없이 큰 숫자 + 별 하나 + 'N명 평가'(사용자 '누런 상자 말고 지금처럼').
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { explainWriteError } from '@/features/community/actions';
import { community, communityAvailability, errorMessage, type BookReviews as Reviews } from '@/services/community';
import { Btn, Field, Muted, Sheet, Stars, TextLink } from '@/ui/kit';
import { Star } from '@/ui/icons';
import { colors, fonts, space, type } from '@/ui/theme';
import { appAlert } from '@/ui/alert';

export type ReviewsState = { available: boolean; data: Reviews | null; error: string; load: () => Promise<void>; setData: (d: Reviews) => void };

export function useBookReviews(isbn13?: string): ReviewsState {
  const valid = !!isbn13 && /^\d{13}$/.test(isbn13);
  const [on, setOn] = useState(false);
  const [data, setData] = useState<Reviews | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!valid) return;
    setError('');
    try { setData(await community.reviews(isbn13!)); }
    catch (e) { setError(errorMessage(e)); }
  }, [isbn13, valid]);
  useEffect(() => {
    if (!valid) return;
    let live = true;
    void communityAvailability().then((a) => { if (live && a.ok) { setOn(true); void load(); } });
    return () => { live = false; };
  }, [valid, load]);
  return { available: valid && on, data, error, load, setData };
}

// 저자 아래 한 줄: '독자 평점 ★ 3.5 · 2명'(후기가 있을 때만). 평균은 숫자로(3.5를 별 4개처럼 반올림해 보이지 않게)
export function ReaderRating({ data }: { data: Reviews | null }) {
  if (!data?.count || data.average == null) return null;
  return (
    <View style={st.line} accessible accessibilityLabel={`독자 평점 ${data.average.toFixed(1)}점, ${data.count}명`}>
      <Text style={st.lineLabel}>독자 평점</Text>
      <Star size={15} color={colors.star} fill={colors.star} strokeWidth={1.4} />
      <Text style={st.lineValue}>{data.average.toFixed(1)}</Text>
      <Text style={st.lineLabel}>{`· ${data.count}명`}</Text>
    </View>
  );
}

export function ReviewsPane({ isbn13, title, myRating, state }: { isbn13: string; title: string; myRating?: number; state: ReviewsState }) {
  const { data, error, load, setData } = state;
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<number | undefined>();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const open = () => {
    setRating(data?.mine?.rating ?? myRating);
    setBody(data?.mine?.body ?? '');
    setEditing(true);
  };
  const save = async () => {
    if (!rating) return;
    setBusy(true);
    try { setData(await community.saveReview(isbn13, rating, body.trim() || undefined, title)); setEditing(false); }
    catch (e) { explainWriteError(e, '후기를 저장하지 못했어요'); }
    finally { setBusy(false); }
  };
  const remove = () => appAlert('내 공개 후기를 지울까요?', '내 별점(개인 기록)은 그대로예요.', [
    { text: '취소', style: 'cancel' },
    { text: '지우기', style: 'destructive', onPress: () => void community.deleteReview(isbn13).then(setData).catch((e: unknown) => explainWriteError(e, '지우지 못했어요')) },
  ]);

  if (error) return <View style={st.pane}><Muted>후기를 불러오지 못했어요. {error}</Muted><TextLink label="다시 시도" onPress={() => void load()} style={{ alignSelf: 'flex-start' }} /></View>;
  if (!data) return <View style={st.pane}><Muted>불러오는 중…</Muted></View>;
  const others = data.items ?? [];
  const shown = all ? others : others.slice(0, 5);
  return (
    <View style={st.pane}>
      {data.count && data.average != null ? (
        <View style={st.summary} accessible accessibilityLabel={`평균 ${data.average.toFixed(1)}점, ${data.count}명 평가`}>
          <Text style={st.big}>{data.average.toFixed(1)}</Text>
          <Star size={26} color={colors.star} fill={colors.star} strokeWidth={1.4} />
          <Text style={st.count}>{`${data.count}명 평가`}</Text>
        </View>
      ) : (
        <View>
          <Text style={type.section}>아직 독자 후기가 없어요</Text>
          <Text style={[type.sub, { marginTop: space.xs }]}>이 책의 첫 후기를 남겨 보세요.</Text>
        </View>
      )}
      {data.mine ? (
        <View style={st.item}>
          <View style={st.itemHead}>
            <Text style={type.rowStrong}>내 후기</Text>
            <Stars value={data.mine.rating} size={16} />
          </View>
          {data.mine.body ? <Text style={st.body}>{data.mine.body}</Text> : null}
          <View style={st.mineActions}>
            <TextLink label="고치기" tone="soft" onPress={open} />
            <TextLink label="지우기" tone="soft" onPress={remove} />
          </View>
        </View>
      ) : null}
      {shown.map((r) => (
        <View key={r.userId} style={st.item}>
          <View style={st.itemHead}>
            <Text style={type.rowStrong} numberOfLines={1}>{r.nickname}</Text>
            <Stars value={r.rating} size={16} />
          </View>
          {r.body ? <Text style={st.body}>{r.body}</Text> : null}
        </View>
      ))}
      {others.length > 5 && !all ? <TextLink label={`후기 ${others.length}개 모두 보기`} tone="soft" onPress={() => setAll(true)} style={{ alignSelf: 'flex-start', marginTop: space.m }} /> : null}
      {!data.mine ? (
        <View style={st.cta}>
          <Btn label="공개 후기 남기기" size="l" onPress={open} />
          <Text style={st.ctaNote}>게시한 후기는 다른 독자에게 보여요.</Text>
        </View>
      ) : null}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="공개 후기" description={`${title}에 남기는 후기예요. 공개 닉네임과 함께 다른 독자에게 보여요.`}>
        <View style={{ marginVertical: space.xl, alignItems: 'center' }}>
          <Stars value={rating} onChange={setRating} size={34} />
        </View>
        <Field label="한 줄 후기 (선택)" value={body} onChangeText={setBody} maxLength={500} multiline />
        <Btn label="후기 저장" disabled={!rating} busy={busy} onPress={() => void save()} style={{ marginTop: space.item }} />
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.m },
  lineLabel: { ...type.sub, fontSize: 15 },
  lineValue: { fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  pane: { marginTop: space.xl },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  big: { fontFamily: fonts.uiTitle, fontSize: 36, lineHeight: 44, color: colors.ink, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  count: { ...type.sub, marginLeft: space.xs },
  item: { marginTop: space.xl },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  body: { ...type.body, marginTop: space.s },
  mineActions: { flexDirection: 'row', gap: space.l, marginTop: space.xs },
  cta: { marginTop: space.xxl },
  ctaNote: { ...type.caption, textAlign: 'center', marginTop: space.s },
});
