// 측정 메뉴 시트(측정 번들 ?perfmenu=1 에서 머리글 제목을 누르면). 배포본에는 나오지 않는다.
// 꾸미기는 머리글 아이콘으로, 빈 선반 정리는 꾸미기 패널로 옮겼다(2026-11-05 사용자). 전체 책·스토어·책 추가는 머리글 오른쪽 아이콘, 설정은 내 정보 탭, 선반 추가는 잠긴 칸을 누르면 된다.
import { ko } from '@/i18n/ko';
import { placementStore } from '@/store/placement-store';
import { ListGroup, ListItem, Sheet } from '@/ui/kit';
import { PERF_DETAIL, PERF_LEVELS, setPerfLevel, setShelfView, SHELF_VIEWS, type PerfLevel } from '@/ui/perf';

type View_ = (typeof SHELF_VIEWS)[number];
type Props = {
  visible: boolean;
  onClose: () => void;
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

export function ShelfMenuSheet({ visible, onClose, perf }: Props) {
  const item = (label: string, onPress: () => void) => <ListItem key={label} label={label} onPress={() => { onClose(); onPress(); }} />;
  return (
    <Sheet visible={visible} onClose={onClose} title={ko.menu.title}>
      <ListGroup>
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
      </ListGroup>
    </Sheet>
  );
}
