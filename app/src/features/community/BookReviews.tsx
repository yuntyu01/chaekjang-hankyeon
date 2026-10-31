// 책 정보의 '다른 독자 평가': 같은 판본(ISBN-13)에 공개로 남긴 평가의 평균·수, 최근 평가, 내 공개 평가(남기기·고치기·지우기).
// 내 별점(개인 기록)과 공개 평가는 따로다: 개인 별점은 자동 공개되지 않고, 공개 평가를 남길 때 처음 값으로만 채워 준다.
// 평가하지 않은 사람은 0점으로 세지 않는다(서버 집계). ISBN이 없거나 커뮤니티를 쓸 수 없는 빌드·서버면 이 묶음을 그리지 않는다.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { explainWriteError } from '@/features/community/actions';
import { community, communityAvailability, errorMessage, type BookReviews as Reviews } from '@/services/community';
import { Btn, Field, H2, ListGroup, Muted, Sheet, Stars, TextLink } from '@/ui/kit';
import { Star } from '@/ui/icons';
import { colors, space, type } from '@/ui/screenTheme';

export function BookReviews({ isbn13, title, myRating }: { isbn13?: string; title: string; myRating?: number }) {
  const valid = !!isbn13 && /^\d{13}$/.test(isbn13);
  const [on, setOn] = useState(false);
  const [data, setData] = useState<Reviews | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<number | undefined>();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!valid) return;
    setError('');
    try { setData(await community.reviews(isbn13!)); }
    catch (e) { setError(errorMessage(e)); }
  }, [isbn13, valid]);
  useEffect(() => {
    if (!valid) return;
    void communityAvailability().then((a) => { if (a.ok) { setOn(true); void load(); } });
  }, [valid, load]);
  if (!valid || !on) return null;

  const open = () => {
    setRating(data?.mine?.rating ?? myRating);
    setBody(data?.mine?.body ?? '');
    setEditing(true);
  };
  const save = async () => {
    if (!rating) return;
    setBusy(true);
    try { setData(await community.saveReview(isbn13!, rating, body.trim() || undefined, title)); setEditing(false); }
    catch (e) { explainWriteError(e, '평가를 저장하지 못했어요'); }
    finally { setBusy(false); }
  };
  const remove = () => Alert.alert('공개 평가를 지울까요?', '내 별점(개인 기록)은 그대로예요.', [
    { text: '취소', style: 'cancel' },
    { text: '지우기', style: 'destructive', onPress: () => void community.deleteReview(isbn13!).then(setData).catch((e: unknown) => explainWriteError(e, '지우지 못했어요')) },
  ]);

  const others = data?.items ?? [];
  return (
    <View>
      <H2>다른 독자의 평가</H2>
      {error ? (
        <View><Muted>평가를 불러오지 못했어요. {error}</Muted><TextLink label="다시 시도" onPress={() => void load()} style={{ alignSelf: 'flex-start' }} /></View>
      ) : !data ? <Muted>불러오는 중…</Muted> : (
        <>
          {data.count ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessible accessibilityLabel={`평균 ${data.average?.toFixed(1)}점, ${data.count}명 평가`}>
              {/* 평균은 숫자로(3.5를 별 4개처럼 반올림해 보이지 않게). 별 하나는 표시만 */}
              <Star size={18} color={colors.star} fill={colors.star} strokeWidth={1.4} />
              <Text style={type.rowStrong}>{data.average?.toFixed(1)}</Text>
              <Muted>{data.count}명 평가</Muted>
            </View>
          ) : <Muted>아직 공개 평가가 없어요.</Muted>}
          <View style={{ marginTop: space.item, gap: 4 }}>
            <Muted>{myRating ? `내 별점 ${myRating}점 · 나만 보는 기록이에요` : '내 별점은 아직 없어요'}</Muted>
            {data.mine ? (
              <Muted>{`공개 평가 ${data.mine.rating}점으로 함께 집계돼요${data.mine.body ? ` · "${data.mine.body}"` : ''}`}</Muted>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TextLink label={data.mine ? '공개 평가 고치기' : '공개 평가 남기기'} onPress={open} />
            {data.mine ? <TextLink label="공개 평가 지우기" tone="soft" onPress={remove} /> : null}
          </View>
          {others.length ? (
            <ListGroup style={{ marginTop: space.tight }}>
              {(all ? others : others.slice(0, 3)).map((r) => (
                <View key={r.userId} style={{ paddingVertical: 12, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={type.label}>{r.nickname}</Text>
                    <Stars value={r.rating} size={14} />
                  </View>
                  {r.body ? <Text style={type.body}>{r.body}</Text> : null}
                </View>
              ))}
            </ListGroup>
          ) : null}
          {others.length > 3 && !all ? <TextLink label={`평가 ${others.length}개 모두 보기`} tone="soft" onPress={() => setAll(true)} /> : null}
        </>
      )}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="공개 평가">
        <Muted>{`${title}에 남기는 공개 평가예요. 공개 닉네임과 함께 다른 독자에게 보여요.`}</Muted>
        <View style={{ marginVertical: space.group, alignItems: 'center' }}>
          <Stars value={rating} onChange={setRating} size={34} />
        </View>
        <Field label="한 줄 평 (선택)" value={body} onChangeText={setBody} maxLength={500} multiline />
        <Btn label="공개 평가 저장" disabled={!rating} busy={busy} onPress={() => void save()} style={{ marginTop: space.item }} />
      </Sheet>
    </View>
  );
}
