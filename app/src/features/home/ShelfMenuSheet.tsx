// 책장 메뉴 시트(머리글 왼쪽 글자를 누르면): 꾸미기만 둔다(2026-11-04 사용자 '메뉴 왜 이렇게 많아, 글씨체, 아이콘'). 책 찾기는 전체 책 검색과 겹쳐 뺐다(2026-11-05 사용자).
// 전체 책·스토어·책 추가는 머리글 오른쪽 아이콘, 설정은 내 정보 탭, 선반 추가는 잠긴 칸을 누르면 된다. 줄 모양은 설정 화면과 같은 부품이다(ListItem).
// 측정 번들: 딥링크 ?perfmenu=1 이면 측정 항목이 더 보인다.
import { useLocalSearchParams } from 'expo-router';

import { SHELF_SLOTS } from '@/domain/layout-rules';
import type { ShelfLayout } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { placementStore } from '@/store/placement-store';
import { ListGroup, ListItem, Sheet } from '@/ui/kit';
import { PERF_DETAIL, PERF_ENABLED, PERF_LEVELS, setPerfLevel, setShelfView, SHELF_VIEWS, type PerfLevel } from '@/ui/perf';

type View_ = (typeof SHELF_VIEWS)[number];
type Props = {
  visible: boolean;
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

export function ShelfMenuSheet({ visible, layout, onClose, onDecorate, showToast, perf }: Props) {
  const { perfmenu } = useLocalSearchParams<{ perfmenu?: string }>();
  const item = (label: string, onPress: () => void) => <ListItem key={label} label={label} onPress={() => { onClose(); onPress(); }} />;
  const canPrune = layout.shelves.length > SHELF_SLOTS && layout.shelves.some((sh) => !layout.placements.some((p) => p.shelfId === sh.id));
  return (
    <Sheet visible={visible} onClose={onClose} title={ko.menu.title}>
      <ListGroup>
        {item(ko.decorate, onDecorate)}
        {canPrune ? item(ko.menu.prune, () => showToast({ text: placementStore.pruneShelves() ? ko.menu.pruned : ko.menu.shelfFail })) : null}
        {PERF_ENABLED && perfmenu === '1' ? (
          <>
            {item(perf.demo ? '예시 책장 끄기(측정)' : '예시 책장 보기(측정, 저장 안 함)', () => { placementStore.setDemo(!perf.demo); perf.setPerfKey((k) => k + 1); })}
            {item(perf.debugGeom ? '형상 보기 끄기(측정)' : '형상 보기(측정)', () => perf.setDebugGeom((v) => !v))}
            {perf.demo ? item('예시 배치로 초기화(측정)', () => placementStore.resetSample()) : null}
            {perf.demo ? item('벽 기대기 시험(측정)', () => placementStore.resetWallPilot()) : null}
            {(['all', 'detail'] as const).map((lv) => item(`측정: ${lv}`, async () => {
              for (const l of lv === 'all' ? PERF_LEVELS : PERF_DETAIL) await perf.runPerf(l);
              setPerfLevel('full');
              perf.setPerfKey((k) => k + 1);
            }))}
            {item(`선반 보기: ${perf.shelfView}`, () => {
              const next = SHELF_VIEWS[(SHELF_VIEWS.indexOf(perf.shelfView) + 1) % SHELF_VIEWS.length];
              setShelfView(next);
              perf.setShelfViewState(next);
              perf.setPerfKey((k) => k + 1);
              perf.setToast({ text: `선반 보기: ${next}` });
            })}
          </>
        ) : null}
      </ListGroup>
    </Sheet>
  );
}
