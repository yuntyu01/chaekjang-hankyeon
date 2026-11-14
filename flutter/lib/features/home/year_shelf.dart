// 지난 연도 책장 한 쪽(지금 앱 features/home/YearShelf.tsx, 보기 전용): 그해 남긴 책장을 지금 책장과 같은 그림·카메라로 그린다.
// 저장된 모습 그대로(기대기를 다시 풀지 않는다), 한 번 구워 그림 한 장으로 굳힌다(끌기·꾸미기가 없어 다시 그릴 일이 없다).
// 책을 짧게 누르면 그해 기록(상태·한 줄 감상·그해까지의 최근 메모)으로 책 정보 시트를 연다. 숨긴 책은 '책 정보 보기'가 없다.
// 머리줄: 벽에 새긴 그해 숫자 가운데, 오른쪽 위 공유 아이콘 하나(보이는 책장을 그대로 찍어 보낸다)
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../../domain/bookcase.dart';
import '../../domain/book3.dart' show corners;
import '../../domain/camera.dart';
import '../../domain/place_books.dart';
import '../../domain/shelf_row.dart';
import '../../services/cover_cache.dart' show loadCover;
import '../../services/share_image.dart';
import '../../store/library_model.dart';
import '../../store/library_store.dart';
import '../../ui/alert.dart';
import '../../ui/bake.dart';
import '../../ui/book_key.dart';
import '../../ui/cover_photo.dart';
import '../../ui/engraved_year.dart';
import '../../ui/kit.dart' show LucideIcon;
import '../../ui/metrics.dart';
import '../../ui/plane_key.dart';
import '../../ui/row_bake.dart';
import '../../ui/scene.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart' show statusLabel;
import 'book_sheet.dart';
import 'home_screen.dart' show GlowPainter, ShelfPainter, homeHeaderHeight, navigationShelfReserve;

const _yearSize = 34.0; // 시안: 숫자 높이 약 24dp

ShaderSlots? _gridSlots, _bakeSlots;

class YearShelf extends StatefulWidget {
  const YearShelf({super.key, required this.bookcase, required this.active, this.headerOpacity = 1});
  final Bookcase bookcase;

  /// 지금 보이는 쪽(시트·누르기는 이때만)
  final bool active;

  /// 줄이면 머리글이 사라진다(모아 보기)
  final double headerOpacity;

  @override
  State<YearShelf> createState() => _YearShelfState();
}

class _YearShelfState extends State<YearShelf> {
  Library? _lib;
  BakeCase? _case;
  final _atlases = <ui.Image>[];
  final _spots = <List<Spot>>[];
  final _spaces = <double>[];
  final _keys = <({PlaneKey wall, PlaneKey floor})>[];
  List<Map<String, BookKey>> _bookKeys = const [];
  Map<String, CoverPhoto> _photos = const {};
  ui.Image? _image;
  Object? _imageKey;
  String? _sel;
  bool _shooting = false;
  final _shot = GlobalKey();
  ({ShelfMetrics m, List<RowGeom> geo, double top})? _geom;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final i in _atlases) {
      i.dispose();
    }
    _image?.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final lib = await loadYearShelf(widget.bookcase);
    final shelves = placeShelves(lib, frozen: true);
    final c = BakeCase([for (var i = 0; i < shelves.length; i++) rowFromBooks(shelves[i], lib.books, rowSpace, top: i == 0, last: i == shelves.length - 1)]);
    await ShelfPainter.load();
    _gridSlots ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/grid.frag'), gridUniformNames);
    _bakeSlots ??= ShaderSlots(await ui.FragmentProgram.fromAsset('shaders/bake.frag'), bakeUniformNames);
    final images = <ui.Image>[], spots = <List<Spot>>[], spaces = <double>[], keys = <({PlaneKey wall, PlaneKey floor})>[], bookKeys = <Map<String, BookKey>>[];
    for (final r in c.rows) {
      // 지금 책장과 같은 줄이면 담아 둔 그림을 쓴다(row_bake)
      final b = (await bakeRow(_gridSlots!, _bakeSlots!, c, r, stamp: true))!;
      images.add(b.image);
      spots.add(b.at);
      spaces.add(r.space);
      keys.add(b.keys);
      bookKeys.add(b.bookKeys);
    }
    if (!mounted) {
      for (final i in images) {
        i.dispose();
      }
      return;
    }
    setState(() {
      _lib = lib;
      _case = c;
      _atlases.addAll(images);
      _spots.addAll(spots);
      _spaces.addAll(spaces);
      _keys.addAll(keys);
      _bookKeys = bookKeys;
    });
    // 표지 사진: 받는 대로 다시 그린다(그 전까지는 코드로 그린 장정)
    for (final uri in {for (final b in lib.books) ?b.coverArtUri}) {
      loadCover(uri).then((img) async {
        if (img == null || !mounted) return;
        final p = await CoverPhoto.of(img);
        if (mounted) setState(() => _photos = {..._photos, uri: p});
      });
    }
  }

  /// 그린 책마다 화면 윤곽(콘텐츠 좌표)과 가장 앞 깊이(지금 책장과 같은 카메라·변환)
  Iterable<({String id, ui.Path path, double z})> _outlines([String? only]) sync* {
    final g = _geom, c = _case;
    if (g == null || c == null) return;
    final cam = Cam(viewPitchMin);
    for (var i = 0; i < g.geo.length && i < c.rows.length; i++) {
      final px = Affine(g.m.scale, g.m.originX + sideMargin * g.m.scale, g.top + g.geo[i].baseline);
      for (final b in c.rows[i].books) {
        if (only != null && b.id != only) continue;
        yield (id: b.id, path: bookOutline(cam, px, b), z: corners(b).map((v) => v.z).reduce(math.min));
      }
    }
  }

  Future<void> _tap(Offset p) async {
    if (!widget.active) return;
    String? best;
    var bestZ = double.infinity;
    for (final o in _outlines()) {
      if (o.z < bestZ && o.path.contains(p)) {
        bestZ = o.z;
        best = o.id;
      }
    }
    if (best == null) return;
    final model = LibraryModel.instance;
    await model.load();
    if (!mounted) return;
    // 그해 서재(그때 상태·한 줄 감상·그해까지의 메모)로 연다
    final view = bookcaseLibrary(model.lib, widget.bookcase);
    final mine = view.books[best];
    if (mine == null) return;
    setState(() => _sel = best);
    await showBookSheet(context, best, view: view, status: '${widget.bookcase.year}년 · ${statusLabel[mine.status]}', readOnly: true);
    if (mounted) setState(() => _sel = null);
  }

  // 공유: 보이는 책장을 그대로 찍어 보낸다(찍는 동안 아이콘은 숨긴다)
  Future<void> _share() async {
    setState(() {
      _sel = null;
      _shooting = true;
    });
    final dpr = MediaQuery.devicePixelRatioOf(context);
    try {
      await WidgetsBinding.instance.endOfFrame;
      final boundary = _shot.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) throw ShareImageError('image', '책장 그림을 뜨지 못했어요.');
      final img = await boundary.toImage(pixelRatio: dpr);
      final png = await pngOf(img);
      img.dispose();
      if (mounted) setState(() => _shooting = false);
      await sharePng(png, name: 'bookcase_${widget.bookcase.year}', title: '${widget.bookcase.year}년 책장');
    } catch (e) {
      if (mounted) appAlert(context, shareErrorTitle(e), '$e');
    } finally {
      if (mounted) setState(() => _shooting = false);
    }
  }

  Widget _shelf(Size size, double top, double bottomInset, double viewport, double dpr) {
    final c = _case!;
    final painter = ShelfPainter(
      rows: c.rows,
      atlases: _atlases,
      rowSpots: _spots,
      spaces: _spaces,
      photos: _photos,
      bookKeys: _bookKeys,
      keys: _keys,
      contentTop: top,
      bottomInset: bottomInset,
      viewport: viewport,
    );
    final w = (size.width * dpr).ceil(), h = (size.height * dpr).ceil();
    if (w > 8192 || h > 8192) return CustomPaint(painter: painter);
    // 한 번 그려 굳힌다(표지가 올 때만 다시)
    final key = (_photos, w, h);
    if (_image == null || _imageKey != key) {
      final rec = ui.PictureRecorder();
      painter.paint(Canvas(rec)..scale(dpr), size);
      final pic = rec.endRecording();
      final old = _image;
      _image = pic.toImageSync(w, h);
      _imageKey = key;
      pic.dispose();
      if (old != null) WidgetsBinding.instance.addPostFrameCallback((_) => old.dispose());
    }
    return RawImage(image: _image, width: size.width, height: size.height, scale: dpr, filterQuality: FilterQuality.none, fit: BoxFit.fill);
  }

  @override
  Widget build(BuildContext context) {
    final pad = MediaQuery.paddingOf(context);
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final year = widget.bookcase.year;
    final lib = _lib;
    final finished = lib == null ? 0 : _finishedIn(year);
    final header = Opacity(
      opacity: widget.headerOpacity,
      child: SizedBox(
        height: homeHeaderHeight,
        child: Stack(children: [
          // 벽에 새긴 그해 숫자(2026-11-10 사용자 '2026 같은 건 작년 책장에 파서'), 오른쪽 위는 공유 아이콘 하나
          Center(child: EngravedYear(label: '$year', size: _yearSize, header: true, a11yLabel: '$year년 책장, ${lib?.books.length ?? 0}권, 그해 완독 $finished권')),
          Positioned(
            right: TabHeader.paddingH - 11,
            top: 0,
            bottom: 0,
            child: Center(
              child: Opacity(
                opacity: _shooting ? 0 : 1,
                child: Semantics(
                  button: true,
                  label: '$year년 책장 공유',
                  onTap: _share,
                  excludeSemantics: true,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: _shooting ? null : _share,
                    child: const SizedBox(width: 48, height: 48, child: Center(child: LucideIcon('Share', size: 24, color: AppColors.iconSoft))),
                  ),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
    return RepaintBoundary(
      key: _shot,
      child: ColoredBox(
        color: AppColors.bg,
        child: ClipRect(
          clipper: _BelowTop(pad.top),
          child: LayoutBuilder(builder: (context, box) {
            final top = pad.top + homeHeaderHeight;
            final bottomInset = navigationShelfReserve + pad.bottom;
            final m = makeMetrics(box.maxWidth);
            final n = _case?.rows.length ?? 0;
            final geo = computeRows(n, m.scale, viewportHeight: box.maxHeight - top, bottomInset: bottomInset);
            final last = geo.isEmpty ? null : geo.last;
            final tail = math.max((shelfCastExtent + 8) * m.scale, pad.bottom + TabBarStyle.gap + TabBarStyle.height + TabBarStyle.fade * 0.6);
            final height = math.max(box.maxHeight, last == null ? 0.0 : top + last.top + last.height + tail);
            _geom = (m: m, geo: geo, top: top);
            final glow = _sel == null ? null : _outlines(_sel).firstOrNull?.path;
            return SingleChildScrollView(
              child: SizedBox(
                width: box.maxWidth,
                height: height,
                child: Stack(children: [
                  if (_case != null && _atlases.length == n && ShelfPainter.ready) Positioned.fill(child: _shelf(Size(box.maxWidth, height), top, bottomInset, box.maxHeight, dpr)),
                  if (glow != null) Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: GlowPainter(glow, m.scale)))),
                  Positioned.fill(child: GestureDetector(behavior: HitTestBehavior.translucent, onTapUp: (e) => _tap(e.localPosition))),
                  Positioned(left: 0, right: 0, top: pad.top, child: header),
                ]),
              ),
            );
          }),
        ),
      ),
    );
  }

  int _finishedIn(int year) {
    final full = LibraryModel.instance.lib;
    final view = bookcaseLibrary(full, widget.bookcase);
    final done = <String>{};
    for (final r in view.rounds.values) {
      if (r.finishedAt != null && r.finishedAt!.startsWith('$year')) done.add(r.myBookId);
    }
    return done.length;
  }
}

/// top 아래만 보이게 자른다(상태 표시줄 밑부터)
class _BelowTop extends CustomClipper<Rect> {
  const _BelowTop(this.top);
  final double top;

  @override
  Rect getClip(Size size) => Rect.fromLTRB(0, top, size.width, size.height);

  @override
  bool shouldReclip(_BelowTop old) => old.top != top;
}

