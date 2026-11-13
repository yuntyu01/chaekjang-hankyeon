// 앱 틀: 하단 탭(책장 · 갈피 · 읽기 · 기록 · 내 정보, 서버가 열면 커뮤니티). 지금 앱 app/(tabs)/_layout.tsx와 ui/tabBar.ts를 옮긴 것.
// 하단바는 화면 양옆·아래에서 띄운 흰 알약(옅은 그림자), 글자 없이 아이콘만: 고르지 않은 탭은 속이 빈 회색, 고른 탭은 검정으로 속이 찬 모양
library;

import 'package:flutter/material.dart';

import '../features/bookmark/bookmarks_screen.dart';
import '../domain/library.dart';
import '../features/home/home_screen.dart';
import '../features/reading/finish_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/reading/reading_screen.dart';
import '../store/library_model.dart';
import '../store/mini_timer_store.dart';
import '../store/reading_store.dart';
import '../ui/alert.dart';
import '../features/reading/read_list.dart';
import '../features/stats/stats_screen.dart';
import '../ui/tab_icons.dart';
import '../ui/theme.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

typedef _TabIcon = Widget Function(Color color, bool filled);

class _Tab {
  const _Tab(this.label, this.icon, this.build);
  final String label;
  final _TabIcon icon;
  final WidgetBuilder build;
}

final _tabs = <_Tab>[
  _Tab('책장', (c, f) => shelfIcon(c, size: TabBarStyle.icon, filled: f), (_) => const HomeScreen()),
  _Tab('갈피', (c, f) => bookmarkTabIcon(c, size: TabBarStyle.icon, filled: f), (_) => const BookmarksScreen()),
  _Tab('읽기', (c, f) => readTabIcon(c, AppColors.bg, size: TabBarStyle.icon, filled: f), (_) => const ReadList()),
  _Tab('기록', (c, f) => recordTabIcon(c, AppColors.bg, size: TabBarStyle.icon, filled: f), (_) => const StatsScreen()),
  _Tab('내 정보', (c, f) => profileTabIcon(c, size: TabBarStyle.icon, filled: f), (_) => const SettingsScreen(tab: true)),
];

/// 탭마다 지금 앱 경로(작은 타이머 자리·숨김을 정한다)
const _tabPaths = ['/', '/bookmarks', '/read', '/stats', '/me'];

class _AppShellState extends State<AppShell> {
  int _index = 0;

  /// 한 번 연 탭은 살려 둔다(책장 그림·굽기를 다시 하지 않게)
  final _opened = <int>{0};

  @override
  void initState() {
    super.initState();
    // 지난 독서가 중간에 멈췄거나 끝낸 기록을 저장하지 않았으면 다시 켰을 때 묻는다(지금 앱 RecoveryDialog)
    final reading = ReadingStore.instance;
    // 서재는 첫 화면이 뜬 뒤 미리 읽어 둔다(복구 창·다른 탭이 책을 바로 찾게)
    WidgetsBinding.instance.addPostFrameCallback((_) => LibraryModel.instance.load());
    reading.load().then((_) {
      if (mounted) WidgetsBinding.instance.addPostFrameCallback((_) => _askRecovery());
    }, onError: (_) {});
  }

  void _askRecovery() {
    final reading = ReadingStore.instance;
    final it = reading.interrupted;
    final pending = reading.pending;
    if (it == null && pending != null && reading.pendingRestored) {
      appAlert(context, '저장하지 않은 독서 기록이 있어요', '지난번에 끝낸 ${formatDuration(pending.durationMs)} 기록을 아직 저장하거나 버리지 않았어요.', [
        AlertButton('기록 확인하기', onPress: () {
          reading.ackPendingRestored();
          Navigator.of(context).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/reading/finish'), builder: (_) => const FinishScreen()));
        }),
        AlertButton('나중에', style: AlertStyle.cancel, onPress: reading.ackPendingRestored),
      ], true, true);
      return;
    }
    if (it == null) return;
    final at = DateTime.fromMillisecondsSinceEpoch(it.lastBeat.toInt());
    final hm = '${at.hour}:${at.minute.toString().padLeft(2, '0')}';
    appAlert(
      context,
      '지난 독서가 중간에 멈췄어요',
      '마지막으로 확인된 $hm까지 ${formatDuration(it.countedMs)}을 읽은 것으로 저장해 두었어요. 앱이 꺼져 있던 ${formatDuration(it.gapMs)}은 독서 시간에 넣지 않았어요.',
      [
        AlertButton('이어 읽기', onPress: () {
          reading.resume();
          openReadingScene(context);
        }),
        AlertButton('$hm에 끝낸 것으로 기록하기', onPress: () {
          reading.finish(it.lastBeat);
          Navigator.of(context).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/reading/finish'), builder: (_) => const FinishScreen()));
        }),
        AlertButton('나중에 정하기(일시정지로 둠)', style: AlertStyle.cancel, onPress: reading.dismissInterrupted),
      ],
      true,
      true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Stack(
        children: [
          IndexedStack(
            index: _index,
            children: [for (var i = 0; i < _tabs.length; i++) _opened.contains(i) ? _tabs[i].build(context) : const SizedBox.shrink()],
          ),
          Positioned(
            left: TabBarStyle.side,
            right: TabBarStyle.side,
            bottom: bottom + TabBarStyle.gap,
            height: TabBarStyle.height,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: AppColors.white,
                borderRadius: BorderRadius.circular(TabBarStyle.height / 2),
                boxShadow: const [TabBarStyle.shadow],
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: TabBarStyle.paddingX),
                child: Row(
                  children: [
                    for (var i = 0; i < _tabs.length; i++)
                      Expanded(
                        child: Semantics(
                          button: true,
                          selected: i == _index,
                          label: _tabs[i].label,
                          child: GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => setState(() {
                              _index = i;
                              _opened.add(i);
                              MiniTimerPlace.instance.setTab(_tabPaths[i]);
                            }),
                            child: Center(child: _tabs[i].icon(i == _index ? AppColors.tabInk : AppColors.tabInkSoft, i == _index)),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
