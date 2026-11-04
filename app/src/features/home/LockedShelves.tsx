// 잠긴 선반(2026-11-04 사용자 시안): 마지막 선반 아래 칸은 흐린 책 그림자와 자물쇠로 보이고, 누르면 구매 시트가 뜬다.
// 선반·벽은 보통 줄과 같은 그림이다(ShelfScene). 여기는 그 위에 얹는 흐린 책과 자물쇠, 누르는 자리뿐이다.
// 흐린 책은 정해 둔 색 덩어리다(실제 표지를 흐리게 쓰지 않는다).
// 결제는 아직 연결하지 않아 무료로 열린다고 적는다(가격을 적고 무료로 열지 않는다). Play 결제와 가격은 onBuy와 ko.lockedShelf.buy에 붙인다.
import { BlurMask, Canvas, RoundedRect } from '@shopify/react-native-skia';
import { Pressable, StyleSheet } from 'react-native';

import { FRAME_X0, FRAME_X1, SHELF } from '@/domain/geometry';
import { ko } from '@/i18n/ko';
import { Btn, Sheet } from '@/ui/kit';
import { press } from '@/ui/screenTheme';
import type { RowGeom, ShelfMetrics } from '@/ui/shelf/metrics';
import { LockIcon } from '@/ui/TabIcons';

// 칸마다 흐린 책: 안쪽 폭에 대한 시작·폭(시안에서 잰 비율)과 색. 둘째 칸은 같은 그림이 되풀이되지 않게 다르게
const BLOBS = [
  [{ x: 0.04, w: 0.39, c: '#C7C9CC' }, { x: 0.49, w: 0.09, c: '#F2ECE3' }, { x: 0.61, w: 0.345, c: '#C8DEF0' }],
  [{ x: 0.05, w: 0.3, c: '#E4D6D2' }, { x: 0.38, w: 0.11, c: '#D9D6CD' }, { x: 0.52, w: 0.13, c: '#CBD8D0' }, { x: 0.68, w: 0.27, c: '#D3D7E3' }],
];
const BLUR = 10; // dp
const LOCK = { w: 32, h: 40, color: '#3F4347', hole: '#F4F3F2' }; // 내용 색(책장 그림, 시안)
// 칸 안에서 흐린 책의 위 끝(칸 높이 비율)과 아래 끝(기준선 위 DU: 판 윗면 뒤쪽 끝 바로 위)
const BLOB_TOP = 0.14;
const BLOB_BOTTOM_DU = 16;

export function LockedShelves({ rows, m, width, disabled, onPress }: { rows: RowGeom[]; m: ShelfMetrics; width: number; disabled: boolean; onPress: () => void }) {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;
  const x0 = m.originX + (SHELF.sideMargin + FRAME_X0) * m.scale;
  const inner = (FRAME_X1 - FRAME_X0) * m.scale;
  return (
    <>
      <Canvas pointerEvents="none" style={{ position: 'absolute', left: 0, top: first.top, width, height: last.top + last.height - first.top }}>
        {rows.flatMap((row, i) => {
          const top = row.top - first.top + row.height * BLOB_TOP;
          const bottom = row.baseline - first.top - BLOB_BOTTOM_DU * m.scale;
          return BLOBS[i % BLOBS.length].map((b, k) => (
            <RoundedRect key={`${i}-${k}`} x={x0 + b.x * inner} y={top} width={b.w * inner} height={bottom - top} r={6} color={b.c}>
              <BlurMask blur={BLUR} style="normal" />
            </RoundedRect>
          ));
        })}
      </Canvas>
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
