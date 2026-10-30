// 백업 및 복원: 폴더에 저장·공유로 보내기 / 백업 파일을 골라 확인 후 복원 / 백업에 들어가는 항목(펼쳐 보기).
// 최근 백업 시각은 폴더에 저장했을 때만 적는다(공유는 실제로 보냈는지 알 수 없다).
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { pickAndRestore, saveToFolder, shareBackup, whenLabel } from '@/features/settings/backup-actions';
import { lastBackupAt } from '@/store/backup';
import { ChevronDown, ChevronUp, Folder, Share } from '@/ui/icons';
import { Chip, LineRow, Muted, Row, Screen } from '@/ui/kit';
import { PERF_ENABLED } from '@/ui/perf';
import { colors, fonts } from '@/ui/screenTheme';

const ICON = { size: 27, color: colors.ink, strokeWidth: 1.4 };

export default function BackupScreen() {
  const [busy, setBusy] = useState<'folder' | 'share' | 'restore' | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [failTest, setFailTest] = useState<'library' | 'after-library' | undefined>(undefined);
  useEffect(() => {
    void lastBackupAt().then(setLast);
  }, []);
  const spin = (k: typeof busy) => (busy === k ? <ActivityIndicator size="small" color={colors.inkSoft} /> : null);
  return (
    <Screen title="백업 및 복원">
      <View style={st.hero}>
        <Folder size={52} color={colors.ink} strokeWidth={1.2} fill="#F3ECE3" />
        <Text style={st.title}>내 기록을 안전하게</Text>
        <Text style={st.body}>책과 갈피, 책장 배치를{'\n'}파일로 보관할 수 있어요.</Text>
      </View>

      <Text style={st.h}>백업</Text>
      <LineRow
        icon={<Folder {...ICON} fill="#F3ECE3" />}
        label="폴더에 백업 저장"
        chevron={busy !== 'folder'}
        right={spin('folder')}
        onPress={busy ? undefined : async () => {
          setBusy('folder');
          try {
            if (await saveToFolder()) setLast(await lastBackupAt());
          } finally {
            setBusy(null);
          }
        }}
      />
      <LineRow
        icon={<Share {...ICON} />}
        label="공유로 보내기"
        chevron={busy !== 'share'}
        right={spin('share')}
        last
        onPress={busy ? undefined : async () => {
          setBusy('share');
          await shareBackup();
          setBusy(null);
        }}
      />
      <Muted style={st.foot}>{last ? `최근 백업 · ${whenLabel(last)}` : '아직 폴더에 저장한 백업이 없어요.'}</Muted>

      <Text style={[st.h, { marginTop: 40 }]}>복원</Text>
      <LineRow
        icon={<Share {...ICON} />}
        label="백업 파일 선택"
        chevron={busy !== 'restore'}
        right={spin('restore')}
        last
        onPress={busy ? undefined : () => void pickAndRestore((v) => setBusy(v ? 'restore' : null), failTest)}
      />
      <Muted style={st.foot}>파일을 확인한 뒤 복원할 수 있어요.</Muted>
      {PERF_ENABLED ? (
        <Row style={{ marginTop: 10 }}>
          <Chip label="복원 실패 시험: 서재 쓰기 중(측정)" on={failTest === 'library'} onPress={() => setFailTest(failTest === 'library' ? undefined : 'library')} />
          <Chip label="복원 실패 시험: 서재 바꾼 뒤(측정)" on={failTest === 'after-library'} onPress={() => setFailTest(failTest === 'after-library' ? undefined : 'after-library')} />
        </Row>
      ) : null}

      <View style={st.divider} />
      <LineRow
        label="백업에 포함되는 항목"
        sub="책 정보 · 독서 기록 · 갈피 · 책장 배치"
        last
        onPress={() => setOpen((v) => !v)}
        a11y={`백업에 포함되는 항목, ${open ? '접기' : '펼치기'}`}
        right={open ? <ChevronUp size={24} color={colors.ink} strokeWidth={1.5} /> : <ChevronDown size={24} color={colors.ink} strokeWidth={1.5} />}
      />
      {open ? (
        <Text style={st.detail}>
          내 책(도서 정보·상태·별점·감상), 독서 회차, 독서 시간 기록, 갈피, 장정, 책장 배치와 시점, 설정, 앱에 보관한 사진(표지 사진·갈피 페이지 사진·장정 그림).{'\n'}진행 중인 독서 타이머는 들어가지 않아요. 복원하면 지금 기기의 기록이 백업 내용으로 바뀌어요.
        </Text>
      ) : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { paddingTop: 30 },
  title: { fontWeight: '700', fontSize: 23, color: colors.title, marginTop: 22 },
  body: { fontSize: 15, lineHeight: 24, color: colors.inkSoft, marginTop: 12 },
  h: { fontSize: 16, fontWeight: '700', color: colors.inkSoft, marginTop: 44, marginBottom: 2 },
  foot: { fontSize: 14, marginTop: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.rule, marginTop: 28 },
  detail: { fontSize: 14, lineHeight: 22, color: colors.inkSoft, marginTop: 4 },
});
