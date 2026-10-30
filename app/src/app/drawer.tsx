// 서랍: 아직 책장에 두지 않은 책. 장정·별점·갈피·독서 시간은 그대로 유지된다.
// 눌러서 고르고(여러 권) 아래 '책장에 놓기'로 한꺼번에 꺼내 놓는다. 길게 누르면 책 정보.
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { STATUS_LABEL } from '@/features/book/labels';
import { READ_STATUSES, type ReadStatus } from '@/domain/library';
import type { Book } from '@/domain/types';
import { useLibrary } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { BookVisual } from '@/ui/BookVisual';
import { Check, Plus } from '@/ui/icons';
import { Btn, Empty, Muted, Screen, SearchField, Tabs } from '@/ui/kit';
import { colors, screenTheme } from '@/ui/screenTheme';

type Filter = 'all' | ReadStatus;

export default function Drawer() {
  const place = usePlacementStore();
  const { lib } = useLibrary();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const list = useMemo(
    () =>
      place.layout.drawer
        .map((id) => place.books[id])
        .filter(Boolean)
        .filter((b) => {
          const t = q.trim();
          if (t && !`${b.title} ${b.author ?? ''}`.includes(t)) return false;
          return status === 'all' || lib.books[b.id]?.status === status;
        }),
    [place, lib, q, status],
  );
  // 서랍에서 빠진 책(다른 곳에서 꺼냄)은 고른 목록에서도 뺀다
  const inDrawer = useMemo(() => new Set(place.layout.drawer), [place.layout.drawer]);
  const chosen = picked.filter((id) => inDrawer.has(id));
  const chosenSet = new Set(chosen);
  const toggle = useCallback((id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])), []);
  const putOnShelf = () => {
    const left = chosen.filter((id) => placementStore.fromDrawer(id) === 'none');
    setPicked(left);
    if (left.length)
      Alert.alert('책장에 빈 자리가 없어요', `${left.length}권을 놓지 못했어요. 선반을 추가하거나 다른 책을 서랍에 넣어 주세요.`, [
        { text: '확인' },
        {
          text: '선반 추가 후 꽂기',
          onPress: () => {
            placementStore.addShelf();
            setPicked(left.filter((id) => placementStore.fromDrawer(id) === 'none'));
          },
        },
      ]);
  };
  const empty = !place.layout.drawer.length;
  const lead = <Text style={st.lead}>책장에 놓기 전, 잠시 보관하는 곳.</Text>;
  return (
    <Screen
      title="서랍"
      scroll={false}
      right={
        <Pressable onPress={() => router.push({ pathname: '/book/add', params: { to: 'drawer' } })} hitSlop={10} accessibilityRole="button" accessibilityLabel="서랍에 책 추가">
          <Plus size={30} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
      }
      footer={empty ? undefined : <Btn label={chosen.length ? `책장에 놓기 · ${chosen.length}권` : '책장에 놓을 책을 골라 주세요'} disabled={!chosen.length} onPress={putOnShelf} />}>
      {empty ? (
        <>
          {lead}
          <Empty title="서랍이 비어 있어요" body="책장에 자리가 없거나 잠시 치워 두고 싶은 책을 여기에 보관할 수 있어요." action="책 추가" onAction={() => router.push('/book/add')} />
        </>
      ) : (
        // 서랍은 책장에 자리가 없는 책이 모이는 곳이라 가장 길어진다: 책 그림(캔버스)은 화면 근처 칸만 그린다
        <FlatList
          data={list}
          keyExtractor={(b) => b.id}
          numColumns={2}
          columnWrapperStyle={st.row}
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 48 }}
          ListHeaderComponent={
            <>
              {lead}
              <SearchField value={q} onChangeText={setQ} placeholder="제목 또는 저자" accessibilityLabel="서랍에서 찾기" style={{ marginTop: 22 }} />
              <Tabs items={[{ id: 'all' as Filter, label: '전체' }, ...READ_STATUSES.map((s) => ({ id: s as Filter, label: STATUS_LABEL[s] }))]} value={status} onChange={setStatus} stretch style={{ marginTop: 18 }} />
              {list.length ? <View style={{ height: 34 }} /> : <Empty title="맞는 책이 없어요" />}
            </>
          }
          ListFooterComponent={list.length ? <Muted style={{ marginTop: 18, textAlign: 'center' }}>길게 누르면 책 정보를 볼 수 있어요.</Muted> : null}
          renderItem={({ item }) => <DrawerCell book={item} on={chosenSet.has(item.id)} sub={lib.books[item.id] ? STATUS_LABEL[lib.books[item.id].status] : undefined} onToggle={toggle} />}
        />
      )}
    </Screen>
  );
}

// 서랍 한 칸(고르기 표시가 바뀐 칸만 다시 그린다)
const DrawerCell = memo(function DrawerCell({ book: b, on, sub, onToggle }: { book: Book; on: boolean; sub?: string; onToggle: (id: string) => void }) {
  return (
    <Pressable
      onPress={() => onToggle(b.id)}
      onLongPress={() => router.push(`/book/${b.id}`)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={[b.title, sub].filter(Boolean).join(', ')}
      accessibilityHint="눌러서 고르기, 길게 눌러 책 정보 보기"
      style={st.cell}>
      <View style={st.art} pointerEvents="none">
        <BookVisual book={b} width={134} />
        {on ? (
          <View style={st.check}>
            <Check size={18} color="#FFFFFF" strokeWidth={2.6} />
          </View>
        ) : null}
      </View>
      <Text style={st.title} numberOfLines={2}>{b.title}</Text>
      {sub ? <Text style={st.sub}>{sub}</Text> : null}
    </Pressable>
  );
});

const st = StyleSheet.create({
  lead: { fontSize: 14.5, color: colors.inkSoft, textAlign: 'center', marginTop: 2 },
  row: { justifyContent: 'space-between', marginBottom: 28, paddingHorizontal: 8 },
  cell: { width: '46%', alignItems: 'center' },
  art: { height: 196, justifyContent: 'flex-end', alignItems: 'center' },
  check: { position: 'absolute', top: -8, right: -12, width: 34, height: 34, borderRadius: 17, backgroundColor: screenTheme.primary, borderWidth: 3, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '700', fontSize: 16, color: colors.title, marginTop: 12, textAlign: 'center' },
  sub: { fontSize: 13.5, color: colors.inkSoft, marginTop: 4 },
});
