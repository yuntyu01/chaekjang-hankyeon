// 앱 틀: 하단 탭(책장 · 갈피 · 읽기 · 기록 · 내 정보, 서버가 열면 커뮤니티). 지금 앱 app/(tabs)/_layout.tsx와 ui/tabBar.ts를 옮긴 것.
// 하단바는 화면 양옆·아래에서 띄운 흰 알약(옅은 그림자), 글자 없이 아이콘만: 고르지 않은 탭은 속이 빈 회색, 고른 탭은 검정으로 속이 찬 모양
library;

import 'package:flutter/material.dart';

import '../features/home/home_screen.dart';
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
  _Tab('갈피', (c, f) => bookmarkTabIcon(c, size: TabBarStyle.icon, filled: f), (_) => const _Pending('갈피')),
  _Tab('읽기', (c, f) => readTabIcon(c, AppColors.bg, size: TabBarStyle.icon, filled: f), (_) => const _Pending('읽기')),
  _Tab('기록', (c, f) => recordTabIcon(c, AppColors.bg, size: TabBarStyle.icon, filled: f), (_) => const StatsScreen()),
  _Tab('내 정보', (c, f) => profileTabIcon(c, size: TabBarStyle.icon, filled: f), (_) => const _Pending('내 정보')),
];

class _AppShellState extends State<AppShell> {
  int _index = 0;

  /// 한 번 연 탭은 살려 둔다(책장 그림·굽기를 다시 하지 않게)
  final _opened = <int>{0};

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

/// 아직 옮기지 않은 탭
class _Pending extends StatelessWidget {
  const _Pending(this.title);
  final String title;

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(TabHeader.paddingH, TabHeader.paddingTop, TabHeader.paddingH, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppType.title),
              const SizedBox(height: 8),
              Text('옮기는 중이에요', style: AppType.sub),
            ],
          ),
        ),
      );
}
