// 책장한켠(Flutter). 지금 앱(React Native, ../app)을 옮기는 중이다.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app/app_shell.dart';
import 'services/cover_colors.dart';
import 'features/reading/mini_timer.dart';
import 'features/home/home_screen.dart' show bootAt;
import 'ui/bake.dart';
import 'store/mini_timer_store.dart';
import 'ui/theme.dart';

Future<void> main() async {
  bootAt = DateTime.now();
  WidgetsFlutterBinding.ensureInitialized();
  await initBake();
  // 기기에 재 둔 책등 비율·갈피 색(책장 책 크기·갈피 색)
  await loadCoverMeasures();
  runApp(const ChaekjangApp());
}

final appNavigator = GlobalKey<NavigatorState>();
final _miniTimerObserver = MiniTimerObserver();

// 글자 자간: Material 3 기본 글자(bodyMedium 0.25 등)를 Text가 물려받아 모든 글자가 지금 앱보다 약 1.4% 넓었다(줄바꿈이 달라짐).
// 지금 앱(RN)은 자간을 따로 주지 않으면 0이다 → 테마 글자 전부 0
final _theme = (() {
  final base = ThemeData(
    scaffoldBackgroundColor: AppColors.bg,
    fontFamily: AppFonts.ui,
    colorScheme: ColorScheme.fromSeed(seedColor: AppColors.accent, surface: AppColors.bg),
  );
  TextStyle? flat(TextStyle? s) => s?.copyWith(letterSpacing: 0);
  final t = base.textTheme;
  return base.copyWith(
    textTheme: TextTheme(
      displayLarge: flat(t.displayLarge), displayMedium: flat(t.displayMedium), displaySmall: flat(t.displaySmall),
      headlineLarge: flat(t.headlineLarge), headlineMedium: flat(t.headlineMedium), headlineSmall: flat(t.headlineSmall),
      titleLarge: flat(t.titleLarge), titleMedium: flat(t.titleMedium), titleSmall: flat(t.titleSmall),
      bodyLarge: flat(t.bodyLarge), bodyMedium: flat(t.bodyMedium), bodySmall: flat(t.bodySmall),
      labelLarge: flat(t.labelLarge), labelMedium: flat(t.labelMedium), labelSmall: flat(t.labelSmall),
    ),
  );
})();

class ChaekjangApp extends StatelessWidget {
  const ChaekjangApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: '책장한켠',
        debugShowCheckedModeBanner: false,
        theme: _theme,
        navigatorKey: appNavigator,
        navigatorObservers: [_miniTimerObserver],
        home: const AppShell(),
        // 공통 작은 타이머: 모든 화면 위에 한 겹(읽기 화면·읽기 탭에서는 숨는다)
        builder: (context, child) {
          // 글자 크기를 지금 앱처럼 화소로 올린다(RnTextScaler, ui/theme.dart)
          final mq = MediaQuery.of(context);
          return MediaQuery(
            data: mq.copyWith(textScaler: RnTextScaler(mq.textScaler, mq.devicePixelRatio)),
            // 상태 표시줄 기본 = 어두운 글자(지금 앱 StatusBar style="dark"). 읽기 장면은 자기 화면에서 밝은 글자로 덮고, 나오면 이 값으로 돌아온다
            child: AnnotatedRegion<SystemUiOverlayStyle>(
              value: const SystemUiOverlayStyle(statusBarColor: Color(0x00000000), statusBarIconBrightness: Brightness.dark, statusBarBrightness: Brightness.light),
              child: Stack(children: [
                ?child,
                Material(type: MaterialType.transparency, child: MiniTimer(navigator: appNavigator)),
              ]),
            ),
          );
        },
      );
}
