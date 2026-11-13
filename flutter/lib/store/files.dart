// 앱 안 사진 보관(지금 앱 store/files.ts): 갈피 사진·표지 사진을 앱 폴더(files/images)로 옮겨 둔다(지금 앱 documentDirectory/images 와 같은 곳)
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';

Future<Directory> imageDir() async {
  final base = Platform.isIOS ? await getApplicationDocumentsDirectory() : await getApplicationSupportDirectory();
  final d = Directory('${base.path}/images');
  if (!d.existsSync()) d.createSync(recursive: true);
  return d;
}

/// 고른 사진을 앱 안으로 복사하고 새 주소(file://)를 돌려준다
Future<String> keepImage(String src, String prefix) async {
  final path = src.startsWith('file://') ? Uri.parse(src).toFilePath() : src;
  final m = RegExp(r'\.(jpe?g|png|webp)$', caseSensitive: false).firstMatch(path.split('?').first);
  final ext = (m?.group(1) ?? 'jpg').toLowerCase();
  final dir = await imageDir();
  final dest = File('${dir.path}/${prefix}_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}.$ext');
  await File(path).copy(dest.path);
  return Uri.file(dest.path).toString();
}
