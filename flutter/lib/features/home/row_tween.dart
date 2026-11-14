// 책 옮겨 가기(지금 앱 ui/shelf/planner의 밀림·끌기 미리 보기 움직임, MOTION_MS 230을 줄여 옮긴 것).
// 그릴 줄 목록이 바뀌면(끄는 동안 미리 보기, 놓은 뒤 새로 굽기, 빼기·넣기) 같은 줄에서 자세가 바뀐 책은 지금 보이던 자세(움직이는 중이면 그 중간)에서
// 새 자세로 미끄러진다. 빛은 새 자리로 구운 그림을 그대로 쓴다(움직이는 동안만 근사).
// 다른 줄로 가는 책은 그 줄 그림 안에서만 그려져(줄마다 잘라 그린다) 움직이지 않고 바로 놓인다. 지금 앱의 길 찾기(앞으로 빼기·비켜 가기)는 없다
library;

import '../../domain/book3.dart';
import '../../domain/shelf_row.dart';
import '../../domain/vec3.dart';

class RowTween {
  List<RowCase>? _target, _shown;
  Map<String, Book3> _from = const {};

  /// 움직일 책이 있는지
  bool get active => _from.isNotEmpty;

  /// 그릴 줄 목록을 바꾼다. 새 목록이면 true(움직임을 처음부터 다시 잰다). animate가 false면 바로 놓는다(움직임 줄이기)
  bool retarget(List<RowCase> target, {bool animate = true}) {
    if (identical(target, _target)) return false;
    final prev = _shown ?? _target;
    _target = target;
    _shown = null;
    final from = <String, Book3>{};
    if (animate && prev != null && prev.length == target.length) {
      for (var i = 0; i < target.length; i++) {
        final before = {for (final b in prev[i].books) b.id: b};
        for (final b in target[i].books) {
          final a = before[b.id];
          if (a != null && moved(a, b)) from['$i:${b.id}'] = a;
        }
      }
    }
    _from = from;
    return true;
  }

  /// 진행 k(0 = 이전 자세, 1 = 새 자세, 이미 늦추기를 거친 값)의 줄 목록. 다 왔으면 새 목록 그대로
  List<RowCase> at(double k) {
    final target = _target!;
    if (!active || k >= 1) {
      _shown = null;
      if (k >= 1) _from = const {};
      return target;
    }
    return _shown = [
      for (var i = 0; i < target.length; i++)
        target[i].books.any((b) => _from.containsKey('$i:${b.id}'))
            ? target[i].withBooks([
                for (final b in target[i].books)
                  if (_from['$i:${b.id}'] case final a?) lerpBook(a, b, k) else b,
              ])
            : target[i],
    ];
  }

  static bool moved(Book3 a, Book3 b) =>
      (a.t.x - b.t.x).abs() > 0.01 ||
      (a.t.y - b.t.y).abs() > 0.01 ||
      (a.t.z - b.t.z).abs() > 0.01 ||
      (a.roll - b.roll).abs() > 0.01 ||
      (a.yaw - b.yaw).abs() > 0.01 ||
      (a.spin - b.spin).abs() > 0.01 ||
      (a.pitch - b.pitch).abs() > 0.01;

  static Book3 lerpBook(Book3 a, Book3 b, double k) {
    double l(double x, double y) => x + (y - x) * k;
    return Book3(id: b.id, dims: b.dims, t: Vec3(l(a.t.x, b.t.x), l(a.t.y, b.t.y), l(a.t.z, b.t.z)), roll: l(a.roll, b.roll), yaw: l(a.yaw, b.yaw), spin: l(a.spin, b.spin), pitch: l(a.pitch, b.pitch));
  }
}
