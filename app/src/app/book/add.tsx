// 책 추가: 책 찾기(검색·사진·직접 입력) → 책·판본 확인 → 재장정 미리보기 → 추가하고 책장에 놓기(기본) 또는 보관만 하기.
// 저장한 뒤 다시 묻지 않는다. 자리가 모자랄 때만 새 선반 추가 / 보관만 하기를 고른다(place-books). 보관만 한 책도 전체 책에 있다.
// 검색 결과·표지·쪽수가 없어도 직접 입력과 기본 장정으로 끝낼 수 있다. 추정 크기를 확인된 정보처럼 저장하지 않는다.
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ImageIcon, PenLine, Plus } from '@/ui/icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { BindingEditor, type BindingDraft } from '@/features/book/BindingEditor';
import { buildBookArt, type BookArtParams, type PaletteEntry } from '@/domain/rebinding';
import { coverPalette } from '@/services/cover-palette';
import { STATUS_LABEL } from '@/features/book/labels';
import { bindingFields, READ_STATUSES, rebindInput, type ReadStatus, type SizeMm } from '@/domain/library';
import { candidateDetails, searchBooks, type BookCandidate } from '@/services/book-search';
import { photoIdentify } from '@/services/connectors';
import { deniedMessage, pickPhoto } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore } from '@/store/library-store';
import { placeWithChoice } from '@/features/book/place-books';
import { placementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Btn, Chip, Empty, Field, H2, IconAction, Muted, Notice, RealCover, Row, Screen, SearchField, TextLink } from '@/ui/kit';
import { colors, icon, press, space, type } from '@/ui/screenTheme';

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
  status: ReadStatus;
};

const blank = (source: Draft['source']): Draft => ({ title: '', authors: '', publisher: '', publishedAt: '', isbn: '', pages: '', width: '', height: '', source, status: 'want' });
const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function AddBook() {
  // 주소로 미리 채우기(공유·바로가기용): ?q=검색어 → 바로 검색, ?title=제목 → 직접 입력 확인 단계로
  const params = useLocalSearchParams<{ q?: string; title?: string }>();
  const [step, setStep] = useState<Step>(params.title ? 'confirm' : 'find');
  const [draft, setDraft] = useState<Draft>(() => ({ ...blank('manual'), title: params.title ?? '' }));
  const [binding, setBinding] = useState<BindingDraft | null>(null);
  const [art, setArt] = useState<BookArtParams | null>(null); // 추천 장정(ISBN당 한 번 계산해 판본에 저장)
  const [notice, setNotice] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<'shelf' | 'kept' | null>(null);
  const [saving, setSaving] = useState(false);

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
    }, c.pageCount && c.size ? null : `${c.sourceName} 판본 기록에 ${[c.pageCount ? null : '쪽수', c.size ? null : '판형'].filter(Boolean).join('·')} 정보가 없어요. 알면 적고, 모르면 비워 두세요(장정은 흔한 크기로 만들고 ‘확인 전’으로 표시해요).`);
  };

  const fromPhoto = async (from: 'camera' | 'library') => {
    const r = await pickPhoto(from);
    if (!r.ok) {
      if (r.reason === 'denied') setNotice(deniedMessage(from));
      else if (r.reason === 'error') setNotice(`사진을 가져오지 못했어요. ${r.message ?? ''}`);
      return;
    }
    // 사진은 책을 찾고 장정 참고용으로 쓴다(읽었다는 인증이 아니다). 인식이 연결되지 않은 지금은 실제 표지로만 쓴다.
    toConfirm({ ...blank('photo'), coverUri: r.uri, coverSource: 'photo' }, photoIdentify.available ? null : photoIdentify.reason ?? null);
  };

  // 등록 완료: where 'shelf'(기본)는 바로 책장에 놓고, 'keep'은 책장에 없는 책으로 보관만 한다
  const add = async (where: 'shelf' | 'keep') => {
    if (!binding) return;
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
          art: art ?? undefined,
          coverUri,
          coverSource: coverUri ? draft.coverSource : undefined,
          source: draft.source,
          sourceName: draft.sourceName,
        },
        status: draft.status,
        binding: { ...binding },
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

  if (step === 'find') return <FindStep initial={params.q} notice={notice} onPick={fromCandidate} onPhoto={fromPhoto} onManual={(q) => toConfirm({ ...blank('manual'), title: q })} />;

  if (step === 'confirm')
    return (
      <Screen
        title="책 확인"
        footer={
          <Btn
            label="장정 고르기"
            disabled={!draft.title.trim()}
            busy={saving}
            onPress={async () => {
              // 썸네일은 색 추출에만 쓰고(화면에 그리지 않는다) 결과 장정만 저장한다.
              setSaving(true);
              const palette: PaletteEntry[] | null = draft.coverSource === 'api' ? await coverPalette(draft.coverUri) : null;
              const a = buildBookArt(rebindInput({ isbn13: draft.isbn.replace(/[^\dXx]/g, '') || undefined, title: draft.title.trim(), authors: [], publisher: draft.publisher, publishedAt: draft.publishedAt, pageCount: num(draft.pages), size, category: draft.category, seriesTitle: draft.seriesTitle }, { palette: palette ?? undefined }), new Date().toISOString());
              setArt(a);
              setBinding({ ...bindingFields(a), seed: 0, source: 'default' });
              setSaving(false);
              setStep('binding');
            }}
          />
        }>
        {notice ? <Notice style={{ marginTop: space.item, marginBottom: space.group }}>{notice}</Notice> : null}
        <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap', marginTop: notice ? 0 : space.item }} gap={16}>
          <RealCover uri={draft.coverUri} title={draft.title || '표지'} color={colors.input} width={96} />
          <View style={{ flex: 1, gap: 10 }}>
            <Muted>{draft.coverUri ? (draft.coverSource === 'photo' ? '내가 찍은 사진' : `${draft.sourceName ?? '도서 정보'} 표지`) : '표지가 없어요. 사진을 등록할 수 있어요.'}</Muted>
            {draft.link ? <TextLink label={`${draft.sourceName ?? '판매처'}에서 보기`} tone="soft" onPress={() => void Linking.openURL(draft.link!)} style={{ alignSelf: 'flex-start', marginVertical: -10 }} /> : null}
            <Btn
              label={draft.coverUri ? '사진으로 바꾸기' : '표지 사진 등록'}
              kind="secondary"
              size="s"
              icon={<ImageIcon size={icon.small} color={colors.ink} strokeWidth={icon.stroke} />}
              onPress={async () => {
                const r = await pickPhoto('library');
                if (r.ok) setDraft({ ...draft, coverUri: r.uri, coverSource: 'photo' });
                else if (r.reason === 'denied') setNotice(deniedMessage('library'));
              }}
            />
          </View>
        </Row>
        <View style={{ height: space.group + 4 }} />
        <Field label="제목 (필수)" value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="책 제목" />
        <Field label="저자" value={draft.authors} onChangeText={(t) => setDraft({ ...draft, authors: t })} placeholder="여러 명은 쉼표로" />
        <Field label="출판사" value={draft.publisher} onChangeText={(t) => setDraft({ ...draft, publisher: t })} />
        <Row style={{ flexWrap: 'nowrap' }} gap={10}>
          <View style={{ flex: 1 }}>
            <Field label="ISBN" value={draft.isbn} onChangeText={(t) => setDraft({ ...draft, isbn: t })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="쪽수" value={draft.pages} onChangeText={(t) => setDraft({ ...draft, pages: t })} keyboardType="number-pad" />
          </View>
        </Row>
        <Row style={{ flexWrap: 'nowrap' }} gap={10}>
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
          {READ_STATUSES.map((st) => (
            <Chip key={st} label={STATUS_LABEL[st]} on={draft.status === st} onPress={() => setDraft({ ...draft, status: st })} />
          ))}
        </Row>
      </Screen>
    );

  if (step === 'binding' && binding)
    return (
      <Screen
        title="장정 미리보기"
        footer={
          <View>
            <Btn label="추가하고 책장에 놓기" busy={saving} onPress={() => void add('shelf')} />
            <TextLink label="보관만 하기" tone="soft" disabled={saving} onPress={() => void add('keep')} style={{ marginTop: 2, marginBottom: -8 }} />
          </View>
        }>
        <BindingEditor title={draft.title} author={draft.authors} size={size} pages={num(draft.pages)} value={binding} recommended={{ ...bindingFields(art ?? buildBookArt({ title: draft.title })), seed: 0, source: 'default' }} onChange={setBinding} />
      </Screen>
    );

  // 추가 완료(결과만 알린다. 다시 묻지 않는다)
  return (
    <Screen title="추가했어요" back={false}>
      <Text style={st.doneTitle}>《{draft.title}》을(를) 추가했어요.</Text>
      {placed === null ? null : (
        <View style={{ gap: 10, marginTop: space.section }}>
          <Muted>{placed === 'shelf' ? '책장에 놓았어요. 꾸미기에서 자리와 자세를 바꿀 수 있어요.' : '보관했어요. 전체 책에서 언제든 책장에 놓을 수 있어요.'}</Muted>
          {placed === 'shelf' ? (
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
    </Screen>
  );
}

function FindStep({ initial, notice, onPick, onPhoto, onManual }: { initial?: string; notice: string | null; onPick: (c: BookCandidate) => void; onPhoto: (from: 'camera' | 'library') => void; onManual: (q: string) => void }) {
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
    <Screen title="책 추가">
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
        placeholder="제목이나 저자로 찾기"
        accessibilityLabel="제목이나 저자로 찾기"
        style={{ marginTop: space.item }}
      />
      <View style={st.findMethods}>
        <IconAction label="사진으로 찾기" onPress={() => Alert.alert('사진으로 찾기', '표지 사진을 선택해 주세요.', [{ text: '사진 찍기', onPress: () => onPhoto('camera') }, { text: '사진 고르기', onPress: () => onPhoto('library') }, { text: '취소', style: 'cancel' }])} icon={<Camera size={icon.size + 2} color={colors.inkSoft} strokeWidth={icon.stroke} />} />
        <IconAction label="직접 입력" onPress={() => onManual(q)} icon={<PenLine size={icon.size + 2} color={colors.inkSoft} strokeWidth={icon.stroke} />} />
      </View>
      {notice ? <Muted style={{ marginTop: space.tight }}>{notice}</Muted> : null}

      {err ? (
        <Notice tone="error" style={{ marginTop: space.group }}>
          {err}
        </Notice>
      ) : null}
      {err ? <Btn label="다시 시도" kind="secondary" size="s" onPress={() => run()} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
      {items && !items.length ? <Empty title="찾는 책이 없어요" body="검색어를 바꾸거나 위의 직접 입력으로 추가해 주세요." /> : null}
      {items?.length ? (
        <View style={{ marginTop: space.section - 2 }}>
          <Row gap={12}><Text style={st.resultHeading}>검색 결과</Text><Text style={type.sub}>{items.length}권{provider ? ` · ${provider} 제공` : ''}</Text></Row>
          {/* 책 추가 시안: 표지 76×105, 제목·지은이 두 줄, 오른쪽 갈색 '+', 줄 사이 구분선 없이 여백만 */}
          <View style={{ marginTop: space.tight }}>
            {items.map((c) => (
              <Pressable key={c.key} onPress={() => onPick(c)} style={({ pressed }) => [st.result, pressed && press]} accessibilityRole="button" accessibilityLabel={`${c.title}, ${c.authors.join(', ')}, 추가`}>
                <View style={st.coverShadow}><RealCover uri={c.coverUrl} title={c.title} color={colors.input} width={76} ratio={0.72} /></View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={type.row} numberOfLines={2}>{c.title}</Text>
                  {c.authors.length ? <Text style={st.author} numberOfLines={1}>{c.authors.join(', ')}</Text> : null}
                </View>
                <View style={st.add}><Plus size={28} color={colors.accent} strokeWidth={icon.stroke} /></View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  findMethods: { flexDirection: 'row', alignItems: 'center', marginTop: space.tight },
  result: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 11 },
  author: { ...type.sub, fontSize: 15 },
  resultHeading: { ...type.heading, fontSize: 20 },
  coverShadow: { borderRadius: 3, boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 6, color: 'rgba(118,77,38,0.16)' }] },
  add: { width: space.touch + 4, height: space.touch + 4, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  doneTitle: { ...type.body, fontSize: 17, lineHeight: 26, marginTop: space.item },
});
