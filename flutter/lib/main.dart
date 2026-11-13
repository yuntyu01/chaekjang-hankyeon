// 책장한켠(Flutter). 지금 앱(React Native, ../app)을 옮기는 중이다.
import 'package:flutter/material.dart';

import 'app/app_shell.dart';
import 'features/reading/mini_timer.dart';
import 'features/home/home_screen.dart' show bootAt;
import 'ui/bake.dart';
import 'store/mini_timer_store.dart';
import 'ui/theme.dart';

Future<void> main() async {
  bootAt = DateTime.now();
  WidgetsFlutterBinding.ensureInitialized();
  await initBake();
  runApp(const ChaekjangApp());
}

final appNavigator = GlobalKey<NavigatorState>();
final _miniTimerObserver = MiniTimerObserver();

class ChaekjangApp extends StatelessWidget {
  const ChaekjangApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: '책장한켠',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          scaffoldBackgroundColor: AppColors.bg,
          fontFamily: AppFonts.ui,
          colorScheme: ColorScheme.fromSeed(seedColor: AppColors.accent, surface: AppColors.bg),
        ),
        navigatorKey: appNavigator,
        navigatorObservers: [_miniTimerObserver],
        home: const AppShell(),
        // 공통 작은 타이머: 모든 화면 위에 한 겹(읽기 화면·읽기 탭에서는 숨는다)
        builder: (context, child) => Stack(children: [
          ?child,
          Material(type: MaterialType.transparency, child: MiniTimer(navigator: appNavigator)),
        ]),
      );
}
