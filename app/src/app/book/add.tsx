// 책 추가: 책 찾기(검색·사진·직접 입력) → 책·판본 확인 → 재장정 미리보기 → 내 책에 추가 → 책장에 꽂기 또는 서랍에 보관.
// 검색 결과·표지·쪽수가 없어도 직접 입력과 기본 장정으로 끝낼 수 있다. 추정 크기를 확인된 정보처럼 저장하지 않는다.
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ImageIcon, PenLine, Search, X } from '@/ui/icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BindingEditor, type BindingDraft } from '@/features/book/BindingEditor';
import { STATUS_LABEL } from '@/features/book/labels';
import { defaultBinding, READ_STATUSES, type ReadStatus, type SizeMm } from '@/domain/library';
import { candidateDetails, searchBooks, type BookCandidate } from '@/services/book-search';
import { photoIdentify } from '@/services/connectors';
import { deniedMessage, pickPhoto } from '@/services/photos';
import { keepImage } from '@/store/files';
import { libraryStore } from '@/store/library-store';
import { placementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Btn, Card, Chip, Empty, Field, H2, Muted, RealCover, Row, Screen, ui } from '@/ui/kit';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';

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
  const params = useLocalSearchParams<{ q?: string; title?: string }>();
  const [step, setStep] = useState<Step>(params.title ? 'confirm' : 'find');
  const [draft, setDraft] = useState<Draft>(() => ({ ...blank('manual'), title: params.title ?? '' }));
  const [binding, setBinding] = useState<BindingDraft | null>(null);
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

  const add = async () => {
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
          coverUri,
          coverSource: coverUri ? draft.coverSource : undefined,
          source: draft.source,
          sourceName: draft.sourceName,
        },
        status: draft.status,
        binding: { ...binding },
      });
      setAddedId(id);
      setStep('done');
    } finally {
      setSaving(false);
    }
  };

  // 추가 직후: 책 모양이 책장 저장소에 들어간 뒤 꽂는다(서재 → 책장 동기화는 바로 일어난다)
  const place = (where: 'shelf' | 'drawer' | 'newShelf') => {
    if (!addedId) return;
    if (where === 'drawer') {
      placementStore.addToDrawer(addedId);
      setPlaced('drawer');
      return;
    }
    if (where === 'newShelf') placementStore.addShelf();
    const r = placementStore.addToShelf(addedId);
    setPlaced(r === 'shelf' ? 'shelf' : 'none');
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
            onPress={() => {
              const d = defaultBinding('new', draft.title, 0, '');
              setBinding((b) => b ?? { spineColor: d.spineColor, motif: d.motif, seed: 0, source: 'default' });
              setStep('binding');
            }}
          />
        }>
        {notice ? (
          <Card style={{ marginBottom: 14, backgroundColor: '#F6EEDF' }}>
            <Text style={{ fontSize: 13.5, lineHeight: 20, color: colors.ink }}>{notice}</Text>
          </Card>
        ) : null}
        <Row style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }} gap={16}>
          <RealCover uri={draft.coverUri} title={draft.title || '표지'} color="#B7AE9F" width={96} />
          <View style={{ flex: 1, gap: 8 }}>
            <Muted>{draft.coverUri ? (draft.coverSource === 'photo' ? '내가 찍은 사진' : `${draft.sourceName ?? '도서 정보'} 표지`) : '표지가 없어요. 사진을 등록할 수 있어요.'}</Muted>
            <Btn
              label={draft.coverUri ? '사진으로 바꾸기' : '표지 사진 등록'}
              kind="secondary"
              icon={<ImageIcon size={16} color={colors.ink} strokeWidth={1.6} />}
              onPress={async () => {
                const r = await pickPhoto('library');
                if (r.ok) setDraft({ ...draft, coverUri: r.uri, coverSource: 'photo' });
                else if (r.reason === 'denied') setNotice(deniedMessage('library'));
              }}
            />
          </View>
        </Row>
        <View style={{ height: 18 }} />
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
      <Screen title="장정 미리보기" footer={<Btn label="이 장정으로 추가" busy={saving} onPress={add} />}>
        <BindingEditor title={draft.title} author={draft.authors} size={size} pages={num(draft.pages)} value={binding} onChange={setBinding} />
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
      <View style={st.searchBox}>
        <Pressable onPress={() => run()} accessibilityRole="button" accessibilityLabel="검색" style={st.searchAction}><Search size={21} color={colors.inkSoft} strokeWidth={1.6} /></Pressable>
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
        {busy ? <ActivityIndicator size="small" color={colors.inkSoft} /> : q ? <Pressable onPress={() => { ctrl.current?.abort(); setBusy(false); setQ(''); setItems(null); setErr(null); }} accessibilityRole="button" accessibilityLabel="검색어 지우기" style={st.searchAction}><X size={18} color={colors.inkSoft} /></Pressable> : null}
      </View>
      <View style={st.findMethods}>
        <Pressable accessibilityRole="button" accessibilityLabel="사진으로 찾기" onPress={() => Alert.alert('사진으로 찾기', '표지 사진을 선택해 주세요.', [{ text: '사진 찍기', onPress: () => onPhoto('camera') }, { text: '사진 고르기', onPress: () => onPhoto('library') }, { text: '취소', style: 'cancel' }])} style={st.method}><Camera size={20} color={colors.inkSoft} /><Text style={st.methodText}>사진으로 찾기</Text></Pressable>
        <View style={{ width: 1, height: 22, backgroundColor: screenTheme.border }} />
        <Pressable accessibilityRole="button" accessibilityLabel="직접 입력" onPress={() => onManual(q)} style={st.method}><PenLine size={19} color={colors.inkSoft} /><Text style={st.methodText}>직접 입력</Text></Pressable>
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
      {items && !items.length ? <Empty title="찾는 책이 없어요" body="검색어를 바꾸거나 위의 직접 입력으로 추가해 주세요." /> : null}
      {items?.length ? (
        <View style={{ marginTop: 24 }}><Row gap={8}><Text style={st.resultHeading}>검색 결과</Text><Muted>{items.length}</Muted></Row><Muted style={{ marginTop: 5 }}>{provider ?? '도서 검색'}</Muted>
          {items.map((c) => (
            <Pressable key={c.key} onPress={() => onPick(c)} style={({ pressed }) => [st.result, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${c.title}, ${c.authors.join(', ')}`}>
              <RealCover uri={c.coverUrl} title={c.title} color="#B8ADA0" width={78} />
              <View style={{ flex: 1, gap: 7 }}>
                <Text style={st.rTitle}>{c.title}</Text>
                {c.authors.length ? <Text style={st.rAuthor}>{c.authors.join(', ')}</Text> : null}
                <Text style={st.rMeta}>{[c.publisher, c.publishedAt?.slice(0, 4)].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={st.add}><Text style={{ color: colors.ink, fontSize: 13 }}>추가</Text></View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  searchBox: { minHeight: 54, marginTop: 16, borderRadius: 13, borderWidth: 1, borderColor: screenTheme.border, backgroundColor: '#F6F0E7', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  searchAction: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  findMethods: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: screenTheme.border },
  method: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 16, minHeight: 48 },
  methodText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  resultHeading: { fontFamily: fonts.round, fontSize: 20, color: colors.ink },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: screenTheme.border },
  add: { backgroundColor: '#EFE5D5', borderRadius: 9, minWidth: 46, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center' },
  rTitle: { fontFamily: fonts.serifBold, fontSize: 18, lineHeight: 27, color: colors.ink },
  rAuthor: { fontSize: 14, color: colors.inkSoft },
  rMeta: { fontSize: 12, lineHeight: 19, color: colors.inkFaint },
  doneTitle: { fontFamily: fonts.serif, fontSize: 20, lineHeight: 30, color: colors.ink, marginTop: 20 },
});
