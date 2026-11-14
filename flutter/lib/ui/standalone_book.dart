// 선반 밖의 책 한 권(지금 앱 ui/book3d/StandaloneBook.tsx: 서랍·상세·장정 편집): 선반과 같은 책 그림·빛 셰이더로 그리되 둘레가 없는 열린 방
// (판·벽 그늘 없음, 구운 하늘 가림 없이 그 자리에서 빛을 계산한다). 카메라는 기본 보기 각, 눈은 그 책 가운데.
// RotatableBook: 손가락으로 좌우로 돌려 보는 책(장정 편집 미리보기). 표지 전시 자세에서 세로축으로만 돈다(spin, −70~95°)
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../domain/book3.dart';
import '../domain/book3_physics.dart' show fromPlaced;
import '../domain/book_look.dart';
import '../domain/camera.dart' show viewPitchMin;
import '../domain/placed.dart';
import '../domain/types.dart';
import '../domain/vec3.dart';
import '../features/home/home_screen.dart' show ShelfPainter;
import '../services/cover_cache.dart' show loadCover;
import 'bake.dart' show emptyImage;
import 'cover_photo.dart';
import 'outline.dart' show seedOf;
import 'scene.dart';
import 'theme.dart' show cssShadow;

/// 캔버스 여백(DU): 가장자리가 잘리지 않게
const bookPad = 4.0;

/// 열린 방(둘레 없음): 셰이더 env 종류 0
const _openRoom = [0.0, 0.0, 0.0];

Book3 _rest(Book book, Pose pose) => fromPlaced(Placed(book.id, pose, boxSize(book, pose), 0, 0, 0, 0));

/// 책 가운데를 축으로 spin만큼 돌린 자세
Book3 _spun(Book3 rest, double spin) {
  final c = Vec3(rest.dims.t / 2, rest.dims.h / 2, rest.dims.w / 2);
  final center = toWorld(rest, c);
  final r = rot(rest.roll, rest.yaw, c, spin, 0);
  return Book3(id: rest.id, dims: rest.dims, t: center - r, roll: rest.roll, yaw: rest.yaw, spin: spin, pitch: rest.pitch);
}

/// 투영 외곽(설계 단위)
ui.Rect _bbox(Cam cam, Book3 b) => bookOutline(cam, Affine(1, 0, 0), b).getBounds();

class _BookPainter extends CustomPainter {
  _BookPainter(this.book, this.b, this.cam, this.px, this.photo);
  final Book book;
  final Book3 b;
  final Cam cam;
  final Affine px;
  final CoverPhoto? photo;

  @override
  void paint(Canvas canvas, Size size) {
    final slots = ShelfPainter.bookSlots, glyphs = ShelfPainter.glyphs;
    if (slots == null || glyphs == null) return;
    // 선반 밖 표지: 갈피 탭은 선반에서 갈피 수를 보여 주는 표시라 빼고 그린다(지금 앱 noRibbon)
    final look = lookOf(book);
    drawBook(canvas, slots, cam, px, _openRoom, b, look.lightAlbedo, const {}, emptyImage, seedOf(b.id), look: look, glyphs: glyphs, photo: photo);
  }

  @override
  bool shouldRepaint(_BookPainter old) => old.b != b || old.book != book || old.photo != photo || old.px.s != px.s;
}

/// 표지 사진(있으면) 받기
mixin _CoverPhotoLoad<T extends StatefulWidget> on State<T> {
  CoverPhoto? photo;
  bool _ready = ShelfPainter.ready;

  void loadPhoto(String? uri) {
    if (!_ready) {
      ShelfPainter.load().then((_) {
        if (mounted) setState(() => _ready = true);
      });
    }
    photo = null;
    if (uri == null) return;
    loadCover(uri).then((img) async {
      if (img == null || !mounted) return;
      final p = await CoverPhoto.of(img);
      if (mounted) setState(() => photo = p);
    });
  }
}

/// 선반 밖의 책 한 권(크기 = 투영 외곽 + 여백)
class StandaloneBook extends StatefulWidget {
  const StandaloneBook({super.key, required this.book, this.pose = Pose.front, required this.scale});
  final Book book;
  final Pose pose;
  final double scale;

  @override
  State<StandaloneBook> createState() => _StandaloneBookState();
}

class _StandaloneBookState extends State<StandaloneBook> with _CoverPhotoLoad {
  @override
  void initState() {
    super.initState();
    loadPhoto(widget.book.coverArtUri);
  }

  @override
  void didUpdateWidget(StandaloneBook old) {
    super.didUpdateWidget(old);
    if (old.book.coverArtUri != widget.book.coverArtUri) loadPhoto(widget.book.coverArtUri);
  }

  @override
  Widget build(BuildContext context) {
    final rest = _rest(widget.book, widget.pose);
    final cam = Cam.centeredAt(viewPitchMin, rest.t.x + boxSize(widget.book, widget.pose).w / 2);
    final bb = _bbox(cam, rest);
    final s = widget.scale;
    return SizedBox(
      width: (bb.width + bookPad * 2) * s,
      height: (bb.height + bookPad * 2) * s,
      child: CustomPaint(painter: _BookPainter(widget.book, rest, cam, Affine(s, (bookPad - bb.left) * s, (bookPad - bb.top) * s), photo)),
    );
  }
}

/// 손가락으로 좌우로 돌려 보는 책 한 권(장정 편집 미리보기). frontWidth: 정면 폭(dp)
class RotatableBook extends StatefulWidget {
  const RotatableBook({super.key, required this.book, required this.frontWidth, this.initialSpin = 30, this.shadow = false});
  final Book book;
  final double frontWidth;
  final double initialSpin;
  final bool shadow;

  @override
  State<RotatableBook> createState() => _RotatableBookState();
}

class _RotatableBookState extends State<RotatableBook> with _CoverPhotoLoad {
  static const _spinMin = -70.0, _spinMax = 95.0;
  late double _spin = widget.initialSpin;

  @override
  void initState() {
    super.initState();
    loadPhoto(widget.book.coverArtUri);
  }

  @override
  void didUpdateWidget(RotatableBook old) {
    super.didUpdateWidget(old);
    if (old.book.coverArtUri != widget.book.coverArtUri) loadPhoto(widget.book.coverArtUri);
  }

  @override
  Widget build(BuildContext context) {
    final rest = _rest(widget.book, Pose.front);
    final cam = Cam.centeredAt(viewPitchMin, rest.t.x + boxSize(widget.book, Pose.front).w / 2);
    final bb = _bbox(cam, rest);
    final s = widget.frontWidth / bb.width;
    // 어느 각도에서도 잘리지 않게 넉넉히(가로 1.5배, 세로 1.14배)
    final w = bb.width * 1.5 + bookPad * 2, h = bb.height * 1.14 + bookPad * 2;
    final px = Affine(s, (w / 2 - (bb.left + bb.width / 2)) * s, (h / 2 - (bb.top + bb.height / 2)) * s);
    return Semantics(
      label: '${widget.book.title} 장정 미리보기, 좌우로 끌어 돌려 볼 수 있어요',
      child: GestureDetector(
        onHorizontalDragUpdate: (d) => setState(() => _spin = math.max(_spinMin, math.min(_spinMax, _spin + d.delta.dx * 0.45))),
        child: SizedBox(
          width: w * s,
          height: h * s,
          child: Stack(children: [
            // 바닥 그림자: 책 아래 끝에 넓고 옅게 번지는 그림자(시안의 놓인 책)
            if (widget.shadow)
              Positioned(
                left: (w / 2 - bb.width * 0.45) * s,
                width: bb.width * 0.9 * s,
                top: (h / 2 + bb.height / 2) * s - 10,
                height: 12,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: const Color(0x1A543C28),
                    borderRadius: BorderRadius.circular(999),
                    boxShadow: [cssShadow(const Color(0x42543C28), 6, 2, 16)],
                  ),
                ),
              ),
            Positioned.fill(child: CustomPaint(painter: _BookPainter(widget.book, _spun(rest, _spin), cam, px, photo))),
          ]),
        ),
      ),
    );
  }
}
