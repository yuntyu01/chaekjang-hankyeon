// 실제 책(YES24 표지가 있는 책)의 측면(책등) 모양(지금 앱 scene-config/spine-look.ts). 사용자가 스토어에서 고른다(2026-11-12 '측면 선택지 있게').
//  color  표지에서 책등과 맞닿는 띠의 색 한 가지 + 제목(기본)
//  photo  YES24 책등 사진 그대로(제목·장식이 사진 안에 있다. 책등 사진이 없는 책은 color)
//  stripe 앞표지에서 책등과 맞닿는 가장자리 한 줄을 옆으로 늘려 표지 색이 책등까지 줄무늬로 이어지게 + 제목
// 실행 중에 바꿀 수 있다(책장이 표지 사진을 다시 읽어 그린다). 저장 키는 지금 앱과 같은 'spine-look'
library;

import 'package:flutter/foundation.dart';

import '../db/kv_store.dart';

enum SpineLook { color, photo, stripe }

const _key = 'spine-look';

/// 지금 고른 측면 모양(바뀌면 책장·책 그림이 다시 그린다)
final spineLook = ValueNotifier<SpineLook>(SpineLook.color);

SpineLook? _parse(String? v) => switch (v) { 'color' => SpineLook.color, 'photo' => SpineLook.photo, 'stripe' => SpineLook.stripe, _ => null };

/// 시작할 때 저장된 값을 읽는다(책장을 그리기 전에)
Future<void> loadSpineLook() async {
  spineLook.value = _parse(await KvStore.get(_key)) ?? SpineLook.color;
}

/// 바꾸고 저장한다
Future<void> saveSpineLook(SpineLook v) async {
  spineLook.value = v;
  await KvStore.set(_key, v.name);
}
