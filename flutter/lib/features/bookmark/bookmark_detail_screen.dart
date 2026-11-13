// 갈피 보기(지금 앱 app/bookmark/[id].tsx): 같은 책의 갈피를 좌우로 넘기며 읽는다. 카드는 길면 세로로 스크롤.
// 아래 막대: 책장 한켠 · 수정 · 공유. 오른쪽 위 더 보기: 수정 · 메모 포함해 공유 · 갈피 색 · 연결된 책 열기 · 삭제.
// 공유는 화면 밖에 그린 같은 카드를 그림으로 떠서 공유창으로 보낸다(개인 메모는 기본 제외).
// (지금 앱의 문장 공유 두 모양 '책 페이지·종이 메모'는 공유 그림을 옮길 때 함께 넣는다)
library;

import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../domain/color.dart';
import '../../domain/library.dart';
import '../../services/photos.dart';
import '../../store/files.dart';
import '../../store/library_model.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../book/book_screen.dart';
import '../book/labels.dart';
import 'bookmark_card.dart';
import 'photo_plate.dart';
import 'ribbon_color_sheet.dart';

BookmarkCardData? cardData(Library lib, Bookmark m) {
  final b = lib.books[m.myBookId];
  final e = b == null ? null : lib.editions[b.editionId];
  if (e == null) return null;
  return BookmarkCardData(
    text: m.text,
    title: e.title,
    author: e.authors.isEmpty ? null : e.authors.join(', '),
    page: m.page,
    date: ymd(m.createdAt),
    memo: m.memo,
    color: ribbonOf(lib, b!.id),
    coverUri: e.coverUri,
    bookId: b.id,
    bookColor: themeColorOf(lib, b.id),
    photoUri: m.photoUri,
    photoRatio: m.photoRatio,
  );
}

const _shareW = 380.0;

Future<void> openBookmark(BuildContext context, String id) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/bookmark'), builder: (_) => BookmarkDetailScreen(id: id)));

/// 넘김 점(지금 앱 PageDots): 지금 칸은 크고 진하게, 나머지는 같은 색을 옅게. 많으면 지금 칸 둘레 max개만
class PageDots extends StatelessWidget {
  const PageDots({super.key, required this.count, required this.index, required this.color, this.max = 7, this.gap = 8});
  final int count, index, max;
  final Color color;
  final double gap;

  @override
  Widget build(BuildContext context) {
    final from = count <= max ? 0 : math.max(0, math.min(count - max, index - max ~/ 2));
    final to = count <= max ? count : from + max;
    return ExcludeSemantics(
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        for (var i = from; i < to; i++) ...[
          if (i > from) SizedBox(width: gap),
          Container(
            width: i == index ? 10 : 7,
            height: i == index ? 10 : 7,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: i == index ? 1 : 0.32)),
          ),
        ],
      ]),
    );
  }
}

class BookmarkDetailScreen extends StatefulWidget {
  const BookmarkDetailScreen({super.key, required this.id});
  final String id;

  @override
  State<BookmarkDetailScreen> createState() => _BookmarkDetailScreenState();
}

class _BookmarkDetailScreenState extends State<BookmarkDetailScreen> {
  final _model = LibraryModel.instance;
  String? _bookId;
  int _index = 0;
  PageController? _pages;
  Bookmark? _editing;
  bool _busy = false;
  ({bool withMemo, BookmarkCardData data, String seed})? _share;
  final _shot = GlobalKey();

  @override
  void initState() {
    super.initState();
    _model.addListener(_changed);
    _model.load().then((_) {
      if (!mounted) return;
      // 넘기는 목록은 처음 연 갈피의 책 기준(연 갈피를 지워도 같은 책의 다른 갈피가 남는다)
      _bookId = _model.lib.bookmarks[widget.id]?.myBookId;
      final list = _list();
      _index = math.max(0, list.indexWhere((m) => m.id == widget.id));
      _pages = PageController(initialPage: _index);
      setState(() {});
    });
  }

  @override
  void dispose() {
    _model.removeListener(_changed);
    _pages?.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  List<Bookmark> _list() => _bookId == null ? const [] : bookmarksOf(_model.lib, _bookId!).reversed.toList();

  // 화면 밖에 그린 같은 카드를 그림으로 떠서 공유
  Future<void> _shoot(bool withMemo, Bookmark cur, BookmarkCardData data) async {
    if (_busy) return;
    final dpr = MediaQuery.devicePixelRatioOf(context);
    setState(() {
      _busy = true;
      _share = (withMemo: withMemo, data: data, seed: cur.id);
    });
    var imageReady = false;
    try {
      await Future<void>.delayed(const Duration(milliseconds: 900)); // 표지·사진이 그려지기를 기다린다
      final boundary = _shot.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) throw StateError('카드 이미지를 뜨지 못했어요');
      final img = await boundary.toImage(pixelRatio: dpr);
      final png = await img.toByteData(format: ui.ImageByteFormat.png);
      img.dispose();
      if (png == null) throw StateError('카드 이미지를 뜨지 못했어요');
      final dir = await getTemporaryDirectory();
      final f = File('${dir.path}/gallpi_${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}.png');
      await f.writeAsBytes(png.buffer.asUint8List());
      imageReady = true;
      await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: 'image/png')], title: '갈피 공유'));
    } catch (e) {
      if (mounted) appAlert(context, imageReady ? '공유 창을 열지 못했어요' : '공유 이미지를 만들지 못했어요', '$e');
    } finally {
      if (mounted) {
        setState(() {
          _share = null;
          _busy = false;
        });
      }
    }
  }

  void _menu(Bookmark cur, BookmarkCardData data, List<Bookmark> list) => showSheet<void>(
        context,
        builder: (ctx) => ListGroup(children: [
          ListItem(label: '수정', onPress: () {
            Navigator.pop(ctx);
            setState(() => _editing = cur);
          }),
          if (cur.memo != null && cur.memo!.isNotEmpty)
            ListItem(label: '메모 포함해 공유', onPress: () {
              Navigator.pop(ctx);
              _shoot(true, cur, data);
            }),
          ListItem(label: '갈피 색 바꾸기', onPress: () {
            Navigator.pop(ctx);
            showRibbonColorSheet(context, cur.myBookId);
          }),
          ListItem(label: '연결된 책 열기', onPress: () {
            Navigator.pop(ctx);
            openBook(context, cur.myBookId);
          }),
          ListItem(
            label: '삭제',
            danger: true,
            onPress: () {
              Navigator.pop(ctx);
              appAlert(context, '갈피를 삭제할까요?', '되돌릴 수 없어요.', [
                const AlertButton('취소', style: AlertStyle.cancel),
                AlertButton('삭제', style: AlertStyle.destructive, onPress: () async {
                  await _model.deleteBookmark(cur.id);
                  if (!mounted) return;
                  if (list.length <= 1) {
                    Navigator.of(context).maybePop();
                    return;
                  }
                  // 지운 자리의 다음 갈피(마지막이었으면 앞 갈피)로
                  final next = math.min(_index, list.length - 2);
                  setState(() => _index = next);
                  _pages?.jumpToPage(next);
                }),
              ]);
            },
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final lib = _model.lib;
    final list = _list();
    if (!_model.loaded || _pages == null) return const Screen(children: [Loading()]);
    if (list.isEmpty) return const Screen(title: '갈피', children: [Empty(title: '갈피를 찾을 수 없어요')]);
    final cur = list[math.min(_index, list.length - 1)];
    if (_editing != null) return _EditBookmark(m: _editing!, onDone: () => setState(() => _editing = null));
    final curData = cardData(lib, cur);
    final size = MediaQuery.sizeOf(context);
    final insets = MediaQuery.paddingOf(context);
    final scale = MediaQuery.textScalerOf(context).scale(10) / 10;
    // 넘김 점은 이 책의 갈피 색
    final dot = hexColor(tabColors(curData?.color, cur.myBookId).$1);
    final hair = 2 / MediaQuery.devicePixelRatioOf(context);
    return PopScope(
      canPop: true,
      child: Material(
        color: AppColors.bg,
        child: Padding(
          padding: EdgeInsets.only(top: insets.top),
          child: Stack(children: [
            // 공유 이미지용(화면 뒤에 같은 카드)
            if (_share != null)
              Positioned(
                left: 0,
                top: 0,
                child: IgnorePointer(
                  child: Opacity(
                    opacity: 0.01,
                    child: RepaintBoundary(
                      key: _shot,
                      child: Container(
                        width: _shareW,
                        color: AppColors.bg,
                        padding: const EdgeInsets.only(top: 24, bottom: 30),
                        child: Column(children: [
                          BookmarkCard(data: _share!.data, showMemo: _share!.withMemo, width: _shareW, seed: _share!.seed),
                          const Padding(padding: EdgeInsets.only(top: 4), child: Text('책장 한켠', style: TextStyle(fontFamily: AppFonts.serif, fontSize: 15, color: Color(0xFF68524A)))),
                        ]),
                      ),
                    ),
                  ),
                ),
              ),
            Positioned.fill(
              child: Container(
                color: AppColors.bg,
                child: Column(children: [
                  SizedBox(
                    height: 60,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4, left: 8, right: 8),
                      child: Row(children: [
                        IconBtn(label: '뒤로', onPress: () => Navigator.of(context).maybePop(), child: const LucideIcon('ChevronLeft', size: 28)),
                        Expanded(child: Center(child: Semantics(header: true, child: Text('갈피', style: AppType.title)))),
                        IconBtn(label: '더 보기', onPress: curData == null ? () {} : () => _menu(cur, curData, list), child: const LucideIcon('MoreHorizontal')),
                      ]),
                    ),
                  ),
                  Expanded(
                    child: PageView.builder(
                      controller: _pages,
                      itemCount: list.length,
                      onPageChanged: (i) => setState(() => _index = i),
                      itemBuilder: (context, i) {
                        final d = cardData(lib, list[i]);
                        return SingleChildScrollView(
                          padding: EdgeInsets.only(top: scale > 1.2 ? 18 : math.max(24, math.min(62, size.height * 0.073 - 4)), bottom: 4),
                          child: Center(child: d == null ? const SizedBox.shrink() : BookmarkCard(data: d, showMemo: true, width: math.min(size.width, 440), seed: list[i].id)),
                        );
                      },
                    ),
                  ),
                  if (list.length > 1)
                    Padding(
                      padding: EdgeInsets.only(top: 6, bottom: size.height * 0.047),
                      child: Column(children: [
                        PageDots(count: list.length, index: _index, color: dot, max: 12, gap: 10),
                        const SizedBox(height: 12),
                        Text('${list.length}개의 갈피', style: AppType.caption),
                      ]),
                    ),
                  Padding(
                    padding: EdgeInsets.fromLTRB(Space.page, 12, Space.page, insets.bottom + size.height * 0.044),
                    child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 16, runSpacing: 16, children: [
                      Semantics(
                        label: '책장 한켠',
                        excludeSemantics: true,
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Container(height: hair, width: 20, color: AppColors.inkFaint),
                          const SizedBox(width: 12),
                          Text('책장 한켠', style: AppType.sub),
                        ]),
                      ),
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        Container(width: hair, height: 28, color: AppColors.line),
                        const SizedBox(width: 18),
                        _BarBtn(icon: 'PenLine', label: '수정', onPress: () => setState(() => _editing = cur)),
                        const SizedBox(width: 18),
                        _BarBtn(
                          icon: 'Share',
                          label: _busy ? '준비 중' : '공유',
                          busy: _busy,
                          onPress: _busy || curData == null ? null : () => _shoot(false, cur, curData),
                        ),
                      ]),
                    ]),
                  ),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _BarBtn extends StatelessWidget {
  const _BarBtn({required this.icon, required this.label, required this.onPress, this.busy = false});
  final String icon, label;
  final VoidCallback? onPress;
  final bool busy;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: busy ? '공유 준비 중' : label == '공유' ? '이미지로 공유' : label,
        onTap: onPress,
        excludeSemantics: true,
        child: Pressable(
          onPress: onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Space.touch),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                busy
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent))
                    : LucideIcon(icon),
                const SizedBox(width: 6),
                Text(label, style: AppType.sub.copyWith(color: AppColors.ink)),
              ]),
            ),
          ),
        ),
      );
}

/// 갈피 수정: 같은 화면 안의 단계라 뒤로는 갈피 보기로 돌아온다
class _EditBookmark extends StatefulWidget {
  const _EditBookmark({required this.m, required this.onDone});
  final Bookmark m;
  final VoidCallback onDone;

  @override
  State<_EditBookmark> createState() => _EditBookmarkState();
}

class _EditBookmarkState extends State<_EditBookmark> {
  late String _text = widget.m.text, _page = widget.m.page != null ? '${widget.m.page}' : '', _memo = widget.m.memo ?? '';
  late ({String? uri, num? ratio, bool changed}) _photo = (uri: widget.m.photoUri, ratio: widget.m.photoRatio, changed: false);
  String? _msg;
  bool _saving = false;

  Future<void> _swap(String from) async {
    final r = await pickPhoto(from, crop: true);
    if (!mounted) return;
    switch (r) {
      case PhotoOk(:final uri, :final width, :final height):
        setState(() {
          _photo = (uri: uri, ratio: width != null && height != null && height > 0 ? width / height : null, changed: true);
          _msg = null;
        });
      case PhotoFail(:final reason):
        if (reason == 'denied') setState(() => _msg = deniedMessage(from));
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final n = num.tryParse(_page);
      var photoUri = _photo.uri;
      if (_photo.changed) photoUri = _photo.uri != null ? await keepImage(_photo.uri!, 'page') : null;
      await LibraryModel.instance.updateBookmark(
        widget.m.id,
        text: _text.trim(),
        page: n != null && n > 0 ? n.round() : null,
        memo: _memo.trim().isEmpty ? null : _memo.trim(),
        photoUri: photoUri,
        photoRatio: photoUri != null ? _photo.ratio : null,
      );
      widget.onDone();
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      appAlert(context, '저장하지 못했어요', '사진을 옮기지 못했어요. 다시 눌러 주세요.\n$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final lib = LibraryModel.instance.lib;
    final ed = lib.editions[lib.books[widget.m.myBookId]?.editionId ?? ''];
    final bookLine = ed == null ? '' : [ed.title, if (ed.authors.isNotEmpty) ed.authors.join(', ')].join(' · ');
    final isPhoto = _photo.uri != null;
    final width = MediaQuery.sizeOf(context).width;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) widget.onDone();
      },
      child: Screen(
        title: isPhoto ? '사진 갈피 수정' : '갈피 수정',
        footer: Btn(label: '저장', busy: _saving, disabled: _text.trim().isEmpty && _photo.uri == null, onPress: _save),
        children: [
          if (bookLine.isNotEmpty) Padding(padding: const EdgeInsets.only(top: Space.page), child: Text(bookLine, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub)),
          if (_photo.uri != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Space.group + 8),
              child: Column(children: [
                PhotoPlate(uri: _photo.uri!, ratio: _photo.ratio, width: math.min(300, width - Space.page * 2), seed: widget.m.id),
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Wrap(spacing: Space.s, children: [
                    AppChip(label: '다시 찍기', onPress: () => _swap('camera')),
                    AppChip(label: '다른 사진', onPress: () => _swap('library')),
                    if (_text.trim().isNotEmpty) AppChip(label: '사진 빼기', onPress: () => setState(() => _photo = (uri: null, ratio: null, changed: true))),
                  ]),
                ),
                if (_msg != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg!, style: AppType.sub)),
              ]),
            )
          else
            const SizedBox(height: Space.group + 2),
          Field(
            label: isPhoto ? '옮겨 적기 (선택)' : '문장 (줄바꿈으로 문단을 나눠요)',
            value: _text,
            multiline: true,
            minHeight: isPhoto ? 120 : 190,
            onChange: (v) => setState(() => _text = v),
          ),
          Field(label: '쪽수 (선택)', unit: '쪽', number: true, value: _page, onChange: (v) => _page = v),
          Field(label: '한 줄 메모 (선택, 공유 이미지에는 기본으로 빠져요)', value: _memo, multiline: true, minHeight: 80, onChange: (v) => _memo = v),
        ],
      ),
    );
  }
}
