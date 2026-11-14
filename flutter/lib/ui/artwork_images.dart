// 기본 정면 장정 그림(assets/covers/artworks) 그림: 책장을 그리기 전에 한 번 풀어 둔다(지금 앱 require 이미지)
library;

import 'dart:ui' as ui;

import 'package:flutter/services.dart' show rootBundle;

import '../domain/cover_artworks.dart';
import '../services/cover_cache.dart' show decodeImageInLine;

final Map<String, ui.Image> _images = {};
Future<void>? _loading;

/// 그림 6장을 푼다(한 번만, 한 장씩)
Future<void> loadArtworkImages() => _loading ??= () async {
      for (final a in coverArtworks) {
        try {
          final data = await rootBundle.load(artworkAsset(a.id));
          final img = await decodeImageInLine(data.buffer.asUint8List());
          if (img != null) _images[a.id] = img;
        } catch (_) {
          // 못 풀면 그 그림을 고른 책은 책 색 표지로
        }
      }
    }();

ui.Image? artworkImage(String id) => _images[id];
