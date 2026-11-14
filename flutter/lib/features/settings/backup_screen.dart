// 백업 및 복원(지금 앱 app/backup.tsx, 설정 → 내 기록): 백업 파일 저장·공유·복원, 서버 동기화 상태·계정 연결.
// 2026-11-01 토스식: 세로로 쌓인 버튼 대신 누르는 줄 목록, 설명은 한 줄
library;

import 'dart:io';

import 'package:flutter/material.dart';

import '../../services/sync.dart';
import '../../store/backup.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';

Future<void> openBackup(BuildContext context) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/backup'), builder: (_) => const BackupScreen()));

class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key});

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  final _sync = SyncService.instance;
  bool _loggingIn = false;
  String? _busy; // export · share · restore

  @override
  void initState() {
    super.initState();
    _sync.addListener(_changed);
  }

  @override
  void dispose() {
    _sync.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  // 저장된 시각은 UTC라 기기 시간대로 보여 준다
  String _localTime(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) return '';
    String p(int n) => n.toString().padLeft(2, '0');
    return '${t.month}월 ${t.day}일 ${p(t.hour)}:${p(t.minute)}';
  }

  String _countsText(Counts c) => '책 ${c.books}권 · 갈피 ${c.bookmarks}개 · 독서 회차 ${c.rounds}개 · 독서 기록 ${c.sessions}개 · 장정 ${c.bindings}개 · 사진 ${c.images}장';

  Future<void> _saveToDownloads() async {
    setState(() => _busy = 'export');
    try {
      final r = await exportToDownloads();
      if (mounted) appAlert(context, '백업 파일을 저장했어요', '다운로드/책장한켠/${r.name}\n${_countsText(r.counts)}');
    } catch (e) {
      if (mounted) appAlert(context, '저장하지 못했어요', e is StateError ? e.message : '$e');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _share() async {
    setState(() => _busy = 'share');
    try {
      await exportShare();
    } catch (e) {
      if (mounted) appAlert(context, '내보내지 못했어요', '$e');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _restore() async {
    setState(() => _busy = 'restore');
    final r = await readBackupFile();
    if (!mounted) return;
    setState(() => _busy = null);
    if (r.data == null) {
      if (r.error != null) appAlert(context, '복원할 수 없어요', r.error);
      return;
    }
    final c = r.counts!;
    appAlert(
      context,
      '백업으로 바꿀까요?',
      '백업(${(r.data!['exportedAt']! as String).substring(0, 10)}): 책 ${c.books}권 · 갈피 ${c.bookmarks}개 · 독서 기록 ${c.sessions}개 · 사진 ${c.images}장\n지금 기기의 기록은 이 백업 내용으로 바뀌어요.',
      [
        const AlertButton('취소', style: AlertStyle.cancel),
        AlertButton('복원', style: AlertStyle.destructive, onPress: () async {
          setState(() => _busy = 'restore');
          try {
            await restoreBackup(r.data!);
            if (mounted) appAlert(context, '복원했어요');
          } catch (e) {
            if (mounted) appAlert(context, '복원하지 못했어요', e is StateError ? e.message : '$e');
          } finally {
            if (mounted) setState(() => _busy = null);
          }
        }),
      ],
    );
  }

  Widget? _spin(String kind) => _busy == kind ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent)) : null;

  List<Widget> _backupSection() => [
        const H2('백업 파일', first: true),
        Padding(padding: const EdgeInsets.only(bottom: Space.s), child: Text('책·독서 기록·갈피·장정·책장 배치·설정·사진이 들어가요. 진행 중인 타이머는 빠져요.', style: AppType.sub)),
        ListGroup(children: [
          // iOS에는 다운로드 폴더가 없다: 공유창의 '파일에 저장'을 쓴다
          if (Platform.isAndroid)
            ListItem(label: '다운로드 폴더에 백업 파일 저장', sub: '다운로드/책장한켠에 저장돼요', chevron: _busy != 'export', right: _spin('export'), onPress: _busy != null ? null : _saveToDownloads),
          ListItem(label: '공유로 보내기', sub: '메신저·드라이브로 보내요', chevron: _busy != 'share', right: _spin('share'), onPress: _busy != null ? null : _share),
          ListItem(label: '백업에서 복원', sub: '지금 기기의 기록이 백업 내용으로 바뀌어요', chevron: _busy != 'restore', right: _spin('restore'), onPress: _busy != null ? null : _restore),
        ]),
      ];

  // 연결 전에 알린다: 이 기기의 기록이 계정 기록과 합쳐지고(같은 항목은 더 최근에 고친 쪽), 아무것도 자동 공개되지 않는다
  void _login(String provider) => appAlert(
        context,
        '계정을 연결할까요?',
        '이 기기의 책·독서 기록·갈피가 계정에 저장된 기록과 합쳐져요. 같은 항목을 양쪽에서 고쳤다면 더 최근에 고친 쪽이 남아요. 연결해도 내 기록은 공개되지 않아요(커뮤니티에는 직접 고른 것만 올라가요).',
        [
          const AlertButton('취소', style: AlertStyle.cancel),
          AlertButton('연결', onPress: () => _doLogin(provider)),
        ],
      );

  Future<void> _doLogin(String provider) async {
    setState(() => _loggingIn = true);
    try {
      final r = await (provider == 'google' ? _sync.linkGoogle() : _sync.linkKakao());
      if (!mounted) return;
      if (r.ok) {
        appAlert(context, '계정을 연결했어요', r.switched ? '연결된 계정으로 바꿨어요. 기기의 기록은 동기화가 끝나면 합쳐져요.' : '이 기기의 기록을 계정에 연결했어요.');
      } else if (!r.cancelled) {
        appAlert(context, '로그인하지 못했어요', r.message);
      }
    } finally {
      if (mounted) setState(() => _loggingIn = false);
    }
  }

  void _removeAccount() => appAlert(
        context,
        '서버 계정을 삭제할까요?',
        '연결된 로그인과 서버의 독서 기록·사진 삭제를 요청해요. 이 기기의 책과 사진은 남고 동기화는 중지돼요. 다른 기기의 오래된 앱이 기록을 다시 올리지 않도록 먼저 최신 버전으로 업데이트해 주세요.',
        [
          const AlertButton('취소', style: AlertStyle.cancel),
          AlertButton('서버 계정 삭제', style: AlertStyle.destructive, onPress: () async {
            setState(() => _loggingIn = true);
            try {
              await _sync.deleteCloudAccount();
              if (mounted) appAlert(context, '삭제 요청을 접수했어요', '서버 접근을 차단하고 기록과 사진 삭제를 처리해요. 이 기기의 기록은 남아요.');
            } catch (e) {
              if (mounted) appAlert(context, '삭제 완료를 확인하지 못했어요', '$e\n동기화 상태를 확인하고 삭제를 다시 요청해 주세요.');
            } finally {
              if (mounted) setState(() => _loggingIn = false);
            }
          }),
        ],
      );

  void _resume() => appAlert(context, '새 계정으로 동기화할까요?', '새 서버 계정을 만들고 이 기기에 남은 기록과 사진을 다시 올려요.', [
        const AlertButton('취소', style: AlertStyle.cancel),
        AlertButton('동기화 시작', onPress: () async {
          setState(() => _loggingIn = true);
          try {
            await _sync.resumeCloudSync();
          } catch (e) {
            if (mounted) appAlert(context, '다시 시작하지 못했어요', '$e');
          } finally {
            if (mounted) setState(() => _loggingIn = false);
          }
        }),
      ]);

  List<Widget> _syncSection() {
    final s = _sync, on = s.available;
    final label = !on
        ? '이 기기에만 저장돼요'
        : s.paused
            ? '서버 동기화를 중지했어요'
            : s.state == SyncState.syncing
                ? '동기화하는 중…'
                : s.state == SyncState.error
                    ? '동기화하지 못했어요'
                    : s.lastAt != null
                        ? '마지막 동기화 ${_localTime(s.lastAt!)}'
                        : '아직 동기화 전이에요';
    final sub = on
        ? '${s.pending > 0 ? '올리지 못한 변경 ${s.pending}개' : s.lastAt != null && !s.paused && s.state != SyncState.error ? '대기 중인 변경이 없어요' : '기기에 기록을 보관하고 있어요'}${s.lastError != null ? ' · ${s.lastError}' : ''}'
        : '기록은 이 기기에만 있어요. 백업 파일로 옮길 수 있어요.';
    return [
      const H2('동기화', first: true),
      // 계정마다 한 줄: 연결됨이면 안내, 연결할 수 있으면 그 줄이 곧 행동, 준비 전이면 짧은 안내
      ListGroup(children: [
        ListItem(
          label: label,
          sub: sub,
          right: s.state == SyncState.syncing ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent)) : null,
        ),
        if (on && !s.paused) ListItem(label: '지금 동기화', onPress: s.state == SyncState.syncing || _loggingIn ? null : s.syncNow),
        if (on && s.account.kakao)
          ListItem(label: '카카오 계정 연결됨', sub: s.account.nickname.isNotEmpty ? '${s.account.nickname} · 다른 기기에서도 이어 봐요' : '다른 기기에서도 이어 봐요')
        else if (on && s.providers.kakao && !s.paused)
          ListItem(label: '카카오로 계속하기', sub: '연결하면 기기를 바꿔도 기록을 이어 봐요', chevron: true, onPress: _loggingIn ? null : () => _login('kakao')),
        if (on && s.account.google) const ListItem(label: 'Google 계정 연결됨', sub: '다른 기기에서도 이어 봐요'),
        if (on && s.paused && !s.deletionPending) ListItem(label: '새 계정으로 동기화', chevron: true, onPress: _loggingIn ? null : _resume),
        if (on && (s.deletionPending || (s.providers.accountDeletion && !s.paused)))
          ListItem(label: s.deletionPending ? '계정 삭제 다시 요청' : '서버 계정 삭제', danger: true, onPress: _loggingIn ? null : _removeAccount),
      ]),
      // Google 로그인은 Google 공식 단추 모양을 지켜야 해서 그림 그대로 쓴다
      if (on && !s.paused && !s.account.google && s.providers.google)
        Padding(
          padding: const EdgeInsets.only(top: Space.m),
          child: Center(
            child: Semantics(
              button: true,
              label: 'Google로 계속하기',
              excludeSemantics: true,
              onTap: _loggingIn ? null : () => _login('google'),
              child: GestureDetector(
                onTap: _loggingIn ? null : () => _login('google'),
                child: Image.asset('assets/auth/google-signin-light.png', width: 240, height: 44, fit: BoxFit.contain),
              ),
            ),
          ),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) => Screen(
        title: '백업 및 복원',
        subtitle: _sync.available ? '기록은 이 기기와 서버에 함께 저장돼요' : '모든 기록은 이 기기에만 저장돼요',
        children: [
          ..._backupSection(),
          const SectionBand(),
          ..._syncSection(),
        ],
      );
}
