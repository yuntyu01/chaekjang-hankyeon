// 사진 갈피의 사진(지금 앱 PhotoPlate.tsx): 흰 테두리를 두른 인화 사진을 한지 테이프로 붙인 모양.
// 사진은 가로로 긴 틀에 맞춰 자르고(cover), 눌러서 원본 비율 그대로 크게 볼 수 있다
library;

import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../services/cover_cache.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'bookmark_paper.dart';

double photoFrameRatio(num? r) => math.max(0.9, math.min(1.5, r != null && r > 0 ? r.toDouble() : 1.35));

const _deg = math.pi / 180;

/// 갈피 사진 한 장(내 기기 파일 또는 주소)
class BookmarkPhoto extends StatefulWidget {
  const BookmarkPhoto({super.key, required this.uri, this.fit = BoxFit.cover});
  final String uri;
  final BoxFit fit;

  @override
  State<BookmarkPhoto> createState() => _BookmarkPhotoState();
}

class _BookmarkPhotoState extends State<BookmarkPhoto> {
  ui.Image? _remote;

  bool get _local => !widget.uri.startsWith('http');

  @override
  void initState() {
    super.initState();
    if (!_local) {
      final u = widget.uri;
      final hit = coverInMemory(u);
      if (hit != null) {
        _remote = hit;
      } else {
        loadCover(u).then((img) {
          if (mounted && img != null) setState(() => _remote = img);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_local) {
      final path = widget.uri.startsWith('file://') ? Uri.parse(widget.uri).toFilePath() : widget.uri;
      return Image.file(File(path), fit: widget.fit, errorBuilder: (_, _, _) => const SizedBox.shrink(), semanticLabel: '페이지 사진');
    }
    return _remote == null ? const SizedBox.shrink() : RawImage(image: _remote, fit: widget.fit);
  }
}

class PhotoPlate extends StatelessWidget {
  const PhotoPlate({super.key, required this.uri, required this.width, required this.seed, this.ratio, this.compact = false});
  final String uri;
  final num? ratio;
  final double width;
  final String seed;
  final bool compact;

  void _open(BuildContext context) {
    showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: '닫기',
      barrierColor: const Color.fromRGBO(18, 14, 10, 0.92),
      transitionDuration: const Duration(milliseconds: 200),
      pageBuilder: (ctx, _, _) {
        final insets = MediaQuery.paddingOf(ctx);
        final size = MediaQuery.sizeOf(ctx);
        return GestureDetector(
          onTap: () => Navigator.pop(ctx),
          child: Stack(children: [
            Center(child: SizedBox(width: size.width, height: size.height * 0.82, child: BookmarkPhoto(uri: uri, fit: BoxFit.contain))),
            Positioned(top: insets.top + 12, right: 22, child: const SizedBox(width: 44, height: 44, child: Center(child: LucideIcon('X', size: 22, color: Color(0xFFFFFFFF))))),
          ]),
        );
      },
      transitionBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: child),
    );
  }

  @override
  Widget build(BuildContext context) {
    final border = compact ? 4.0 : 6.0;
    final frameRatio = photoFrameRatio(compact ? math.max(ratio ?? 1.35, 1.35) : ratio);
    final innerW = width - border * 2;
    final tapeW = compact ? 62.0 : 92.0, tapeH = compact ? 20.0 : 30.0;
    return SizedBox(
      width: width,
      child: Stack(clipBehavior: Clip.none, children: [
        Padding(
          padding: EdgeInsets.only(top: compact ? 8 : 12),
          child: Semantics(
            button: true,
            label: '갈피 사진 크게 보기',
            child: GestureDetector(
              onTap: () => _open(context),
              child: Transform.rotate(
                angle: (compact ? -0.4 : -0.8) * _deg,
                child: Container(
                  padding: EdgeInsets.all(border),
                  decoration: BoxDecoration(color: const Color(0xFFFFFFFF), boxShadow: [
                    cssShadow(const Color.fromRGBO(90, 66, 40, 0.2), 0, 1, 1.6),
                    cssShadow(const Color.fromRGBO(110, 82, 50, 0.2), 1, 6, 14),
                  ]),
                  child: SizedBox(
                    width: innerW,
                    height: innerW / frameRatio,
                    child: ClipRect(
                      child: ColoredBox(
                        color: const Color(0xFFECE9E4),
                        child: Stack(fit: StackFit.expand, children: [
                          BookmarkPhoto(uri: uri),
                          // 종이 위 사진처럼 가장자리를 아주 조금 어둡게
                          const IgnorePointer(child: CustomPaint(painter: _InsetShadow(Color.fromRGBO(60, 45, 30, 0.16), 14))),
                        ]),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        Positioned(
          left: width / 2 - tapeW / 2 + 2,
          top: 0,
          width: tapeW,
          height: tapeH,
          child: IgnorePointer(
            child: Transform.rotate(
              angle: -0.8 * _deg,
              child: Opacity(
                opacity: 0.86,
                child: Container(
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(1.5), boxShadow: [cssShadow(const Color.fromRGBO(100, 80, 50, 0.18), 0, 1, 2)]),
                  child: BookmarkPaper(color: const Color(0xFFE8E4DC), radius: 1.5, seed: '$seed-washi', kind: PaperKind.tape),
                ),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}

/// 안쪽 그림자(CSS inset, 흐림 반경 blur)
class _InsetShadow extends CustomPainter {
  const _InsetShadow(this.color, this.blur);
  final Color color;
  final double blur;

  @override
  void paint(Canvas canvas, Size size) {
    final r = Offset.zero & size;
    canvas.clipRect(r);
    final frame = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(r.inflate(blur * 2))
      ..addRect(r);
    canvas.drawPath(frame, Paint()
      ..color = color
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, blur / 2));
  }

  @override
  bool shouldRepaint(_InsetShadow old) => old.color != color || old.blur != blur;
}
