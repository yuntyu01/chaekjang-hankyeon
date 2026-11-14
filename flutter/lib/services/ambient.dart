// 환경음(ASMR) 재생(지금 앱 services/ambient.ts). 독서 타이머와 따로 움직인다(소리만 들어도 독서 시간은 쌓이지 않는다).
// 음원은 Freesound 녹음을 모노 22kHz로 줄이고 이음매를 섞은 반복용 WAV(assets/sounds/provenance.json). 실제 재생 여부는 플레이어 상태로만 표시한다.
// 화면을 꺼도 이어 듣고 잠금 화면에 '빗소리 · 책장 한켠'처럼 보인다(just_audio_background)
library;

import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:just_audio_background/just_audio_background.dart';

import '../store/settings_store.dart';

class SceneInfo {
  const SceneInfo(this.id, this.name, this.sound, this.asset);
  final String id, name, sound, asset;
}

const scenes = [
  SceneInfo('rain', '밤의 창가', '빗소리', 'assets/sounds/rain.wav'),
  SceneInfo('fire', '벽난로', '장작 타는 소리', 'assets/sounds/fire.wav'),
];

/// 장면 이름(밤의 창가는 소리 쪽 이름으로 부른다: 머리줄·분위기 줄·시트가 같은 이름)
String sceneName(String id) => id == 'rain' ? '창가의 빗소리' : scenes.where((s) => s.id == id).firstOrNull?.name ?? '';

/// 실제 출력 음량 = 음소거면 0, 아니면 설정 음량
double outputVolume(double volume, bool muted) => muted ? 0 : volume.clamp(0.0, 1.0);

class Ambient extends ChangeNotifier {
  Ambient._() {
    SettingsStore.instance.addListener(_applyVolume);
  }
  static final instance = Ambient._();

  String? scene;
  bool playing = false;
  String? error;
  AudioPlayer? _player;
  static bool _bgReady = false;

  void _applyVolume() {
    final s = SettingsStore.instance;
    _player?.setVolume(outputVolume(s.volume, s.muted));
  }

  Future<void> play(String id) async {
    try {
      if (!_bgReady) {
        await JustAudioBackground.init(androidNotificationChannelId: 'app.covebook.ambient', androidNotificationChannelName: '환경음', androidNotificationOngoing: true);
        _bgReady = true;
      }
      if (scene != id || _player == null) {
        // 이전 장면 소리를 먼저 멈춘다(두 소리가 겹치지 않게)
        final old = _player;
        _player = null;
        await old?.stop();
        await old?.dispose();
        final info = scenes.firstWhere((s) => s.id == id);
        final p = AudioPlayer();
        _player = p;
        p.playingStream.listen((v) {
          if (!identical(_player, p) || v == playing) return;
          playing = v;
          notifyListeners();
        });
        await p.setAudioSource(AudioSource.asset(info.asset, tag: MediaItem(id: info.id, title: info.sound, artist: '책장 한켠')));
        await p.setLoopMode(LoopMode.one);
        scene = id;
        notifyListeners();
      }
      _applyVolume();
      _player!.play();
      error = null;
      notifyListeners();
    } catch (e) {
      error = '소리를 재생하지 못했어요. $e';
      playing = false;
      notifyListeners();
    }
  }

  void pause() => _player?.pause();

  /// 소리 크기 막대를 끄는 동안: 저장하지 않고 지금 나는 소리에만 바로 반영(손을 떼면 설정에 저장 → _applyVolume)
  void preview(double volume) => _player?.setVolume(outputVolume(volume, false));

  /// 소리 끄고 나가기: 플레이어를 놓아 잠금 화면 표시도 거둔다
  Future<void> stop() async {
    final p = _player;
    _player = null;
    scene = null;
    playing = false;
    notifyListeners();
    await p?.stop();
    await p?.dispose();
  }
}
