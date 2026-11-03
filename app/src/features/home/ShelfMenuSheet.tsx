// 책장 메뉴 시트(머리줄 메뉴): 꾸미기·책 찾기·전체 책·설정·선반 추가와 정리. 측정 번들에서만 측정 항목이 더 보인다.
import { router } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ShelfLayout } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { placementStore } from '@/store/placement-store';
import { BookMarked, Eraser, Paintbrush, Plus, Search, Settings } from '@/ui/icons';
import { MENU_FLAGS, PERF_DETAIL, PERF_ENABLED, PERF_LEVELS, setPerfLevel, setShelfView, SHELF_VIEWS, type PerfLevel } from '@/ui/perf';
import { colors as ui, icon, shape, space, type } from '@/ui/screenTheme';

type View_ = (typeof SHELF_VIEWS)[number];
type Props = {
  visible: boolean;
  reduceMotion: boolean;
  bottomInset: number;
  layout: ShelfLayout;
  onClose: () => void;
  onDecorate: () => void;
  showToast: (t: { text: string }) => void;
  perf: {
    demo: boolean;
    debugGeom: boolean;
    setDebugGeom: (f: (v: boolean) => boolean) => void;
    setPerfKey: (f: (k: number) => number) => void;
    runPerf: (level: PerfLevel) => Promise<void>;
    shelfView: View_;
    setShelfViewState: (v: View_) => void;
    setToast: (t: { text: string }) => void;
  };
};

export function ShelfMenuSheet({ visible, reduceMotion, bottomInset, layout, onClose, onDecorate, showToast, perf }: Props) {
  const item = (children: React.ReactNode, onPress: () => void) => (
    <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { onClose(); onPress(); }}>{children}</Pressable>
  );
  const iconProps = { size: icon.size, color: ui.ink, strokeWidth: icon.stroke };
  const canPrune = layout.shelves.length > 3 && layout.shelves.some((sh) => !layout.placements.some((p) => p.shelfId === sh.id));
  return (
    <Modal visible={visible} transparent statusBarTranslucent={MENU_FLAGS.translucent} navigationBarTranslucent={MENU_FLAGS.translucent} animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[styles.menuSheet, { paddingBottom: bottomInset + 24 }]}>
        <Text style={styles.menuTitle}>{ko.menu.title}</Text>
        {item(<><Paintbrush {...iconProps} /><Text style={styles.menuText}>{ko.decorate}</Text></>, onDecorate)}
        {item(<><Search {...iconProps} /><Text style={styles.menuText}>{ko.menu.search}</Text></>, () => router.push('/search'))}
        {item(<><BookMarked {...iconProps} /><Text style={styles.menuText}>{ko.allBooks.title}{layout.drawer.length ? ` · 책장에 없는 책 ${layout.drawer.length}권` : ''}</Text></>, () => router.push('/books'))}
        {item(<><Settings {...iconProps} /><Text style={styles.menuText}>{ko.menu.settings}</Text></>, () => router.push('/settings'))}
        <View style={styles.menuDivider} />
        {item(<><Plus {...iconProps} /><Text style={styles.menuText}>{ko.menu.addShelf}</Text></>, () => showToast({ text: placementStore.addShelf() ? ko.menu.shelfAdded : ko.menu.shelfFail }))}
        {canPrune ? item(<><Eraser {...iconProps} /><Text style={styles.menuText}>{ko.menu.prune}</Text></>, () => showToast({ text: placementStore.pruneShelves() ? ko.menu.pruned : ko.menu.shelfFail })) : null}
        {PERF_ENABLED ? (
          <>
            <View style={styles.menuDivider} />
            {item(<Text style={styles.menuText}>{perf.demo ? '예시 책장 끄기(측정)' : '예시 책장 보기(측정, 저장 안 함)'}</Text>, () => { placementStore.setDemo(!perf.demo); perf.setPerfKey((k) => k + 1); })}
            {item(<Text style={styles.menuText}>{perf.debugGeom ? '형상 보기 끄기(측정)' : '형상 보기(측정)'}</Text>, () => perf.setDebugGeom((v) => !v))}
            {perf.demo ? item(<Text style={styles.menuText}>예시 배치로 초기화(측정)</Text>, () => placementStore.resetSample()) : null}
            {perf.demo ? item(<Text style={styles.menuText}>벽 기대기 시험(측정)</Text>, () => placementStore.resetWallPilot()) : null}
            {(['all', 'detail'] as const).map((lv) => (
              <Pressable
                key={lv}
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={async () => {
                  onClose();
                  for (const l of lv === 'all' ? PERF_LEVELS : PERF_DETAIL) await perf.runPerf(l);
                  setPerfLevel('full');
                  perf.setPerfKey((k) => k + 1);
                }}>
                <Text style={styles.menuText}>측정: {lv}</Text>
              </Pressable>
            ))}
            {item(<Text style={styles.menuText}>선반 보기: {perf.shelfView}</Text>, () => {
              const next = SHELF_VIEWS[(SHELF_VIEWS.indexOf(perf.shelfView) + 1) % SHELF_VIEWS.length];
              setShelfView(next);
              perf.setShelfViewState(next);
              perf.setPerfKey((k) => k + 1);
              perf.setToast({ text: `선반 보기: ${next}` });
            })}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuBackdrop: { flex: 1, backgroundColor: ui.scrim },
  menuSheet: { backgroundColor: ui.raised, borderTopLeftRadius: shape.sheet, borderTopRightRadius: shape.sheet, paddingHorizontal: space.page, paddingTop: 22 },
  menuTitle: { ...type.heading, marginBottom: space.tight },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: space.row },
  menuText: type.row,
  menuDivider: { height: shape.hairline, backgroundColor: ui.line, marginVertical: 6 },
});
