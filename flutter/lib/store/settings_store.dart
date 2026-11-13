// 사용자 설정(기기 로컬, 지금 앱 store/settings-store.ts): 효과음·진동·동작 줄이기·독서 목표·분위기 장면·소리 크기·읽기 탭 목록.
// 저장본(app-settings:v1)을 그대로 읽고 쓴다: 모르는 키도 지우지 않고 함께 다시 저장한다
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../db/kv_store.dart';

const _key = 'app-settings:v1';

const defaultSettings = <String, Object?>{
  'sound': true,
  'haptics': true,
  'reduceMotion': 'system',
  'goalMin': null,
  'scene': 'rain',
  'volume': 0.6,
  'muted': false,
  'readList': <String>[],
};

/// 예전에 있던 장면('room' 등)이 남아 있으면 빗소리로
Map<String, Object?> _fixScene(Map<String, Object?> s) =>
    !s.containsKey('scene') || s['scene'] == 'rain' || s['scene'] == 'fire' ? s : {...s, 'scene': 'rain'};

class SettingsStore extends ChangeNotifier {
  SettingsStore._();
  static final instance = SettingsStore._();

  Map<String, Object?> _s = {...defaultSettings};
  bool loaded = false;
  Future<void>? _loading;

  bool get sound => _s['sound'] == true;
  bool get haptics => _s['haptics'] == true;
  String get reduceMotion => _s['reduceMotion'] as String? ?? 'system';
  num? get goalMin => _s['goalMin'] as num?;
  String get scene => _s['scene'] as String? ?? 'rain';
  double get volume => (_s['volume'] as num? ?? 0.6).toDouble();
  bool get muted => _s['muted'] == true;
  List<String> get readList => ((_s['readList'] as List?) ?? const []).cast<String>();

  Future<void> load() => _loading ??= () async {
        try {
          final raw = await KvStore.get(_key);
          if (raw != null) _s = {...defaultSettings, ..._fixScene((jsonDecode(raw) as Map).cast<String, Object?>())};
        } catch (_) {
          // 못 읽으면 기본값
        }
        loaded = true;
        notifyListeners();
      }();

  void set(Map<String, Object?> patch) {
    _s = {..._s, ..._fixScene(patch)};
    notifyListeners();
    KvStore.set(_key, jsonEncode(_s)).catchError((_) {});
  }
}
