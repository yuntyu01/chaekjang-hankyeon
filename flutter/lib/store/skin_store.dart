// 고른 스킨 저장(지금 앱 boot-store 'shelf-skin': 기기 키·값 저장소, 같은 키·같은 글자 '선반,틀,벽지')
library;

import '../db/kv_store.dart';
import '../scene_config/skin.dart';

const _key = 'shelf-skin';

/// 시작할 때 저장된 스킨을 읽어 쓴다(책장을 굽기 전에)
Future<void> loadSkin() async {
  final c = SkinChoice.parse(await KvStore.get(_key));
  if (c != null) setSkin(c);
}

Future<void> saveSkin(SkinChoice c) => KvStore.set(_key, c.key);
