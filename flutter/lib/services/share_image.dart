// 그린 PNG를 기기의 공유창으로 보내거나 사진첩에 저장한다(지금 앱 services/share-image.ts: 책 공유 카드·갈피 공유)
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

const _channel = MethodChannel('app.covebook/gallery');

class ShareImageError implements Exception {
  ShareImageError(this.stage, this.message);
  final String stage; // unavailable · image · share · save
  final String message;

  @override
  String toString() => message;
}

/// 공유·저장 실패 안내 제목
String shareErrorTitle(Object e) => switch (e is ShareImageError ? e.stage : '') {
      'share' => '공유 창을 열지 못했어요',
      'save' => '사진첩에 저장하지 못했어요',
      'unavailable' => '할 수 없어요',
      _ => '이미지를 만들지 못했어요',
    };

bool? _canSave;

/// 사진첩에 바로 저장할 수 있는 기기(Android 10+: 권한 없이 Pictures/책장한켠에). 아니면 저장 버튼을 숨기고 공유창만 쓴다
Future<bool> gallerySaveAvailable() async {
  if (_canSave != null) return _canSave!;
  try {
    return _canSave = Platform.isAndroid && (await _channel.invokeMethod<bool>('canSave') ?? false);
  } catch (_) {
    return _canSave = false;
  }
}

Future<Uint8List> pngOf(ui.Image img) async {
  final data = await img.toByteData(format: ui.ImageByteFormat.png);
  if (data == null) throw ShareImageError('image', '이미지를 만들지 못했어요. 다시 눌러 주세요.');
  return data.buffer.asUint8List();
}

Future<File> _temp(Uint8List png, String name) async {
  final dir = await getTemporaryDirectory();
  final f = File('${dir.path}/${name}_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}.png');
  await f.writeAsBytes(png);
  return f;
}

/// 공유창을 연다
Future<void> sharePng(Uint8List png, {required String name, required String title}) async {
  final f = await _temp(png, name);
  try {
    await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: 'image/png')], title: title));
  } catch (e) {
    throw ShareImageError('share', '$e');
  }
}

/// 사진첩 Pictures/책장한켠에 저장한다. 임시 파일은 저장 뒤 지운다
Future<void> savePng(Uint8List png, {required String name}) async {
  if (!await gallerySaveAvailable()) throw ShareImageError('unavailable', '이 기기에서는 사진첩에 바로 저장할 수 없어요. 공유를 눌러 저장해 주세요.');
  final f = await _temp(png, name);
  try {
    await _channel.invokeMethod<String>('save', {'path': f.path, 'name': f.uri.pathSegments.last});
  } catch (e) {
    throw ShareImageError('save', e is PlatformException ? (e.message ?? e.code) : '$e');
  } finally {
    f.delete().ignore();
  }
}
