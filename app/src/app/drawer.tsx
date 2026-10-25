// 서랍: 아직 책장에 두지 않은 책. 장정·별점·갈피·독서 시간은 그대로 유지된다.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { BookRow } from '@/features/book/BookRow';
import { STATUS_LABEL } from '@/features/book/labels';
import { READ_STATUSES, type ReadStatus } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { Btn, Chip, Empty, ListGroup, Muted, Row, Screen, SearchField } from '@/ui/kit';
import { space } from '@/ui/screenTheme';

export default function Drawer() {
  const place = usePlacementStore();
  const { lib } = useLibrary();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReadStatus | null>(null);
  const list = useMemo(
    () =>
      place.layout.drawer
        .map((id) => place.books[id])
        .filter(Boolean)
        .filter((b) => {
          const t = q.trim();
          if (t && !`${b.title} ${b.author ?? ''}`.includes(t)) return false;
          return !status || lib.books[b.id]?.status === status;
        }),
    [place, lib, q, status],
  );
  return (
    <Screen title={`서랍${place.layout.drawer.length ? ` · ${place.layout.drawer.length}권` : ''}`}>
      <Muted style={{ marginTop: space.item }}>책장에 두지 않은 책을 보관해요. 꺼내 놓으면 책장 빈 자리에 꽂혀요.</Muted>
      <SearchField value={q} onChangeText={setQ} placeholder="제목·저자" accessibilityLabel="서랍에서 찾기" style={{ marginTop: space.group }} />
      <Row style={{ marginTop: space.item }}>
        <Chip label="전체" on={!status} onPress={() => setStatus(null)} />
        {READ_STATUSES.map((st) => (
          <Chip key={st} label={STATUS_LABEL[st]} on={status === st} onPress={() => setStatus(status === st ? null : st)} />
        ))}
      </Row>
      {!place.layout.drawer.length ? (
        <Empty title="서랍이 비어 있어요" body="책장에 자리가 없거나 잠시 치워 두고 싶은 책을 여기에 보관할 수 있어요." action="책 추가" onAction={() => router.push('/book/add')} />
      ) : !list.length ? (
        <Empty title="맞는 책이 없어요" />
      ) : (
        <ListGroup style={{ marginTop: space.tight }}>
          {list.map((b) => (
            <BookRow
              key={b.id}
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
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}
