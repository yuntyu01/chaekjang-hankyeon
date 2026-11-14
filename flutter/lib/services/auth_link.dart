// 소셜 로그인 창(지금 앱 expo-web-browser openAuthSessionAsync 자리): 로그인 주소를 브라우저 탭(Custom Tabs)으로 열고,
// 서버가 돌려보내는 chaekjang://auth/<공급자>?ticket=… 주소를 기다린다(MainActivity가 받아 채널로 넘긴다).
// 창을 닫고 앱으로 돌아왔는데 주소가 오지 않으면 취소로 본다
library;

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

const _channel = MethodChannel('app.covebook/auth');
Completer<Uri?>? _waiting;
bool _ready = false;

void _init() {
  if (_ready) return;
  _ready = true;
  _channel.setMethodCallHandler((call) async {
    if (call.method != 'redirect') return;
    final w = _waiting;
    if (w != null && !w.isCompleted) w.complete(Uri.tryParse(call.arguments as String));
  });
}

class _Resume with WidgetsBindingObserver {
  _Resume(this.onResume);
  final VoidCallback onResume;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) onResume();
  }
}

/// 로그인 창을 열고 돌아온 주소(취소면 null)
Future<Uri?> openAuthSession(String url) async {
  _init();
  final w = _waiting = Completer<Uri?>();
  Timer? giveUp;
  final watch = _Resume(() {
    // 주소는 앱이 앞으로 온 직후에 온다: 잠깐 기다렸다 없으면 취소
    giveUp?.cancel();
    giveUp = Timer(const Duration(milliseconds: 1500), () {
      if (!w.isCompleted) w.complete(null);
    });
  });
  WidgetsBinding.instance.addObserver(watch);
  try {
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.inAppBrowserView);
    if (!ok) return null;
    return await w.future;
  } finally {
    giveUp?.cancel();
    WidgetsBinding.instance.removeObserver(watch);
    _waiting = null;
  }
}
