// 설정(지금 앱 app/settings.tsx, 하단 '내 정보' 탭): 독서 환경(진동·움직임 줄이기) / 내 기록(백업 및 복원) / 앱 안내(문의·개인정보·앱 정보).
// 흰 바탕, 줄 사이 선 없음, 묶음 사이 화면 끝까지 닿는 1dp 선. 다른 화면으로 가는 줄에만 화살표.
// 서버 주소가 없는 빌드는 '이 기기에만 저장' 쪽 문구를 쓴다(지금 앱도 서버를 못 쓰면 같은 문구)
library;

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../store/settings_store.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../services/sync.dart';
import '../../ui/theme.dart';
import 'backup_screen.dart' show openBackup;

const _privacyUrl = 'https://midi-broccoli-56c.notion.site/Covebook-3eb50284670881b0a0e2c6029cea29c7';
const _mail = 'yuntyu01@gmail.com';
const _motion = [
  (id: 'system', label: '기기 설정 따르기', short: '기기 설정'),
  (id: 'on', label: '켜기', short: '켬'),
  (id: 'off', label: '끄기', short: '끔'),
];

/// 서버 동기화를 쓸 수 있는지(서버 주소가 있는 빌드)
bool get _syncAvailable => SyncService.instance.available;

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, this.tab = false});

  /// 하단 '내 정보' 탭(뒤로 없음, 떠 있는 탭 바만큼 아래 여백)
  final bool tab;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _s = SettingsStore.instance;
  String _version = '';

  @override
  void initState() {
    super.initState();
    _s.addListener(_changed);
    _s.load();
    PackageInfo.fromPlatform().then((p) {
      if (mounted) setState(() => _version = p.version);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _s.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _motionSheet() => showSheet<void>(
        context,
        title: '움직임 줄이기',
        builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.only(bottom: Space.s), child: Text('켜면 책이 움직이는 연출과 독서 장면의 움직임을 줄여요.', style: AppType.sub)),
          ListGroup(children: [
            for (final m in _motion)
              ListItem(
                label: m.label,
                selected: _s.reduceMotion == m.id,
                right: _s.reduceMotion == m.id ? const LucideIcon('Check', color: AppColors.accent, stroke: 2) : null,
                onPress: () {
                  _s.set({'reduceMotion': m.id});
                  Navigator.pop(ctx);
                },
              ),
          ]),
        ]),
      );

  void _privacySheet() => showSheet<void>(
        context,
        title: '개인정보 처리 안내',
        scroll: true,
        maxHeight: 0.8,
        builder: (ctx) {
          final p = AppType.body.copyWith(color: AppColors.ink);
          Widget para(String t, {bool last = false}) => Padding(padding: EdgeInsets.only(bottom: last ? 0 : Space.item), child: Text(t, style: p));
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            para(_syncAvailable
                ? '책장 한켠은 로그인 없이 쓸 수 있으며, 책·독서 기록·갈피·사진은 이 기기에 저장되고 이 기기 전용 계정으로 책장 한켠 서버에도 동기화돼요. 카카오나 Google을 연결하면 해당 서비스의 회원 식별자와 선택한 닉네임이 서버에 저장되고, 다른 기기에서 같은 기록을 이어 볼 수 있어요.'
                : '책장 한켠은 로그인 없이 쓰며, 책·독서 기록·갈피·사진은 이 기기 안에만 저장돼요.'),
            para('책을 검색하면 입력한 검색어가 책장 한켠 서버를 거쳐 도서 정보 서비스(YES24)로 전송되고, 서버에 닿지 않거나 결과가 없으면 Google Books·Open Library로 전송돼요. 검색 요청과 표지 이미지 요청에는 IP 주소 등 통신 정보가 함께 전달돼요.'),
            para('사진은 책을 찾고 장정을 만들 때 참고하거나 갈피 원문을 보관하는 데만 쓰고, 읽었다는 인증에는 쓰지 않아요. '
                '${_syncAvailable ? '사진 인식·AI 장정은 아직 연결되지 않았고, 사진은 동기화를 위해 책장 한켠 서버에만 올라가요.' : '사진 인식·AI 장정은 아직 연결되지 않아 사진이 밖으로 전송되지 않아요.'}'),
            para('내보낸 백업 파일은 직접 고른 곳에 저장되며, 그 파일에는 위 기록과 사진이 들어 있어요.', last: true),
            // 지금 앱은 이 문단에도 아래 여백(space.item)이 남는다(공통 문단 스타일)
            Padding(padding: const EdgeInsets.only(top: Space.item, bottom: Space.item), child: Text('서버 계정 삭제를 요청하면 연결된 로그인과 서버 기록·사진을 삭제 처리하고, 이 기기의 기록은 남겨요.', style: p)),
            Padding(
              padding: const EdgeInsets.only(top: Space.xl),
              child: Btn(label: '처리방침 전문 보기(웹)', kind: 'secondary', onPress: () => launchUrl(Uri.parse(_privacyUrl), mode: LaunchMode.externalApplication)),
            ),
          ]);
        },
      );

  Future<void> _mailTo() async {
    final ok = await launchUrl(Uri.parse('mailto:$_mail')).catchError((_) => false);
    if (!ok && mounted) appAlert(context, '메일 앱을 열 수 없어요', '$_mail 으로 보내 주세요.');
  }

  @override
  Widget build(BuildContext context) {
    final tab = widget.tab;
    return Screen(
      title: tab ? '내 정보' : '설정',
      back: !tab,
      bottomPad: tab ? TabBarStyle.contentPad - Space.section : 0,
      children: [
        ListGroup(title: '독서 환경', children: [
          ListItem(label: '진동', right: Toggle(label: '진동', value: _s.haptics, onChange: (v) => _s.set({'haptics': v}))),
          ListItem(label: '움직임 줄이기', value: _motion.where((m) => m.id == _s.reduceMotion).firstOrNull?.short, onPress: _motionSheet),
        ]),
        const SectionBand(),
        ListGroup(title: '내 기록', children: [
          ListItem(label: '백업 및 복원', sub: _syncAvailable ? '기록은 이 기기와 서버에 저장돼요' : '기록은 이 기기에 저장돼요', chevron: true, onPress: () => openBackup(context)),
        ]),
        const SectionBand(),
        ListGroup(title: '앱 안내', children: [
          ListItem(label: '문의하기', sub: _mail, onPress: _mailTo),
          ListItem(label: '개인정보 처리방침', onPress: _privacySheet),
          ListItem(label: '앱 정보', value: _version),
        ]),
        const BrandFooter(),
      ],
    );
  }
}
