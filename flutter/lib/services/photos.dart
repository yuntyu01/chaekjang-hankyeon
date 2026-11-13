// 사진 찍기·고르기(지금 앱 services/photos.ts). 권한을 거절해도 앱은 계속 쓸 수 있게 결과로 알려 준다.
// crop: 찍은 뒤 문장 부분만 자를 수 있게 자르기 화면을 연다(사진 갈피)
library;

import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';

sealed class PhotoResult {
  const PhotoResult();
}

class PhotoOk extends PhotoResult {
  const PhotoOk(this.uri, {this.width, this.height});
  final String uri;
  final int? width, height;
}

class PhotoFail extends PhotoResult {
  const PhotoFail(this.reason, [this.message]);

  /// denied · canceled · error
  final String reason;
  final String? message;
}

Future<PhotoResult> pickPhoto(String from, {bool crop = false}) async {
  try {
    final x = await ImagePicker().pickImage(source: from == 'camera' ? ImageSource.camera : ImageSource.gallery, imageQuality: 80);
    if (x == null) return const PhotoFail('canceled');
    var path = x.path;
    if (crop) {
      final c = await ImageCropper().cropImage(sourcePath: path, uiSettings: [AndroidUiSettings(toolbarTitle: '사진 자르기', lockAspectRatio: false), IOSUiSettings(title: '사진 자르기')]);
      if (c == null) return const PhotoFail('canceled');
      path = c.path;
    }
    final bytes = await XFile(path).readAsBytes();
    final codec = await ui.instantiateImageCodec(bytes);
    final f = await codec.getNextFrame();
    final w = f.image.width, h = f.image.height;
    f.image.dispose();
    return PhotoOk(Uri.file(path).toString(), width: w, height: h);
  } on PlatformException catch (e) {
    if (e.code.contains('denied') || e.code.contains('access')) return const PhotoFail('denied');
    return PhotoFail('error', e.message);
  } catch (e) {
    return PhotoFail('error', '$e');
  }
}

String deniedMessage(String from) => from == 'camera'
    ? '카메라 권한이 없어 사진을 찍을 수 없어요. 설정에서 허용하거나, 사진 보관함에서 고르거나, 직접 입력해 주세요.'
    : '사진 보관함 권한이 없어요. 설정에서 허용하거나 직접 입력해 주세요.';
