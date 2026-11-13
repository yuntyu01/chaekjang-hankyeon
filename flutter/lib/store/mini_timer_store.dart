// 공통 작은 타이머의 자리 정보(저장하지 않는다, 지금 앱 store/mini-timer-store.ts). 지금 맨 위 화면 이름·탭, 화면 아래 고정 버튼 높이(bottom),
// 둘 수 없는 상태(책장 꾸미기 조작부 등)는 hidden
library;

import 'package:flutter/widgets.dart';

const miniTimerSize = 56.0;

/// 타이머가 있는 화면에서 마지막 내용이 가려지지 않게 더하는 아래 여백(원 + 위아래 틈)
const miniTimerSpace = miniTimerSize + 20;

class MiniTimerPlace extends ChangeNotifier {
  MiniTimerPlace._();
  static final instance = MiniTimerPlace._();

  /// 맨 위 화면 이름('/'는 하단 탭 화면, '/reading/…'은 읽기 화면)
  String route = '/';

  /// 하단 탭 화면에서 고른 탭('/', '/bookmarks', '/read', '/stats', '/me')
  String tab = '/';
  double? bottom;
  bool hidden = false;

  /// 시트·확인창이 떠 있다(지금 앱은 시트가 따로 된 창이라 작은 타이머를 덮는다)
  bool modal = false;

  String get path => route == '/' ? tab : route;

  void setTab(String t) {
    if (t == tab) return;
    tab = t;
    notifyListeners();
  }

  void setHidden(bool h) {
    if (h == hidden) return;
    hidden = h;
    notifyListeners();
  }

  void setBottom(double? b) {
    if (b == bottom) return;
    bottom = b;
    notifyListeners();
  }

  void _route(Route<dynamic>? page, bool overlay) {
    final name = page?.settings.name ?? '/other';
    if (name == route && overlay == modal) return;
    route = name;
    modal = overlay;
    notifyListeners();
  }
}

/// 맨 위 화면이 바뀔 때 작은 타이머에 알린다(시트·확인창은 무시)
class MiniTimerObserver extends NavigatorObserver {
  final _stack = <Route<dynamic>>[];

  // 맨 위 화면(시트·확인창 아래의 화면)과, 그 위에 시트·확인창이 떠 있는지
  void _top() => MiniTimerPlace.instance._route(_stack.whereType<PageRoute<dynamic>>().lastOrNull, _stack.isNotEmpty && _stack.last is! PageRoute);

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _stack.add(route);
    _top();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _stack.remove(route);
    _top();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _stack.remove(route);
    _top();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final i = oldRoute == null ? -1 : _stack.indexOf(oldRoute);
    if (i >= 0 && newRoute != null) {
      _stack[i] = newRoute;
    } else if (newRoute != null) {
      _stack.add(newRoute);
    }
    _top();
  }
}
