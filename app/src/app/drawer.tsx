// 서랍: 아직 책장에 두지 않은 책. 장정·별점·갈피·독서 시간은 그대로 유지된다.
// 2026-10-26 서랍 시안: 제목 옆 '· N권', 한 줄 안내, 검색칸, 상태는 고르게 나눈 탭(밑줄), 결과 없음은 화면 가운데쯤.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { READ_STATUSES, type ReadStatus } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { Btn, Empty, Muted, Screen, ScreenList, SearchField, Tabs } from '@/ui/kit';
import { space } from '@/ui/screenTheme';

export default function Drawer() {
  const place = usePlacementStore();
  const { lib } = useLibrary();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReadStatus | 'all'>('all');
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
  const row = ({ item: b }: { item: (typeof list)[number] }) => (
    <BookRow
      book={b}
      sub={lib.books[b.id] ? STATUS_LABEL[lib.books[b.id].status] : undefined}
      onPress={() => router.push(`/book/${b.id}`)}
      right={
        <Btn
          label="꺼내 놓기"
          kind="secondary"
          size="s"
          onPress={() => {
            if (placementStore.fromDrawer(b.id) === 'none') Alert.alert('책장에 빈 자리가 없어요', '선반을 추가하거나 다른 책을 서랍에 넣어 주세요.', [{ text: '확인' }, { text: '선반 추가 후 꽂기', onPress: () => { placementStore.addShelf(); placementStore.fromDrawer(b.id); } }]);
          }}
        />
      }
    />
  );
  // 서랍은 책장에 자리가 없는 책이 모이는 곳이라 가장 길어진다: 책 그림(캔버스)은 화면 근처 줄만 그린다
  return (
    <Screen title="서랍" titleNote={place.layout.drawer.length ? `· ${place.layout.drawer.length}권` : undefined} scroll={false}>
      <ScreenList
        data={list}
        keyExtractor={(b) => b.id}
        renderItem={row}
        ListHeaderComponent={
          <View style={{ marginBottom: list.length ? space.tight : 0 }}>
            <Muted style={{ marginTop: space.item }}>책장에 두지 않은 책을 보관해요.</Muted>
            <SearchField value={q} onChangeText={setQ} placeholder="제목, 저자 검색" accessibilityLabel="서랍에서 찾기" style={{ marginTop: space.group }} />
            <Tabs items={TABS} value={status} onChange={setStatus} style={{ marginTop: space.item, marginHorizontal: -6 }} />
          </View>
        }
        ListEmptyComponent={
          <View style={st.emptyWrap}>
            {!place.layout.drawer.length ? (
              <Empty title="서랍이 비어 있어요" body="책장에 자리가 없거나 잠시 치워 두고 싶은 책을 여기에 보관할 수 있어요." action="책 추가" onAction={() => router.push('/book/add')} />
            ) : (
              <Empty title="맞는 책이 없어요" body={q.trim() ? '검색어를 바꿔 보세요.' : '다른 상태를 선택해 보세요.'} />
            )}
          </View>
        }
      />
    </Screen>
  );
}

const TABS = [{ id: 'all', label: '전체' }, ...READ_STATUSES.map((st) => ({ id: st, label: STATUS_LABEL[st] }))] as const satisfies readonly { id: ReadStatus | 'all'; label: string }[];
// 결과 없음: 시안처럼 탭 아래 화면 가운데쯤
const st = { emptyWrap: { paddingTop: 110 } } as const;
