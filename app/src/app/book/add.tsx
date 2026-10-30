// 책 추가: [책 검색 | 직접 입력] 탭. 검색에서 고르면 입력 탭이 그 판본 정보로 채워진다 → 추가할 곳(책장·서랍)을 고르고 '책 추가'(추천 장정).
// 장정을 먼저 고르고 싶으면 '장정 먼저 고르기'로 재장정 미리보기를 거친다. 책장에 자리가 없으면 새 선반·서랍을 제안한다.
// 검색 결과·표지·쪽수가 없어도 직접 입력과 기본 장정으로 끝낼 수 있다. 추정 크기를 확인된 정보처럼 저장하지 않는다.
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronDown, ChevronUp, Search, X } from '@/ui/icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

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
import { placementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Btn, Card, Empty, Field, Muted, RealCover, Row, Screen, Tabs } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

// 카메라 + 더하기(표지 추가)
function CameraPlus() {
  return (
    <Svg width={40} height={35} viewBox="0 0 64 56" fill="none" stroke="#7A6A60" strokeWidth={2.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M44 44H10a5 5 0 0 1-5-5V18a5 5 0 0 1 5-5h7l4-6h14l4 6h5a5 5 0 0 1 5 5v8" />
      <Circle cx={27} cy={27} r={8.5} />
      <Path d="M52 36v14M45 43h14" />
    </Svg>
  );
}

// 빈 표지의 종이 결: 고정 시드의 잔 얼룩·섬유 + 왼쪽 위가 밝은 빛(시안의 무광 종이 표지)
const BLANK_W = 158;
const BLANK_H = 222;
const GRAIN = (() => {
  let x = 11;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const specks = Array.from({ length: 320 }, () => ({ cx: rnd() * BLANK_W, cy: rnd() * BLANK_H, r: 0.25 + rnd() * 0.45, o: 0.03 + rnd() * 0.05, dark: rnd() > 0.4 }));
  let fibers = '';
  for (let i = 0; i < 24; i++) {
    const fx = rnd() * BLANK_W, fy = rnd() * BLANK_H, a = rnd() * Math.PI, l = 3 + rnd() * 7;
    fibers += `M${fx.toFixed(1)} ${fy.toFixed(1)}l${(Math.cos(a) * l).toFixed(1)} ${(Math.sin(a) * l).toFixed(1)}`;
  }
  return { specks, fibers };
})();

function PaperGrain() {
  return (
    <Svg width={BLANK_W} height={BLANK_H} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="blankLight" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.42" />
          <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.08" />
          <Stop offset="1" stopColor="#8A6A50" stopOpacity="0.08" />
        </LinearGradient>
      </Defs>
      <Rect width={BLANK_W} height={BLANK_H} rx={3} fill="url(#blankLight)" />
      <Path d={GRAIN.fibers} stroke="#8A6E58" strokeOpacity={0.045} strokeWidth={0.5} strokeLinecap="round" />
      {GRAIN.specks.map((p, i) => <Circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.dark ? '#7A5E48' : '#FFFFFF'} opacity={p.dark ? p.o : p.o * 1.6} />)}
    </Svg>
  );
}

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
  source: 'manual' | 'search' | 'photo';
  sourceName?: string;
  status: ReadStatus;
};

const blank = (source: Draft['source']): Draft => ({ title: '', authors: '', publisher: '', publishedAt: '', isbn: '', pages: '', width: '', height: '', source, status: 'want' });
const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function AddBook() {
  // 주소로 미리 채우기(공유·바로가기용): ?q=검색어 → 바로 검색, ?title=제목 → 직접 입력 확인 단계로
  const params = useLocalSearchParams<{ q?: string; title?: string; to?: string }>();
  const [step, setStep] = useState<Step>(params.title ? 'confirm' : 'find');
  const [where, setWhere] = useState<'shelf' | 'drawer'>(params.to === 'drawer' ? 'drawer' : 'shelf');
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({ ...blank('manual'), title: params.title ?? '' }));
  const [binding, setBinding] = useState<BindingDraft | null>(null);
  const [art, setArt] = useState<BookArtParams | null>(null); // 추천 장정(ISBN당 한 번 계산해 판본에 저장)
  const [notice, setNotice] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<'shelf' | 'drawer' | 'none' | null>(null);
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
      sourceName: c.sourceName,
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

  // 추천 장정 계산(표지 썸네일은 색 추출에만 쓰고 화면에 그리지 않는다)
  const recommend = async () => {
    const palette: PaletteEntry[] | null = draft.coverSource === 'api' ? await coverPalette(draft.coverUri) : null;
    const a = buildBookArt(rebindInput({ isbn13: draft.isbn.replace(/[^\dXx]/g, '') || undefined, title: draft.title.trim(), authors: [], publisher: draft.publisher, publishedAt: draft.publishedAt, pageCount: num(draft.pages), size, category: draft.category }, { palette: palette ?? undefined }), new Date().toISOString());
    setArt(a);
    return { a, b: { ...bindingFields(a), seed: 0, source: 'default' } as BindingDraft };
  };

  const add = async (pre?: { a: BookArtParams; b: BindingDraft }) => {
    const bd = pre?.b ?? binding;
    const artNow = pre?.a ?? art;
    if (!bd) return;
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
          art: artNow ?? undefined,
          coverUri,
          coverSource: coverUri ? draft.coverSource : undefined,
          source: draft.source,
          sourceName: draft.sourceName,
        },
        status: draft.status,
        binding: { ...bd },
      });
      setAddedId(id);
      place(where, id);
      setStep('done');
    } finally {
      setSaving(false);
    }
  };

  // 추가 직후: 책 모양이 책장 저장소에 들어간 뒤 꽂는다(서재 → 책장 동기화는 바로 일어난다)
  const place = (to: 'shelf' | 'drawer' | 'newShelf', id = addedId) => {
    if (!id) return;
    if (to === 'drawer') {
      placementStore.addToDrawer(id);
      setPlaced('drawer');
      return;
    }
    if (to === 'newShelf') placementStore.addShelf();
    const r = placementStore.addToShelf(id);
    setPlaced(r === 'shelf' ? 'shelf' : 'none');
  };

  const tabs = <Tabs items={[{ id: 'find', label: '책 검색' }, { id: 'confirm', label: '직접 입력' }]} value={step === 'find' ? 'find' : 'confirm'} onChange={(t) => setStep(t)} stretch style={st.tabs} />;
  if (step === 'find') return <FindStep tabs={tabs} initial={params.q} notice={notice} onPick={fromCandidate} onPhoto={fromPhoto} />;

  if (step === 'confirm')
    return (
      <Screen
        title="책 추가"
        footer={
          <Btn
            label="책 추가"
            disabled={!draft.title.trim()}
            busy={saving}
            onPress={async () => {
              setSaving(true);
              const r = await recommend();
              setBinding(r.b);
              await add(r);
            }}
          />
        }>
        {tabs}
        {notice ? (
          <Card style={{ marginTop: 16, backgroundColor: '#F6EEDF' }}>
            <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.ink }}>{notice}</Text>
          </Card>
        ) : null}
        <Pressable
          onPress={async () => {
            const r = await pickPhoto('library');
            if (r.ok) setDraft({ ...draft, coverUri: r.uri, coverSource: 'photo' });
            else if (r.reason === 'denied') setNotice(deniedMessage('library'));
          }}
          accessibilityRole="button"
          accessibilityLabel={draft.coverUri ? '표지 사진 바꾸기' : '표지 추가'}
          style={st.coverWrap}>
          {draft.coverUri ? (
            <View style={st.coverShadow}><RealCover uri={draft.coverUri} title={draft.title || '표지'} color="#B7AE9F" width={150} /></View>
          ) : (
            <View style={st.blankBook}>
              <PaperGrain />
              <View style={st.blankSpine} />
              <View style={st.blankGroove} />
              <CameraPlus />
              <Text style={st.blankText}>표지 추가</Text>
            </View>
          )}
          {draft.coverUri ? <Muted style={{ marginTop: 10 }}>{draft.coverSource === 'photo' ? '내가 찍은 사진 · 눌러서 바꾸기' : `${draft.sourceName ?? '도서 정보'} 표지 · 눌러서 사진으로 바꾸기`}</Muted> : null}
        </Pressable>
        <Field label="제목" value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="책 제목" />
        <Field label="저자" value={draft.authors} onChangeText={(t) => setDraft({ ...draft, authors: t })} placeholder="저자 이름" />
        <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} style={st.more}>
          <View style={{ flex: 1 }}>
            <Text style={st.moreTitle}>상세 정보</Text>
            <Text style={st.moreSub}>출판사 · ISBN · 쪽수 · 판형 · 읽기 상태</Text>
          </View>
          {more ? <ChevronUp size={26} color={colors.ink} strokeWidth={1.5} /> : <ChevronDown size={26} color={colors.ink} strokeWidth={1.5} />}
        </Pressable>
        {more ? (
          <View style={{ paddingTop: 16 }}>
            <Field label="출판사" value={draft.publisher} onChangeText={(t) => setDraft({ ...draft, publisher: t })} />
            <Row style={{ flexWrap: 'nowrap' }} gap={10}>
              <View style={{ flex: 1 }}>
                <Field label="ISBN" value={draft.isbn} onChangeText={(t) => setDraft({ ...draft, isbn: t })} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="쪽수" value={draft.pages} onChangeText={(t) => setDraft({ ...draft, pages: t })} keyboardType="number-pad" suffix="쪽" />
              </View>
            </Row>
            <Row style={{ flexWrap: 'nowrap' }} gap={10}>
              <View style={{ flex: 1 }}>
                <Field label="판형 가로" value={draft.width} onChangeText={(t) => setDraft({ ...draft, width: t })} keyboardType="number-pad" suffix="mm" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="판형 세로" value={draft.height} onChangeText={(t) => setDraft({ ...draft, height: t })} keyboardType="number-pad" suffix="mm" />
              </View>
            </Row>
            <Muted>쪽수·판형을 모르면 비워 두세요. 책장에는 흔한 크기로 보이고, 상세에는 ‘확인 전’으로 표시돼요.</Muted>
            <Text style={[st.label, { marginTop: 18 }]}>읽기 상태</Text>
            <Tabs items={READ_STATUSES.map((x) => ({ id: x, label: STATUS_LABEL[x] }))} value={draft.status} onChange={(x) => setDraft({ ...draft, status: x })} stretch />
          </View>
        ) : null}
        <View style={st.divider} />
        <Text style={[st.label, { marginTop: 18 }]}>추가할 곳</Text>
        <Tabs items={[{ id: 'shelf', label: '책장' }, { id: 'drawer', label: '서랍' }]} value={where} onChange={setWhere} stretch style={{ marginHorizontal: 40 }} />
        <Pressable
          disabled={!draft.title.trim() || saving}
          onPress={async () => {
            setSaving(true);
            const r = await recommend();
            setBinding(r.b);
            setSaving(false);
            setStep('binding');
          }}
          accessibilityRole="button"
          style={[st.bindingLink, (!draft.title.trim() || saving) && { opacity: 0.4 }]}>
          <Text style={st.bindingLinkText}>장정 먼저 고르기</Text>
        </Pressable>
      </Screen>
    );

  if (step === 'binding' && binding)
    return (
      <Screen title="장정 미리보기" footer={<Btn label={`이 장정으로 ${where === 'drawer' ? '서랍에' : '책장에'} 추가`} busy={saving} onPress={() => void add()} />}>
        <BindingEditor title={draft.title} author={draft.authors} size={size} pages={num(draft.pages)} value={binding} recommended={{ ...bindingFields(art ?? buildBookArt({ title: draft.title })), seed: 0, source: 'default' }} onChange={setBinding} />
      </Screen>
    );

  // 추가 완료: 책장에 꽂기 / 서랍에 보관(공간이 없으면 새 선반 또는 서랍을 제안)
  return (
    <Screen title="추가했어요" back={false}>
      <Text style={st.doneTitle}>《{draft.title}》을(를) 내 책에 추가했어요.</Text>
      {placed === null ? (
        <View style={{ gap: 10, marginTop: 20 }}>
          <Btn label="책장에 꽂기" onPress={() => place('shelf')} />
          <Btn label="서랍에 보관" kind="secondary" onPress={() => place('drawer')} />
        </View>
      ) : placed === 'none' ? (
        <View style={{ gap: 10, marginTop: 20 }}>
          <Muted>책장에 빈 자리가 없어요.</Muted>
          <Btn label="선반을 하나 더하고 꽂기" onPress={() => place('newShelf')} />
          <Btn label="서랍에 보관" kind="secondary" onPress={() => place('drawer')} />
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 20 }}>
          <Muted>{placed === 'shelf' ? '책장에 꽂았어요. 꾸미기에서 자리와 자세를 바꿀 수 있어요.' : '서랍에 넣었어요. 서랍에서 언제든 꺼내 놓을 수 있어요.'}</Muted>
          {placed === 'shelf' ? (
            <Btn
              label="책장에서 보기"
              onPress={() => {
                uiBus.focusBook(addedId!);
                router.dismissTo('/');
              }}
            />
          ) : null}
          <Btn label="책 상세 보기" kind="secondary" onPress={() => router.replace(`/book/${addedId}`)} />
          <Btn label="한 권 더 추가" kind="ghost" onPress={() => router.replace('/book/add')} />
        </View>
      )}
    </Screen>
  );
}

function FindStep({ tabs, initial, notice, onPick, onPhoto }: { tabs: React.ReactNode; initial?: string; notice: string | null; onPick: (c: BookCandidate) => void; onPhoto: (from: 'camera' | 'library') => void }) {
  const [q, setQ] = useState(initial ?? '');
  const [items, setItems] = useState<BookCandidate[] | null>(null);
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
      {tabs}
      <View style={[st.searchBox, { marginTop: 20 }]}>
        <Pressable onPress={() => run()} accessibilityRole="button" accessibilityLabel="검색" style={st.searchAction}><Search size={23} color={colors.ink} strokeWidth={1.6} /></Pressable>
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => run()}
          returnKeyType="search"
          placeholder="제목이나 저자로 찾기"
          placeholderTextColor={colors.inkFaint}
          style={st.searchInput}
          accessibilityLabel="제목이나 저자로 찾기"
        />
        {busy ? <ActivityIndicator size="small" color={colors.inkSoft} /> : q ? <Pressable onPress={() => { ctrl.current?.abort(); setBusy(false); setQ(''); setItems(null); setErr(null); }} accessibilityRole="button" accessibilityLabel="검색어 지우기" style={st.searchAction}><View style={st.clear}><X size={16} color={colors.inkSoft} /></View></Pressable> : null}
      </View>
      <View style={st.findMethods}>
        <Pressable accessibilityRole="button" accessibilityLabel="사진으로 찾기" onPress={() => Alert.alert('사진으로 찾기', '표지 사진을 선택해 주세요.', [{ text: '사진 찍기', onPress: () => onPhoto('camera') }, { text: '사진 고르기', onPress: () => onPhoto('library') }, { text: '취소', style: 'cancel' }])} style={st.method}><Camera size={24} color={colors.ink} strokeWidth={1.5} /><Text style={st.methodText}>사진으로 찾기</Text></Pressable>
      </View>
      {notice ? <Muted style={{ marginTop: 8, lineHeight: 19 }}>{notice}</Muted> : null}

      {err ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 20 }}>{err}</Text>
          <Row style={{ marginTop: 10 }}>
            <Btn label="다시 시도" kind="secondary" onPress={() => run()} />
          </Row>
        </Card>
      ) : null}
      {items && !items.length ? <Empty title="찾는 책이 없어요" body="검색어를 바꾸거나 ‘직접 입력’ 탭에서 추가해 주세요." /> : null}
      {items?.length ? (
        <View style={{ marginTop: 27 }}><Row gap={13}><Text style={st.resultHeading}>검색 결과</Text><Text style={st.resultCount}>{items.length}권</Text></Row>
          {items.map((c) => (
            <Pressable key={c.key} onPress={() => onPick(c)} style={({ pressed }) => [st.result, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${c.title}, ${c.authors.join(', ')}`}>
              <View style={st.coverShadow}><RealCover uri={c.coverUrl} title={c.title} color="#B8ADA0" width={94} ratio={0.77} /></View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={st.rTitle}>{c.title}</Text>
                {c.authors.length ? <Text style={st.rAuthor}>{c.authors.join(', ')}</Text> : null}
                <Text style={st.rMeta}>{[c.publisher, c.publishedAt?.match(/\b\d{4}\b/)?.[0]].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={st.add}><Text style={{ color: colors.ink, fontSize: 15 }}>추가</Text></View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  tabs: { marginTop: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  coverWrap: { alignItems: 'center', marginTop: 38, marginBottom: 30 },
  blankBook: { width: BLANK_W, height: BLANK_H, borderRadius: 3, backgroundColor: '#F3ECE3', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(150,120,95,0.22)', alignItems: 'center', justifyContent: 'center', gap: 13, boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 26, color: 'rgba(110,78,48,0.15)' }, { offsetX: 0, offsetY: 2, blurRadius: 3, color: 'rgba(87,63,40,0.16)' }] },
  blankSpine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 12, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, backgroundColor: 'rgba(255,255,255,0.32)', borderRightWidth: 1.5, borderRightColor: 'rgba(140,112,90,0.24)' },
  blankGroove: { position: 'absolute', left: 13.5, top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(255,255,255,0.55)' },
  blankText: { fontSize: 15.5, color: '#7A6A60' },
  label: { fontSize: 15, color: colors.ink, marginBottom: 6 },
  more: { flexDirection: 'row', alignItems: 'center', minHeight: 72, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule, paddingTop: 14 },
  moreTitle: { fontWeight: '700', fontSize: 19, color: colors.title },
  moreSub: { fontSize: 14.5, color: colors.inkSoft, marginTop: 6 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.rule, marginTop: 14 },
  bindingLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 14 },
  bindingLinkText: { fontSize: 14, color: colors.inkSoft, textDecorationLine: 'underline' },
  searchBox: { minHeight: 51, borderRadius: 15, backgroundColor: '#F4EEE5', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 1 },
  searchAction: { width: 43, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clear: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#DDD6CC', alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 18, lineHeight: 28, color: colors.ink, paddingVertical: 10, includeFontPadding: false },
  findMethods: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  method: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, minHeight: 50 },
  methodText: { fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  resultHeading: { fontWeight: '700', fontSize: 22, color: colors.ink },
  resultCount: { fontSize: 15, color: colors.inkSoft },
  result: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 7, paddingVertical: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.rule },
  coverShadow: { borderRadius: 3, boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 6, color: 'rgba(118,77,38,0.16)' }] },
  add: { backgroundColor: '#F5E7D6', borderRadius: 13, minWidth: 64, minHeight: 38, paddingVertical: 9, paddingHorizontal: 10, alignItems: 'center' },
  rTitle: { fontFamily: fonts.serifMedium, fontSize: 18, lineHeight: 28, color: '#27231F', includeFontPadding: false },
  rAuthor: { fontSize: 14, lineHeight: 22, color: '#756B63' },
  rMeta: { fontSize: 12.5, lineHeight: 20, color: colors.inkFaint },
  doneTitle: { fontFamily: fonts.serif, fontSize: 20, lineHeight: 30, color: colors.ink, marginTop: 20 },
});
