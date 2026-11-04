// 책 추가: 책 찾기(검색·사진·직접 입력) → 책·판본 확인 → 재장정 미리보기 → 추가하고 책장에 놓기(기본) 또는 보관만 하기.
// 저장한 뒤 다시 묻지 않는다. 자리가 모자랄 때만 새 선반 추가 / 보관만 하기를 고른다(place-books). 보관만 한 책도 전체 책에 있다.
// 검색 결과·표지·쪽수가 없어도 직접 입력과 기본 장정으로 끝낼 수 있다. 추정 크기를 확인된 정보처럼 저장하지 않는다.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { BindingEditor, type BindingDraft } from '@/features/book/BindingEditor';
import { buildBookArt, type BookArtParams, type PaletteEntry } from '@/domain/rebinding';
import { coverDominantColor, coverPalette } from '@/services/cover-palette';
import { measureCoverAccents } from '@/services/cover-accent';
import { measureSpineRatios } from '@/services/spine-ratio';
import { STATUS_LABEL } from '@/features/book/labels';
import { bindingFields, READ_STATUSES, rebindInput, type ReadStatus, type SizeMm } from '@/domain/library';
import { candidateDetails, searchBooks, type BookCandidate } from '@/services/book-search';
import { deniedMessage, pickPhoto } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore } from '@/store/library-store';
import { placeWithChoice } from '@/features/book/place-books';
import { placementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { LibraryCover } from '@/ui/BookVisual';
import { ChevronDown, ChevronUp } from '@/ui/icons';
import { Btn, Chip, Empty, Field, H2, Loading, Muted, Notice, RealCover, Row, Screen, SearchField, Sheet, TextLink } from '@/ui/kit';
import { colors, fonts, icon, press, shape, space, type } from '@/ui/theme';

type Step = 'find' | 'confirm' | 'binding' | 'done';

type Draft = {
  title: string;
  authors: string;
  publisher: string;
  publishedAt: string;
  isbn: string;
  pages: string;
  width: string;
  height: string;
  coverUri?: string;
  coverSource?: 'api' | 'photo';
  category?: string;
  seriesTitle?: string;
  source: 'manual' | 'search' | 'photo';
  sourceName?: string;
  link?: string; // 판매처 상품 페이지(YES24 약관: 출처와 링크를 함께 보인다)
  productId?: string; // 제공처 상품 번호(등록 뒤에도 보존)
  status: ReadStatus;
};

const blank = (source: Draft['source']): Draft => ({ title: '', authors: '', publisher: '', publishedAt: '', isbn: '', pages: '', width: '', height: '', source, status: 'want' });
const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function AddBook() {
  // 주소로 미리 채우기(공유·바로가기용): ?q=검색어 → 바로 검색, ?title=제목 → 직접 입력 확인 단계로
  // returnTo=pick: 책 고르기(갈피 작성 등)에서 '새 책 등록'으로 왔다. 추가하면 그 책을 맡기고 쓰던 화면으로 돌아간다
  const params = useLocalSearchParams<{ q?: string; title?: string; returnTo?: string }>();
  const [step, setStep] = useState<Step>(params.title ? 'confirm' : 'find');
  const [draft, setDraft] = useState<Draft>(() => ({ ...blank('manual'), title: params.title ?? '' }));
  const [binding, setBinding] = useState<BindingDraft | null>(null);
  const [art, setArt] = useState<BookArtParams | null>(null); // 추천 장정(ISBN당 한 번 계산해 판본에 저장)
  const [notice, setNotice] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<'shelf' | 'kept' | null>(null);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false); // 책 확인 '추가 정보'(출판사·ISBN·판형·읽기 상태) 펼침

  const size: SizeMm | undefined = num(draft.width) && num(draft.height) ? { widthMm: Math.min(num(draft.width)!, num(draft.height)!), heightMm: Math.max(num(draft.width)!, num(draft.height)!) } : undefined;

  const toConfirm = (d: Draft, msg: string | null = null) => {
    setDraft(d);
    setNotice(msg);
    setStep('confirm');
  };

  // 고르면 그 판본의 상세(쪽수·판형·ISBN)를 읽어 채운다(없으면 비워 둔 채로 확인 단계로)
  const fromCandidate = async (picked: BookCandidate) => {
    setNotice('판본 정보를 확인하는 중…');
    const c = await candidateDetails(picked);
    toConfirm({
      ...blank('search'),
      title: c.title,
      authors: c.authors.join(', '),
      publisher: c.publisher ?? '',
      publishedAt: c.publishedAt ?? '',
      isbn: c.isbn13 ?? '',
      pages: c.pageCount ? String(c.pageCount) : '',
      width: c.size ? String(c.size.widthMm) : '',
      height: c.size ? String(c.size.heightMm) : '',
      coverUri: c.coverUrl,
      coverSource: c.coverUrl ? 'api' : undefined,
      category: c.category,
      seriesTitle: c.seriesTitle,
      sourceName: c.sourceName,
      link: c.link,
      productId: c.productId,
    }, c.pageCount && c.size ? null : `${c.sourceName} 판본 기록에 ${[c.pageCount ? null : '쪽수', c.size ? null : '판형'].filter(Boolean).join('·')} 정보가 없어요. 알면 적고, 모르면 비워 두세요(장정은 흔한 크기로 만들고 ‘확인 전’으로 표시해요).`);
  };

  // 같은 ISBN이 이미 서재에 있으면: 기존 책 보기 / 별도 소장본으로 추가(같은 책을 한 권 더 가진 경우). 다시 읽기는 재등록이 아니라 기존 책에서
  const existingOf = (isbn: string) => {
    const code = isbn.replace(/[^\dXx]/g, '');
    if (!code) return undefined;
    const lib = libraryStore.get().lib;
    return Object.values(lib.books).find((b) => lib.editions[b.editionId]?.isbn13 === code);
  };
  const confirmDuplicate = (isbn: string, go: () => void) => {
    const dup = existingOf(isbn);
    if (!dup) return go();
    Alert.alert('이미 내 서재에 있는 책이에요', '같은 ISBN의 책이 있어요. 다시 읽으려면 그 책에서 ‘다시 읽기’를 하면 지난 기록이 그대로 이어져요. 같은 책을 한 권 더 가지고 있다면 별도 소장본으로 추가할 수 있어요.', [
      { text: '취소', style: 'cancel' },
      { text: '기존 책 보기', onPress: () => router.replace(`/book/${dup.id}`) },
      { text: '별도 소장본으로 추가', onPress: go },
    ]);
  };

  // 추천 장정 계산: 썸네일은 색 추출에만 쓰고(화면에 그리지 않는다) 결과 장정만 저장한다
  const prepareBinding = async () => {
    const palette: PaletteEntry[] | null = draft.coverSource === 'api' ? await coverPalette(draft.coverUri) : null;
    if (draft.coverSource === 'api') await measureSpineRatios([draft.coverUri]); // 책등 사진 비율: 처음 놓을 때부터 실제 두께로(그림은 쓰지 않는다)
    if (draft.coverSource === 'api') await measureCoverAccents([draft.coverUri]); // 갈피 색: 첫 갈피부터 표지 색으로
    // 책 색은 표지에서 가장 넓게 차지하는 색. 못 읽었으면 예전 방식으로 두고 판 번호를 낮춰 다음 시작 때 다시 맞춘다(cover-color-backfill)
    const coverColor = draft.coverSource === 'api' ? await coverDominantColor(draft.coverUri) : null;
    const built = buildBookArt(rebindInput({ isbn13: draft.isbn.replace(/[^\dXx]/g, '') || undefined, title: draft.title.trim(), authors: [], publisher: draft.publisher, publishedAt: draft.publishedAt, pageCount: num(draft.pages), size, category: draft.category, seriesTitle: draft.seriesTitle }, { palette: palette ?? undefined, coverColor: coverColor ?? undefined }), new Date().toISOString());
    const a = draft.coverSource === 'api' && !coverColor ? { ...built, version: 1 } : built;
    const bd: BindingDraft = { ...bindingFields(a), seed: 0, source: 'default' };
    setArt(a);
    setBinding(bd);
    return { a, bd };
  };

  // 등록 완료: where 'shelf'(기본)는 바로 책장에 놓고, 'keep'은 책장에 없는 책으로 보관만 한다
  const add = async (where: 'shelf' | 'keep', chosen?: { a: BookArtParams; bd: BindingDraft }) => {
    const binding_ = chosen?.bd ?? binding;
    const art_ = chosen?.a ?? art;
    if (!binding_) return;
    setSaving(true);
    try {
      let coverUri = draft.coverUri;
      if (coverUri && draft.coverSource === 'photo') coverUri = await keepImage(coverUri, 'cover');
      const id = libraryStore.addBook({
        edition: {
          title: draft.title.trim(),
          authors: draft.authors
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          publisher: draft.publisher.trim() || undefined,
          publishedAt: draft.publishedAt.trim() || undefined,
          isbn13: draft.isbn.replace(/[^\dXx]/g, '') || undefined,
          pageCount: num(draft.pages),
          size,
          category: draft.category,
          seriesTitle: draft.seriesTitle,
          art: art_ ?? undefined,
          coverUri,
          coverSource: coverUri ? draft.coverSource : undefined,
          source: draft.source,
          sourceName: draft.sourceName,
          link: draft.link,
          productId: draft.productId,
        },
        status: draft.status,
        binding: { ...binding_ },
      });
      setAddedId(id);
      // 서재 → 책장 동기화는 addBook 안에서 바로 일어난다(책 모양이 책장 저장소에 들어간 뒤 놓는다)
      if (where === 'keep') {
        placementStore.addToDrawer(id);
        setPlaced('kept');
        setStep('done');
      } else {
        placeWithChoice([id], (n) => {
          setPlaced(n ? 'shelf' : 'kept');
          setStep('done');
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (step === 'find') return <FindStep initial={params.q} notice={notice} onPick={fromCandidate} onManual={(q) => toConfirm({ ...blank('manual'), title: q })} />;

  // 추가 완료(결과만 알린다. 다시 묻지 않는다): 표지 옆에 제목·결과(전시 책장에 놓음 / 전체 책에만 보관).
  // 다른 화면으로 넘어가지 않고 밑에서 올라오는 시트로(2026-11-01 사용자). 닫으면 책 추가를 부른 화면으로(이미 추가했으니 확인 화면에 머물지 않는다)
  const doneLib = libraryStore.get().lib;
  const closeDone = () => {
    if (params.returnTo === 'pick' && addedId) uiBus.offerPickedBook(addedId);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const doneSheet = (
    <Sheet visible={step === 'done'} onClose={closeDone} title="추가했어요">
      <View style={st.doneBlock}>
        {addedId && doneLib.books[addedId] ? <LibraryCover lib={doneLib} id={addedId} width={88} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.rowStrong} numberOfLines={3}>{draft.title}</Text>
          {draft.authors ? <Text style={[type.sub, { marginTop: 2 }]} numberOfLines={1}>{draft.authors}</Text> : null}
          {placed !== null ? (
            <View style={st.doneResult}>
              <Text style={[type.button, { color: colors.accent }]}>{placed === 'shelf' ? '전시 책장에 놓았어요' : '전체 책에만 보관했어요'}</Text>
              <Text style={[type.caption, { marginTop: 2 }]}>{placed === 'shelf' ? '꾸미기에서 자리와 자세를 바꿀 수 있어요.' : '책장에는 아직 없어요. 전체 책에서 언제든 놓을 수 있어요.'}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {placed !== null && params.returnTo === 'pick' && addedId ? (
        <Btn label="이 책으로 계속 쓰기" onPress={closeDone} style={{ marginTop: space.xl }} />
      ) : null}
      {placed === null ? null : (
        <View style={{ gap: space.s, marginTop: space.xl }}>
          {params.returnTo === 'pick' ? null : placed === 'shelf' ? (
            <Btn
              label="책장에서 보기"
              onPress={() => {
                uiBus.focusBook(addedId!);
                router.dismissTo('/');
              }}
            />
          ) : (
            <Btn label="전체 책 보기" onPress={() => router.replace({ pathname: '/books', params: { filter: 'off' } })} />
          )}
          <Btn label="책 정보 보기" kind="secondary" onPress={() => router.replace(`/book/${addedId}`)} />
          <Btn label="한 권 더 추가" kind="ghost" onPress={() => router.replace('/book/add')} />
        </View>
      )}
    </Sheet>
  );

  if (step === 'confirm' || step === 'done')
    return (
      <Screen
        title="책 확인"
        footer={
          // 주요 행동: 추천 장정으로 바로 추가(책장에 놓기). 장정은 고르고 싶을 때만(보조)
          <View>
            <Btn
              label="추천 장정으로 추가"
              disabled={!draft.title.trim() || saving}
              busy={saving}
              onPress={() =>
                confirmDuplicate(draft.isbn, async () => {
                  setSaving(true);
                  try {
                    const chosen = await prepareBinding();
                    await add('shelf', chosen);
                  } finally {
                    setSaving(false);
                  }
                })
              }
            />
            <TextLink
              label="장정 직접 고르기"
              tone="soft"
              disabled={!draft.title.trim() || saving}
              onPress={() =>
                confirmDuplicate(draft.isbn, async () => {
                  setSaving(true);
                  try {
                    await prepareBinding();
                    setStep('binding');
                  } finally {
                    setSaving(false);
                  }
                })
              }
              style={{ marginTop: space.xs, marginBottom: -space.s }}
            />
          </View>
        }>
        {notice ? <Notice style={{ marginTop: space.m, marginBottom: space.l }}>{notice}</Notice> : null}
        {/* 2026-11-01 사용자 시안: 표지 가운데 + '표지 바꾸기', 아래 제공처 한 줄. 입력은 제목(필수)·저자·전체 쪽수만 펼쳐 두고 나머지는 '추가 정보'에 접는다 */}
        <View style={st.coverArea}>
          <View style={st.cover}><RealCover uri={draft.coverUri} title={draft.title || '표지'} color={colors.input} width={120} /></View>
          <Btn
            label={draft.coverUri ? '표지 바꾸기' : '표지 사진 등록'}
            kind="ghost"
            size="s"
            style={st.coverButton}
            onPress={async () => {
              const r = await pickPhoto('library');
              if (r.ok) setDraft({ ...draft, coverUri: r.uri, coverSource: 'photo' });
              else if (r.reason === 'denied') setNotice(deniedMessage('library'));
            }}
          />
          <View style={st.sourceRow}>
            <Text style={type.caption}>{draft.coverUri ? (draft.coverSource === 'photo' ? '내가 찍은 사진' : `${draft.sourceName ?? '도서 정보'} 제공`) : '표지가 없어요'}</Text>
            {draft.link && draft.coverSource !== 'photo' ? (
              <Pressable onPress={() => void Linking.openURL(draft.link!)} hitSlop={8} accessibilityRole="link" accessibilityLabel={`${draft.sourceName ?? '판매처'}에서 원문 보기`} style={({ pressed }) => pressed && press}>
                <Text style={type.caption}>{' · '}<Text style={st.sourceLink}>원문 보기</Text></Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Field label="제목 (필수)" value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="책 제목" />
        <Field label="저자 (선택)" value={draft.authors} onChangeText={(t) => setDraft({ ...draft, authors: t })} placeholder="여러 명은 쉼표로" />
        <Field label="전체 쪽수 (선택)" value={draft.pages} onChangeText={(t) => setDraft({ ...draft, pages: t })} placeholder="쪽수 입력" keyboardType="number-pad" />
        <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} style={({ pressed }) => [st.moreRow, pressed && press]}>
          <View style={{ flex: 1 }}>
            <Text style={type.section}>추가 정보</Text>
            <Text style={[type.caption, { marginTop: 2 }]}>출판사 · ISBN · 판형 · 읽기 상태</Text>
          </View>
          {more ? <ChevronUp size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} /> : <ChevronDown size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} />}
        </Pressable>
        {more ? (
          <View style={{ marginTop: space.s }}>
            <Field label="출판사" value={draft.publisher} onChangeText={(t) => setDraft({ ...draft, publisher: t })} />
            <Field label="ISBN" value={draft.isbn} onChangeText={(t) => setDraft({ ...draft, isbn: t })} keyboardType="number-pad" />
            <Row style={{ flexWrap: 'nowrap' }} gap={space.m}>
              <View style={{ flex: 1 }}>
                <Field label="판형 가로(mm)" value={draft.width} onChangeText={(t) => setDraft({ ...draft, width: t })} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="판형 세로(mm)" value={draft.height} onChangeText={(t) => setDraft({ ...draft, height: t })} keyboardType="number-pad" />
              </View>
            </Row>
            <Muted>쪽수·판형을 모르면 비워 두세요. 책장에는 흔한 크기로 보이고, 상세에는 ‘확인 전’으로 표시돼요.</Muted>
            <H2>읽기 상태</H2>
            <Row>
              {READ_STATUSES.map((st2) => (
                <Chip key={st2} label={STATUS_LABEL[st2]} on={draft.status === st2} onPress={() => setDraft({ ...draft, status: st2 })} />
              ))}
            </Row>
          </View>
        ) : null}
        {doneSheet}
      </Screen>
    );

  if (step === 'binding' && binding)
    return (
      <Screen
        title="장정 미리보기"
        footer={
          <View>
            <Btn label="추가하고 책장에 놓기" busy={saving} onPress={() => void add('shelf')} />
            <TextLink label="보관만 하기" tone="soft" disabled={saving} onPress={() => void add('keep')} style={{ marginTop: space.xs, marginBottom: -space.s }} />
          </View>
        }>
        <BindingEditor title={draft.title} author={draft.authors} size={size} pages={num(draft.pages)} value={binding} recommended={{ ...bindingFields(art ?? buildBookArt({ title: draft.title })), seed: 0, source: 'default' }} realCover={draft.coverUri} onChange={setBinding} />
      </Screen>
    );

  return null;
}

// 책 추가 첫 화면(2026-11-01 사용자): 검색창 → 결과 → 추가가 전부. 사진으로 책 찾기는 이번 범위에서 뺐고(사진은 갈피 문장에 집중),
// 직접 입력은 결과 아래·결과 없음·검색 실패 때의 작은 '직접 등록' 글자 행동으로만 둔다. 결과 사이에는 선 없이 여백만, 누르면 옅은 바탕
function FindStep({ initial, notice, onPick, onManual }: { initial?: string; notice: string | null; onPick: (c: BookCandidate) => void; onManual: (q: string) => void }) {
  const [q, setQ] = useState(initial ?? '');
  const [items, setItems] = useState<BookCandidate[] | null>(null);
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const run = async (text = q) => {
    if (!text.trim()) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setErr(null);
    const r = await searchBooks(text, c.signal);
    if (c.signal.aborted) return;
    setBusy(false);
    if (r.ok) {
      setItems(r.items);
      setProvider(r.provider);
    } else {
      setErr(r.message);
      setItems(null);
    }
  };
  useEffect(() => {
    if (initial) void run(initial);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Screen title="새 책 추가">
      <SearchField
        value={q}
        onChangeText={(t) => {
          setQ(t);
          if (!t) {
            ctrl.current?.abort();
            setBusy(false);
            setItems(null);
            setErr(null);
          }
        }}
        onSubmit={() => run()}
        busy={busy}
        placeholder="새 책 찾기 · 제목이나 저자"
        accessibilityLabel="제목이나 저자로 찾기"
        style={{ marginTop: space.item }}
      />
      {notice ? <Muted style={{ marginTop: space.s }}>{notice}</Muted> : null}

      {/* 상태: 찾는 중(결과가 아직 없을 때) · 오류(다시 시도) · 결과 없음(직접 입력) · 결과 */}
      {busy && !items ? <Loading label="책을 찾는 중이에요" /> : null}
      {err ? (
        <View style={{ marginTop: space.xl, gap: space.s, alignItems: 'flex-start' }}>
          <Notice tone="error" style={{ alignSelf: 'stretch' }}>
            {err}
          </Notice>
          <Btn label="다시 시도" kind="secondary" size="s" onPress={() => run()} />
          <ManualLink onPress={() => onManual(q)} />
        </View>
      ) : null}
      {items && !items.length && !busy ? (
        <Empty title={`‘${q.trim()}’에 맞는 책이 없어요`} body="제목이나 저자 이름을 짧게 줄여 찾거나, 직접 등록할 수 있어요." action="직접 등록" actionKind="secondary" onAction={() => onManual(q)} />
      ) : null}
      {items?.length ? (
        <View style={{ marginTop: space.xl }}>
          {/* 결과 머리: 구역 이름처럼 작게(출처 표시는 YES24 약관) */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={type.sub}>{`검색 결과 ${items.length}권`}</Text>
            {provider ? <Text style={type.caption}>{`${provider} 제공`}</Text> : null}
          </View>
          {/* 표지·제목·저자를 한 묶음으로, 오른쪽 같은 자리에 '추가'. 줄 사이 선 없이 여백만, 누르는 동안 옅은 바탕(화면 끝까지) */}
          <View style={{ marginTop: space.s, marginHorizontal: -space.page }}>
            {items.map((c) => (
              <Pressable key={c.key} onPress={() => onPick(c)} style={({ pressed }) => [st.result, pressed && { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel={`${c.title}, ${c.authors.join(', ')}, 추가`}>
                <View style={st.cover}><RealCover uri={c.coverUrl} title={c.title} color={colors.input} width={56} ratio={0.72} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={type.rowStrong} numberOfLines={2}>{c.title}</Text>
                  {c.authors.length ? <Text style={type.sub} numberOfLines={1}>{c.authors.join(', ')}</Text> : null}
                </View>
                <View style={st.add} pointerEvents="none"><Text style={st.addText}>추가</Text></View>
              </Pressable>
            ))}
          </View>
          <ManualLink onPress={() => onManual(q)} />
        </View>
      ) : null}
    </Screen>
  );
}

// 검색으로 못 찾았을 때만 쓰는 보조 경로
function ManualLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="원하는 책이 없나요? 직접 등록" style={({ pressed }) => [st.manual, pressed && press]}>
      <Text style={type.sub}>원하는 책이 없나요? <Text style={st.manualStrong}>직접 등록</Text></Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  result: { flexDirection: 'row', alignItems: 'center', gap: space.l, paddingVertical: space.m, paddingHorizontal: space.page },
  addText: { fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  manual: { alignSelf: 'center', minHeight: space.touch, justifyContent: 'center', marginTop: space.l },
  manualStrong: { fontFamily: fonts.uiBold, color: colors.accent },
  // 표지 사진 그림자는 옅게(갈색 기 없이)
  cover: { borderRadius: 3, boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 4, color: 'rgba(0,0,0,0.10)' }] },
  // 책 확인: 표지 가운데, 그 아래 회색 '표지 바꾸기'와 제공처 한 줄
  coverArea: { alignItems: 'center', marginTop: space.s, marginBottom: space.l },
  coverButton: { marginTop: space.l, backgroundColor: colors.surface, paddingHorizontal: space.xl },
  sourceRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  sourceLink: { textDecorationLine: 'underline', color: colors.inkSoft },
  moreRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, marginTop: space.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: space.l },
  add: { minHeight: 36, paddingHorizontal: 14, borderRadius: 8, borderWidth: shape.border, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, // 오른쪽 같은 자리의 작은 '추가'
  doneBlock: { flexDirection: 'row', gap: space.l, alignItems: 'flex-start' },
  doneResult: { marginTop: space.m },
});
