// 커뮤니티 공유 초안: 저장한 독서 기록에서 공개할 것만 고른다 → 미리보기 → 게시.
// 고르지 않은 것(메모·날짜·다른 갈피·사진)은 보내지 않는다. 같은 기록은 몇 번 눌러도 게시물 하나(기록 id = clientId).
// 게시한 뒤 개인 기록을 고치거나 지워도 공개본은 따로 남고(지우려면 게시물에서), 게시물을 지워도 개인 기록은 그대로다.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { defaultChoice, sharePayload, shareSourceOf, type ShareChoice } from '@/domain/community-draft';
import { formatDurationPrecise } from '@/domain/library';
import { explainWriteError } from '@/features/community/actions';
import { PostCard } from '@/features/community/PostCard';
import { Unavailable } from '@/features/community/Unavailable';
import { community, communityAvailability, type Availability, type Post } from '@/services/community';
import { useLibrary } from '@/store/library-store';
import { Btn, Choice, Empty, Field, ListGroup, ListItem, Loading, Screen, Toggle } from '@/ui/kit';
import { space, tidyType } from '@/ui/screenTheme';

export default function ShareDraft() {
  const { session } = useLocalSearchParams<{ session: string }>();
  const { lib, loaded } = useLibrary();
  const src = useMemo(() => (session ? shareSourceOf(lib, session) : null), [lib, session]);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [picked, setChoice] = useState<ShareChoice | null>(null);
  const choice = picked ?? (src ? defaultChoice(src) : null);
  const [posting, setPosting] = useState(false);
  useEffect(() => { void communityAvailability().then(setAvail); }, []);

  const title = '커뮤니티에 공유';
  if (!loaded || !avail) return <Screen title={title} tidy><Loading /></Screen>;
  if (!avail.ok) return <Screen title={title} tidy><Unavailable a={avail} onRetry={() => { setAvail(null); void communityAvailability(true).then(setAvail); }} /></Screen>;
  if (!src || !choice) return <Screen title={title} tidy><Empty title="기록을 찾을 수 없어요" /></Screen>;
  const payload = sharePayload(src, choice);
  if (!payload) return <Screen title={title} tidy><Empty title="책과 연결된 기록만 공유할 수 있어요" body="기록 수정에서 책을 연결한 뒤 다시 시도해 주세요." action="기록 고치기" actionKind="secondary" onAction={() => router.replace(`/session/${src.session.id}`)} /></Screen>;
  const set = (p: Partial<ShareChoice>) => setChoice({ ...choice, ...p });
  const preview: Post = { id: 0, userId: 0, nickname: '나', likes: 0, liked: false, comments: 0, mine: true, createdAt: new Date().toISOString(), ...payload };

  const post = async () => {
    setPosting(true);
    try {
      const p = await community.createPost(payload);
      router.replace(`/community/post/${p.id}`);
      return; // 화면을 떠난 뒤에는 상태를 바꾸지 않는다
    } catch (e) {
      explainWriteError(e, '게시하지 못했어요');
    }
    setPosting(false);
  };
  const confirm = () => Alert.alert('이 내용으로 게시할까요?', '다른 독자가 볼 수 있어요. 게시물은 언제든 지울 수 있고, 지워도 내 서재 기록은 그대로예요.', [
    { text: '취소', style: 'cancel' },
    { text: '게시', onPress: () => void post() },
  ]);

  return (
    <Screen title={title} tidy footer={<Btn label="게시하기" size="l" busy={posting} onPress={confirm} />}>
      <Text style={[tidyType.sub, { marginTop: space.tight }]}>공개할 것만 골라 주세요. 메모와 날짜는 공유되지 않아요.</Text>
      <Text style={[tidyType.section, { marginTop: space.group }]}>책</Text>
      <Text style={[tidyType.rowStrong, { marginTop: 4 }]}>{payload.bookTitle}</Text>
      {payload.bookAuthor ? <Text style={tidyType.sub}>{payload.bookAuthor}</Text> : null}
      <ListGroup style={{ marginTop: space.item }}>
        <ListItem label="읽은 시간" sub={formatDurationPrecise(src.durationMs)} right={<Toggle label="읽은 시간 공개" value={choice.duration} onValueChange={(v) => set({ duration: v })} />} />
        {src.pagesRead !== undefined ? <ListItem label="읽은 분량" sub={`${src.pagesRead}쪽`} right={<Toggle label="읽은 분량 공개" value={choice.pages} onValueChange={(v) => set({ pages: v })} />} /> : null}
      </ListGroup>
      {src.quotes.length ? (
        <>
          <Text style={[tidyType.section, { marginTop: space.group, marginBottom: 8 }]}>함께 올릴 갈피 문장 (선택)</Text>
          <View style={{ gap: 8 }}>
            <Choice label="문장 없이" selected={!choice.quoteId} onPress={() => set({ quoteId: undefined })} compact />
            {src.quotes.slice(0, 6).map((q) => (
              <Choice key={q.id} label={q.text.length > 80 ? `${q.text.slice(0, 80)}…` : q.text} sub={[q.page ? `${q.page}쪽` : null, q.sessionId === src.session.id ? '이번 독서에서 남긴 갈피' : null].filter(Boolean).join(' · ') || undefined} selected={choice.quoteId === q.id} onPress={() => set({ quoteId: q.id })} />
            ))}
          </View>
        </>
      ) : null}
      <Field label="한 줄 남기기 (선택)" value={choice.body} onChangeText={(v) => set({ body: v })} maxLength={1000} multiline placeholder="공개로 보여질 글이에요" />
      <Text style={[tidyType.section, { marginTop: space.section }]}>미리보기</Text>
      <PostCard post={preview} full />
    </Screen>
  );
}
