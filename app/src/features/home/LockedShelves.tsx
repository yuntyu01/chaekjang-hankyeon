// 잠긴 선반(2026-11-04 사용자 시안): 마지막 선반 아래 칸은 흐린 책과 자물쇠로 보이고, 누르면 구매 시트가 뜬다.
// 선반·벽·흐린 책은 ShelfScene이 그린다(domain/locked-preview). 여기는 그 위에 얹는 자물쇠와 누르는 자리뿐이다.
// 결제는 아직 연결하지 않아 무료로 열린다고 적는다(가격을 적고 무료로 열지 않는다). Play 결제와 가격은 onBuy와 ko.lockedShelf.buy에 붙인다.
import { Pressable, StyleSheet } from 'react-native';

import { ko } from '@/i18n/ko';
import { Btn, Sheet } from '@/ui/kit';
import { press } from '@/ui/screenTheme';
import type { RowGeom } from '@/ui/shelf/metrics';
import { LockIcon } from '@/ui/TabIcons';

const LOCK = { w: 32, h: 40, color: '#3F4347', hole: '#F4F3F2' }; // 내용 색(책장 그림, 시안)

export function LockedShelves({ rows, width, disabled, onPress }: { rows: RowGeom[]; width: number; disabled: boolean; onPress: () => void }) {
  return (
    <>
      {rows.map((row) => (
        <Pressable
          key={row.shelfId}
          disabled={disabled}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={ko.lockedShelf.a11y}
          style={({ pressed }) => [styles.row, { top: row.top, width, height: row.height }, pressed && press]}>
          <LockIcon width={LOCK.w} height={LOCK.h} color={LOCK.color} hole={LOCK.hole} />
        </Pressable>
      ))}
    </>
  );
}

export function LockedShelfSheet({ visible, onClose, onBuy }: { visible: boolean; onClose: () => void; onBuy: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={ko.lockedShelf.title} description={ko.lockedShelf.body}>
      <Btn label={ko.lockedShelf.buy} size="l" onPress={onBuy} style={styles.buy} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, alignItems: 'center', justifyContent: 'center' },
  buy: { marginTop: 8 },
});
