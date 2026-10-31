// 신고: 사유를 고르면 바로 접수(운영자가 /admin/reports에서 확인·숨김). 두 플랫폼 모두 같은 시트
import { Alert } from 'react-native';

import { explainWriteError, REPORT_REASONS } from '@/features/community/actions';
import { community, type ReportKind } from '@/services/community';
import { ListGroup, ListItem, Muted, Sheet } from '@/ui/kit';

export type ReportTarget = { kind: ReportKind; id: string | number; label: string };

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const send = (reason: string) => {
    if (!target) return;
    onClose();
    void community.report(target.kind, target.id, reason)
      .then(() => Alert.alert('신고를 접수했어요', '운영자가 확인한 뒤 처리해요.'))
      .catch((e: unknown) => explainWriteError(e, '신고하지 못했어요'));
  };
  return (
    <Sheet visible={!!target} onClose={onClose} title={target ? `${target.label} 신고` : undefined}>
      <Muted style={{ marginBottom: 8 }}>신고 사유를 골라 주세요.</Muted>
      <ListGroup>
        {REPORT_REASONS.map((r) => <ListItem key={r} label={r} onPress={() => send(r)} />)}
      </ListGroup>
    </Sheet>
  );
}
