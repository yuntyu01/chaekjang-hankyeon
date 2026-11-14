// 스토어 미리보기(지금 앱 features/store/SkinPreview.tsx): 홈 책장과 같은 그림(빛·재질·카메라)으로 선반 한 칸에 예시 책 두 권을 세운다:
// 린넨 책등 '데미안'과 그림 표지 '느린 계절'(새 서재 예시 책장과 같은 책, domain/reference_home), 판 112·142DU. 스킨을 고르면 그 스킨 값으로 다시 굽는다.
// 예시 책은 실제 표지가 없어 책 측면 모양은 미리보기에 보이지 않는다(지금 앱과 같다: 안내 문구)
library;

import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../domain/book3_physics.dart' show fromPlaced;
import '../../domain/layout.dart';
import '../../domain/shelf_scene.dart' show computeShelf;
import '../../domain/shelf_row.dart';
import '../../domain/reference_home.dart' show referenceBooks;
import '../../domain/types.dart';
import '../../scene_config/skin.dart';
import '../../scene_config/spine_look.dart';
import '../../store/placement_store.dart';
import '../../ui/bake.dart';
import '../../ui/cover_photo.dart';
import '../../ui/metrics.dart';
import '../../ui/row_bake.dart';
import '../../ui/scene.dart' show shelfCastExtent;
import '../home/home_screen.dart' show ShelfPainter;

const _shelfId = 'store~shelf';

/// 판 위 벽(머리 쪽) 높이: 구멍 위 끝(천장)이 보이게
const _top = 26.0;

/// 미리보기 높이(폭에 따라): 판 아래로는 구멍 아래 테까지(판 그림자 절반)
double skinPreviewHeight(double width) {
  final m = makeMetrics(width);
  final r = computeRows(1, m.scale).first;
  return _top + r.top + r.height + shelfCastExtent * 0.5 * m.scale;
}

/// 미리보기에 세울 두 권(지금 앱 PICKS: b02 책등 112, b04 표지 142). 예시 책을 못 읽었으면 내 책장의 책등·표지 한 권씩
({List<BookPlacement> picks, Map<String, Book> books}) _picks(ShelfLayout l, Map<String, Book> mine) {
  const want = [('home-reference-b02', Pose.upright, 112.0), ('home-reference-b04', Pose.front, 142.0)];
  if (want.every((w) => referenceBooks.containsKey(w.$1))) {
    return (
      picks: [for (final (i, w) in want.indexed) BookPlacement(bookId: w.$1, shelfId: _shelfId, order: i, pose: w.$2, tilt: 0, pos: w.$3)],
      books: {for (final w in want) w.$1: referenceBooks[w.$1]!},
    );
  }
  final spine = [for (final p in l.placements) if (p.pose == Pose.upright && p.stackId == null) p.bookId];
  final front = [for (final p in l.placements) if (p.pose == Pose.front && p.stackId == null) p.bookId];
  final ids = [if (spine.isNotEmpty) spine.first, if (front.isNotEmpty) front.first else if (spine.length > 1) spine[1]];
  return (
    picks: [
      for (final (i, id) in ids.indexed)
        BookPlacement(bookId: id, shelfId: _shelfId, order: i, pose: i == 1 && front.isNotEmpty ? Pose.front : Pose.upright, tilt: 0, pos: i == 0 ? 112 : 142),
    ],
    books: mine,
  );
}

class SkinPreview extends StatefulWidget {
  const SkinPreview({super.key, required this.width, required this.skin});
  final double width;

  /// 그리는 스킨(바뀌면 다시 굽는다)
  final SkinChoice skin;

  @override
  State<SkinPreview> createState() => _SkinPreviewState();
}

class _SkinPreviewState extends State<SkinPreview> {
  RowCase? _row;
  BakedRow? _baked;
  Map<String, CoverPhoto> _photos = const {};
  Map<String, Book> _books = const {};
  var _token = 0;

  @override
  void initState() {
    super.initState();
    spineLook.addListener(_spineChanged);
    _bake();
  }

  /// 책등 모양을 고르면 그 모양으로 표지 사진을 다시 준비한다(실물 측면이면 책등 사진도)
  Future<void> _spineChanged() async {
    final r = _row;
    if (r == null) return;
    final photos = <String, CoverPhoto>{};
    for (final id in [for (final b in r.books) b.id]) {
      final uri = _books[id]?.coverArtUri;
      if (uri == null) continue;
      final p = await loadCoverPhoto(uri);
      if (p != null) photos[uri] = p;
    }
    if (mounted) setState(() => _photos = photos);
  }

  @override
  void didUpdateWidget(SkinPreview old) {
    super.didUpdateWidget(old);
    if (old.skin != widget.skin) _bake();
  }

  @override
  void dispose() {
    spineLook.removeListener(_spineChanged);
    _baked?.image.dispose();
    super.dispose();
  }

  Future<void> _bake() async {
    final token = ++_token;
    final s = PlacementStore.instance;
    await s.ensure();
    final pick = _picks(s.layout!, s.books);
    _books = pick.books;
    final layout = ShelfLayout([const Shelf(_shelfId, 0)], pick.picks);
    final books = [for (final p in layout.placements) pick.books[p.bookId]!];
    final bodies = [for (final f in computeShelf(layout, pick.books, _shelfId)) fromPlaced(f.box)];
    final row = rowFromBooks(bodies, books, rowSpace, top: true, last: true);
    await ShelfPainter.load();
    final grid = ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/grid.frag'), gridUniformNames);
    final bake = ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/bake.frag'), bakeUniformNames);
    final baked = await bakeRow(grid, bake, BakeCase([row]), row, tag: ' store', wanted: () => mounted && token == _token);
    if (baked == null) return;
    final photos = <String, CoverPhoto>{..._photos};
    for (final b in books) {
      final uri = b.coverArtUri;
      if (uri == null || photos.containsKey(uri)) continue;
      final p = await loadCoverPhoto(uri);
      if (p != null) photos[uri] = p;
    }
    if (!mounted || token != _token) {
      baked.image.dispose();
      return;
    }
    setState(() {
      _baked?.image.dispose();
      _baked = baked;
      _row = row;
      _photos = photos;
    });
  }

  @override
  Widget build(BuildContext context) {
    final h = skinPreviewHeight(widget.width);
    final b = _baked, r = _row;
    return SizedBox(
      width: widget.width,
      height: h,
      child: b == null || r == null
          ? null
          : CustomPaint(
              painter: ShelfPainter(
                rows: [r],
                atlases: [b.image],
                rowSpots: [b.at],
                spaces: [r.space],
                keys: [b.keys],
                bookKeys: [b.bookKeys],
                photos: _photos,
                contentTop: _top,
                // 줄은 위에 붙인다(홈처럼 화면 가운데로 내리지 않는다: 높이를 이 줄에 맞춰 두었다)
                viewport: h,
                bottomInset: h,
              ),
            ),
    );
  }
}
