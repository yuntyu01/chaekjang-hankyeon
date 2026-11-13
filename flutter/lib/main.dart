// 책장한켠(Flutter). 지금 앱(React Native, ../app)을 옮기는 중이다.
import 'package:flutter/material.dart';

import 'app/app_shell.dart';
import 'features/home/home_screen.dart' show bootAt;
import 'ui/bake.dart';
import 'ui/theme.dart';

Future<void> main() async {
  bootAt = DateTime.now();
  WidgetsFlutterBinding.ensureInitialized();
  await initBake();
  runApp(const ChaekjangApp());
}

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
        home: const AppShell(),
      );
}
