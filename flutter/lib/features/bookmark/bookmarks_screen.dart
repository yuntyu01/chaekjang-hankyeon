// 갈피 탭(지금 앱 app/(tabs)/bookmarks.tsx): 머리줄 검색·추가, 밑줄 탭 '전체 갈피 | 아껴둔'과 필터 아이콘, 그 아래 '갈피 N개'·'보드로 보기'.
// 책(책 선택 시트: 내 책 검색·표지·갈피 수·체크)·유형(문장·사진)은 필터 시트에. 보드는 책 한 권씩이라 고른 책이 없으면 책부터 고른다
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/app_nav.dart';
import '../../domain/library.dart';
import '../../store/library_model.dart';
import '../../store/mini_timer_store.dart';
import '../../store/reading_store.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../book/labels.dart';
import '../stats/stats_widgets.dart';
import 'board_screen.dart' show openBookmarkBoard;
import 'bookmark_card.dart';
import 'bookmark_detail_screen.dart';
import 'bookmark_empty.dart';
import 'new_bookmark_screen.dart';

enum _Kind { all, text, photo }

const _kindLabel = {_Kind.all: '모든 유형', _Kind.text: '문장 갈피', _Kind.photo: '사진 갈피'};
const _views = [(id: 'all', label: '전체 갈피'), (id: 'saved', label: '아껴둔')];

class BookmarksScreen extends StatefulWidget {
  const BookmarksScreen({super.key, this.initialBook});
  final String? initialBook;

  @override
  State<BookmarksScreen> createState() => _BookmarksScreenState();
}

class _BookmarksScreenState extends State<BookmarksScreen> {
  final _model = LibraryModel.instance;
  String _q = '';
  bool _searching = false;
  String _view = 'all';
  String? _book;
  _Kind _kind = _Kind.all;

  @override
  void initState() {
    super.initState();
    _book = AppNav.instance.bookmarkBook ?? widget.initialBook;
    AppNav.instance.bookmarkBook = null;
    AppNav.instance.addListener(_nav);
    _model.addListener(_changed);
    ReadingStore.instance.addListener(_changed);
    _model.load();
  }

  @override
  void dispose() {
    _model.removeListener(_changed);
    ReadingStore.instance.removeListener(_changed);
    AppNav.instance.removeListener(_nav);
    super.dispose();
  }

  // 보드 '목록 보기': 그 책 갈피만 보이게
  void _nav() {
    final book = AppNav.instance.bookmarkBook;
    if (book == null || !mounted) return;
    AppNav.instance.bookmarkBook = null;
    setState(() => _book = book);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Library get _lib => _model.lib;

  /// 책 있는 갈피(최근 순)
  List<Bookmark> get _all {
    final list = [for (final m in _lib.bookmarks.values) if (_lib.books[m.myBookId] != null) m];
    // 지금 앱 sort는 안정 정렬
    final indexed = [for (final (i, m) in list.indexed) (i, m)]..sort((a, b) {
        final c = b.$2.createdAt.compareTo(a.$2.createdAt);
        return c != 0 ? c : a.$1.compareTo(b.$1);
      });
    return [for (final x in indexed) x.$2];
  }

  /// 갈피가 있는 책(갈피 수와 함께, 최근 갈피 순)
  List<({String id, int count, String title})> _booksOf(List<Bookmark> all) {
    final n = <String, int>{};
    for (final m in all) {
      n[m.myBookId] = (n[m.myBookId] ?? 0) + 1;
    }
    return [for (final e in n.entries) (id: e.key, count: e.value, title: _lib.editions[_lib.books[e.key]!.editionId]?.title ?? '제목 없음')];
  }

  void _toggleSaved(String id) {
    _model.toggleSaved(id).catchError((_) {
      if (mounted) {
        showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('갈피 표시를 저장하지 못했어요'),
            content: const Text('잠시 후 다시 눌러 주세요.'),
            actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('확인'))],
          ),
        );
      }
    });
  }

  Future<void> _openFilter() => showSheet<void>(
        context,
        title: '필터',
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, set) {
            final books = _booksOf(_all);
            final title = _book == null ? null : books.where((x) => x.id == _book).firstOrNull?.title ?? _lib.editions[_lib.books[_book]?.editionId ?? '']?.title;
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
              FilterGroup(title: '책', first: true, children: [
                FilterOption(
                  label: title ?? '모든 책',
                  chevron: true,
                  onPress: () {
                    Navigator.pop(ctx);
                    _openBooks(board: false);
                  },
                ),
              ]),
              FilterGroup(title: '유형', children: [
                for (final k in _Kind.values)
                  FilterOption(
                    label: _kindLabel[k]!,
                    selected: _kind == k,
                    onPress: () {
                      setState(() => _kind = k);
                      set(() {});
                    },
                  ),
              ]),
            ]);
          },
        ),
      );

  Future<void> _openBooks({required bool board}) {
    var bookQ = '';
    return showSheet<void>(
      context,
      title: board ? '보드로 볼 책' : '책 선택',
      scroll: true,
      maxHeight: 0.8,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) {
          final all = _all;
          final books = _booksOf(all);
          final shown = books.where((x) => bookQ.trim().isEmpty || x.title.contains(bookQ.trim()));
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            if (books.length > 5)
              Padding(
                padding: const EdgeInsets.only(bottom: Space.tight),
                child: SearchField(value: bookQ, onChange: (v) => set(() => bookQ = v), placeholder: '내 책 검색', label: '갈피를 볼 책 찾기'),
              ),
            if (!board)
              _BookChoice(
                label: '모든 책',
                sub: '갈피 ${all.length}개',
                on: _book == null,
                onPress: () {
                  setState(() => _book = null);
                  Navigator.pop(ctx);
                },
              ),
            for (final x in shown)
              _BookChoice(
                label: x.title,
                sub: '갈피 ${x.count}개',
                on: !board && _book == x.id,
                cover: LinkedCover(lib: _lib, id: x.id, width: 40),
                onPress: () {
                  Navigator.pop(ctx);
                  if (board) {
                    openBookmarkBoard(context, x.id);
                  } else {
                    setState(() => _book = x.id);
                  }
                },
              ),
          ]);
        },
      ),
    );
  }

  void _openBoard(List<({String id, int count, String title})> books) {
    final only = _book ?? (books.length == 1 ? books.first.id : null);
    if (only != null) {
      openBookmarkBoard(context, only);
    } else {
      _openBooks(board: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    // 지금 앱 갈피 목록 아래 여백 = TAB_CONTENT_PAD(+ 작은 타이머). 기기 아래 안전 영역은 더하지 않는다
    final bottomPad = TabBarStyle.contentPad + (ReadingStore.instance.active != null ? miniTimerSpace : 0);
    if (!_model.loaded) return const Screen(title: '갈피', back: false, scroll: false, children: []);
    final all = _all;
    if (all.isEmpty) {
      return Screen(title: '갈피', back: false, scroll: false, children: [
        Expanded(child: BookmarkEmpty(onAdd: () => openNewBookmark(context))),
      ]);
    }
    final books = _booksOf(all);
    final saved = _model.savedIds.toSet();
    final q = _q.trim();
    final list = [
      for (final m in all)
        if ((_book == null || m.myBookId == _book) &&
            (_view != 'saved' || saved.contains(m.id)) &&
            (_kind != _Kind.photo || (m.photoUri ?? '').isNotEmpty) &&
            (_kind != _Kind.text || m.text.trim().isNotEmpty) &&
            (q.isEmpty || m.text.contains(q) || (m.memo ?? '').contains(q)))
          m,
    ];
    final plain = _view == 'saved' && _q.isEmpty && _book == null && _kind == _Kind.all;
    final emptyTitle = plain ? '아껴둔 갈피가 없어요' : _kind == _Kind.photo && _q.isEmpty ? '사진 갈피가 없어요' : '맞는 갈피가 없어요';
    final emptyBody = plain
        ? '갈피 오른쪽 아래의 표시를 눌러 모아 보세요.'
        : _kind == _Kind.photo && _q.isEmpty
            ? '페이지를 찍어 그대로 붙여 두세요.'
            : q.isNotEmpty
                ? '다른 낱말로 찾아보세요.'
                : '다른 책이나 유형을 골라 보세요.';
    final cardW = math.min(MediaQuery.sizeOf(context).width - Space.page * 2, contentMax);
    return Screen(
      title: '갈피',
      back: false,
      scroll: false,
      right: Row(mainAxisSize: MainAxisSize.min, children: [
        IconBtn(
          label: _searching ? '갈피 검색 닫기' : '갈피 검색',
          onPress: () => setState(() {
            if (_searching) _q = '';
            _searching = !_searching;
          }),
          child: LucideIcon(_searching ? 'X' : 'Search'),
        ),
        const SizedBox(width: 4),
        IconBtn(label: '갈피 추가', onPress: () => openNewBookmark(context, book: _book, photoOnly: _kind == _Kind.photo), child: const LucideIcon('Plus')),
      ]),
      children: [
        if (_searching)
          Padding(
            padding: const EdgeInsets.only(top: Space.tight, bottom: Space.item),
            child: SearchField(value: _q, onChange: (v) => setState(() => _q = v), autofocus: true, placeholder: '문장·메모에서 찾기', label: '갈피 검색어'),
          ),
        Padding(
          padding: const EdgeInsets.only(top: Space.xs),
          child: Row(children: [
            Expanded(child: Align(alignment: Alignment.centerLeft, child: Tabs<String>(items: _views, value: _view, onChange: (v) => setState(() => _view = v), gap: Space.xl))),
            FilterIcon(active: _book != null || _kind != _Kind.all, onPress: _openFilter),
          ]),
        ),
        // 탭과 첫 카드 사이. 지금 보이는 갈피 수
        Padding(
          padding: const EdgeInsets.only(top: 22, bottom: Space.xs),
          child: Row(children: [
            Expanded(child: Text('갈피 ${list.length}개', style: AppType.sub)),
            Semantics(
              button: true,
              label: '갈피 보드로 보기',
              child: Pressable(
                onPress: () => _openBoard(books),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text('보드로 보기', style: AppType.sub),
                  const SizedBox(width: 2),
                  const LucideIcon('ChevronRight', size: 16, color: AppColors.inkSoft),
                ]),
              ),
            ),
          ]),
        ),
        Expanded(
          child: OverflowBox(
            // 목록은 화면 좌우 여백 밖까지(카드 그림자·뒤 종이가 잘리지 않게)
            maxWidth: cardW + Space.page * 2,
            child: list.isEmpty
                ? ListView(padding: EdgeInsets.fromLTRB(Space.page, 0, Space.page, bottomPad), children: [Empty(title: emptyTitle, body: emptyBody)])
                : ListView.builder(
                    padding: EdgeInsets.fromLTRB(Space.page, 0, Space.page, bottomPad),
                    keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                    itemCount: list.length,
                    itemBuilder: (context, i) {
                      final m = list[i];
                      final b = _lib.books[m.myBookId]!;
                      final e = _lib.editions[b.editionId];
                      if (e == null) return const SizedBox.shrink();
                      return BookmarkCard(
                        key: ValueKey(m.id),
                        compact: true,
                        width: cardW,
                        seed: m.id,
                        onOpen: () => openBookmark(context, m.id),
                        saved: saved.contains(m.id),
                        onToggleSaved: () => _toggleSaved(m.id),
                        data: BookmarkCardData(
                          text: m.text,
                          title: e.title,
                          author: e.authors.join(', '),
                          page: m.page,
                          date: ymd(m.createdAt),
                          color: ribbonOf(_lib, b.id),
                          coverUri: e.coverUri,
                          bookId: b.id,
                          bookColor: themeColorOf(_lib, b.id),
                          photoUri: m.photoUri,
                          photoRatio: m.photoRatio,
                        ),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }
}

/// 책 선택 줄: 표지 · 이름(고르면 굵게) · 갈피 수 · 체크
class _BookChoice extends StatelessWidget {
  const _BookChoice({required this.label, required this.sub, required this.on, required this.onPress, this.cover});
  final String label, sub;
  final bool on;
  final VoidCallback onPress;
  final Widget? cover;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        selected: on,
        label: '$label, $sub',
        onTap: onPress,
        excludeSemantics: true,
        child: Pressable(
          onPress: onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 64),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(children: [
                if (cover != null) ...[SizedBox(width: 40, child: Center(child: IgnorePointer(child: cover))), const SizedBox(width: 14)],
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.row.copyWith(fontFamily: on ? AppType.label.fontFamily : null)),
                    Text(sub, style: AppType.caption),
                  ]),
                ),
                if (on) ...[const SizedBox(width: 14), const LucideIcon('Check', size: 20, color: AppColors.accent, stroke: 2.2)],
              ]),
            ),
          ),
        ),
      );
}
