// 전체 책(지금 앱 app/books.tsx, 2026-11-05 사용자 시안): 등록한 모든 책을 보고 관리하는 곳(책장에 놓인 책도 여기 있다). 책장은 그중 골라 놓고 꾸미는 곳.
// 뒤로·검색·더하기, 밑줄 탭(읽기 상태), '책 N권'과 '책장에 진열'·필터·보기 전환. 정렬과 '책장에 없는 책'·완독한 해·숨긴 책은 필터 시트에.
// '책장에 진열'을 누르면 고르는 상태(이미 책장에 있는 책은 못 고른다), 아래 '선택한 N권 진열'. 책을 꾹 누르면 어떤 책이든 고르는 상태가 되고
// 아래에 '삭제'와 '진열'. 고른 책이 모두 연도 책장에 있으면 '삭제' 대신 '숨기기'(숨긴 책은 필터 › 숨긴 책 보기에서 되돌린다)
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/layout.dart' show placementOf;
import '../../domain/library.dart';
import '../../domain/types.dart' show Book;
import '../../services/cover_colors.dart' show shelfRefresh;
import '../../store/library_model.dart';
import '../../store/library_store.dart' show archivedBookIds, archivedYears;
import '../../store/placement_store.dart';
import '../../ui/book_visual.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart' show statusLabel;
import '../bookmark/bookmark_detail_screen.dart' show openBookmark;
import 'all_books.dart';
import 'book_screen.dart' show openBook;
import 'labels.dart' show ymd;
import 'place_books.dart';

const _statuses = [ReadStatus.want, ReadStatus.reading, ReadStatus.read, ReadStatus.paused];
const _cellMin = 96.0; // 격자 칸 최소 폭: 휴대폰은 3칸, 넓은 화면은 칸을 늘린다
const _gap = 14.0; // 격자 칸 사이(가로)
const _hiddenWhere = '전체 책 › 필터 › 숨긴 책 보기에서 다시 꺼낼 수 있어요.';

/// 보기 방식은 앱을 켜 둔 동안 기억한다
var _lastGrid = true;

/// 전체 책 열기(offShelf: 책장에 없는 책만)
Future<void> openAllBooks(BuildContext context, {bool offShelf = false}) => Navigator.of(context, rootNavigator: true)
    .push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/books'), builder: (_) => AllBooksScreen(offShelf: offShelf)));

enum _Pick { place, manage }

class AllBooksScreen extends StatefulWidget {
  const AllBooksScreen({super.key, this.offShelf = false});
  final bool offShelf;

  @override
  State<AllBooksScreen> createState() => _AllBooksScreenState();
}

class _AllBooksScreenState extends State<AllBooksScreen> {
  String _q = '';
  ReadStatus? _status;
  late bool _offShelfOnly = widget.offShelf;
  AllBooksSort _sort = AllBooksSort.recent;
  int? _year;
  bool _grid = _lastGrid;
  _Pick? _selecting;
  final List<String> _picked = [];
  String? _message;
  Set<String> _archived = const {};

  @override
  void initState() {
    super.initState();
    LibraryModel.instance.addListener(_changed);
    shelfRefresh.addListener(_changed);
    Future.wait([LibraryModel.instance.load(), PlacementStore.instance.ensure(), archivedBookIds().then((a) => _archived = a)]).then((_) => _changed());
  }

  @override
  void dispose() {
    LibraryModel.instance.removeListener(_changed);
    shelfRefresh.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _toggle(String id) => setState(() => _picked.contains(id) ? _picked.remove(id) : _picked.add(id));

  void _stopSelecting() => setState(() {
        _selecting = null;
        _picked.clear();
      });

  void _startManage(String id) => setState(() {
        _selecting = _Pick.manage;
        _picked
          ..clear()
          ..add(id);
        _message = null;
      });

  Future<void> _placeNow(List<String> ids) async {
    setState(() => _message = null);
    final r = await placeWithChoice(context, ids);
    if (!mounted) return;
    _stopSelecting();
    if (r.placed > 0) setState(() => _message = r.kept > 0 ? '${r.placed}권을 책장에 진열했어요. ${r.kept}권은 보관해 두었어요.' : '${r.placed}권을 책장에 진열했어요.');
  }

  Future<void> _deleteNow(List<String> ids) async {
    final model = LibraryModel.instance;
    final hid = ids.where(_archived.contains).length, removed = ids.length - hid;
    for (final id in ids) {
      await model.deleteBook(id, archived: _archived.contains(id));
    }
    // 지운 책·숨긴 책은 책장 배치에서도 빠진다
    await PlacementStore.instance.forget(ids);
    if (!mounted) return;
    _stopSelecting();
    setState(() => _message = hid > 0 && removed > 0 ? '$removed권을 삭제하고 $hid권을 숨겼어요.' : hid > 0 ? '$hid권을 숨겼어요.' : '$removed권을 삭제했어요.');
  }

  @override
  Widget build(BuildContext context) {
    final lib = LibraryModel.instance.lib;
    final place = PlacementStore.instance;
    final layout = place.layout;
    if (layout == null) return const Screen(children: [Loading()]);
    final rows = listAllBooks(lib, place.books, layout, q: _q, status: _status, offShelfOnly: _offShelfOnly, sort: _sort, year: _year);
    final memos = memosByBook(lib);
    final shown = shownBooks(lib).map((b) => b.id).toList();
    final total = shown.length;
    final years = {for (final id in shown) ?finishedYear(lib, id)}.toList()..sort((a, b) => b - a);
    final offCount = shown.where(layout.drawer.contains).length;
    final hiddenCount = LibraryModel.instance.hiddenBooks.length;
    final pickedBooks = [for (final id in _picked) if (lib.books[id] != null) id];
    // 진열할 책: 고른 책 중 책장에 없는 책(그사이 놓인 책도 뺀다)
    final chosen = [for (final id in pickedBooks) if (placementOf(layout, id) == null) id];
    final canPlace = shown.any((id) => placementOf(layout, id) == null);
    final kept = pickedBooks.where(_archived.contains).length;
    final hideOnly = kept > 0 && kept == pickedBooks.length;
    final filtered = _q.trim().isNotEmpty || _status != null || _offShelfOnly || _year != null;

    String subOf(AllBooksRow r) => [?statusLabel[lib.books[r.book.id]?.status], if (r.onShelf) '책장'].join(' · ');

    final header = Padding(
      padding: EdgeInsets.only(bottom: rows.isEmpty ? 0 : (_grid ? Space.m : Space.xs)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // 읽기 상태 탭은 고르는 중에도 그대로(바꿔도 고른 책은 유지)
        Padding(
          padding: const EdgeInsets.only(top: Space.xs),
          child: Tabs<ReadStatus?>(
            items: [(id: null, label: '전체'), for (final s in _statuses) (id: s, label: statusLabel[s]!)],
            value: _status,
            onChange: (v) => setState(() => _status = v),
          ),
        ),
        if (_selecting != null)
          Padding(
            padding: const EdgeInsets.only(top: Space.m, bottom: Space.s),
            child: Text(_selecting == _Pick.manage ? '삭제하거나 진열할 책을 골라주세요.' : '책장에 진열할 책을 골라주세요.', textAlign: TextAlign.center, style: AppType.sub),
          )
        else
          Padding(
            padding: const EdgeInsets.only(top: Space.xs),
            // 지금 앱: 마지막 아이콘 marginRight −10(오른쪽 묶음이 10 더 오른쪽), 진열 글자 오른쪽 8(Flutter TextLink는 안쪽 여백 8이 이미 있다)
            child: Row(children: [
              Expanded(child: Text('책 ${rows.length}권', style: AppType.sub, maxLines: 1)),
              Transform.translate(
                offset: const Offset(10, 0),
                child: Row(children: [
                  if (canPlace)
                    TextLink(label: '책장에 진열', onPress: () => setState(() {
                          _selecting = _Pick.place;
                          _message = null;
                        })),
                  FilterIcon(active: _offShelfOnly || _sort != AllBooksSort.recent || _year != null, onPress: () => _openFilter(years, offCount, hiddenCount)),
                  IconBtn(
                    label: _grid ? '목록으로 보기' : '표지 격자로 보기',
                    onPress: () => setState(() => _lastGrid = _grid = !_grid),
                    child: LucideIcon(_grid ? 'ListIcon' : 'LayoutGrid'),
                  ),
                ]),
              ),
            ]),
          ),
        if (_message != null) Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(_message!, style: AppType.sub.copyWith(color: AppColors.ink))),
      ]),
    );

    final empty = Padding(
      padding: const EdgeInsets.only(top: Space.xxl),
      child: total == 0
          ? Empty(title: '아직 등록한 책이 없어요', body: '책을 추가하면 여기에서 모두 볼 수 있어요.', action: '책 추가', onAction: () => _notYet('책 추가'))
          : Empty(
              title: _q.trim().isNotEmpty ? '‘${_q.trim()}’에 맞는 책이 없어요' : '이 조건에 맞는 책이 없어요',
              body: _q.trim().isNotEmpty ? '제목이나 저자의 일부만 입력해 보세요.' : '다른 읽기 상태를 고르거나 조건을 풀어 보세요.',
              action: filtered ? (_q.trim().isNotEmpty ? '검색어 지우기' : '모든 책 보기') : null,
              actionKind: 'secondary',
              onAction: () => setState(() {
                if (_q.trim().isNotEmpty) {
                  _q = '';
                } else {
                  _status = null;
                  _offShelfOnly = false;
                  _year = null;
                }
              }),
            ),
    );

    Widget body(double width) {
      if (rows.isEmpty) return ListView(padding: EdgeInsets.zero, children: [header, empty]);
      if (_grid) {
        final cols = math.max(3, ((width + _gap) / (_cellMin + _gap)).floor());
        final cellW = (width - _gap * (cols - 1)) / cols;
        final lines = (rows.length + cols - 1) ~/ cols;
        return ListView.builder(
          padding: const EdgeInsets.only(bottom: Space.section),
          itemCount: lines + 1,
          itemBuilder: (_, i) {
            if (i == 0) return header;
            final line = rows.skip((i - 1) * cols).take(cols).toList();
            return Padding(
              padding: const EdgeInsets.only(bottom: Space.xl),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final (k, r) in line.indexed) ...[
                  if (k > 0) const SizedBox(width: _gap),
                  _GridCell(
                    lib: lib,
                    book: r.book,
                    width: cellW,
                    label: [r.book.title, ?r.book.author, subOf(r)].where((t) => t.isNotEmpty).join(', '),
                    state: _selecting == null
                        ? _CellState.normal
                        : _selecting == _Pick.place && r.onShelf
                            ? _CellState.onShelf
                            : _picked.contains(r.book.id)
                                ? _CellState.picked
                                : _CellState.free,
                    onPress: _selecting == null
                        ? () => openBook(context, r.book.id)
                        : _selecting == _Pick.place && r.onShelf
                            ? null
                            : () => _toggle(r.book.id),
                    onLongPress: () {
                      if (_selecting == null) _startManage(r.book.id);
                    },
                  ),
                ],
              ]),
            );
          },
        );
      }
      return ListView.builder(
        padding: const EdgeInsets.only(bottom: Space.section),
        itemCount: rows.length + 1,
        itemBuilder: (_, i) {
          if (i == 0) return header;
          final r = rows[i - 1];
          final b = lib.books[r.book.id];
          final Widget row;
          if (_selecting != null) {
            final on = _picked.contains(r.book.id);
            final locked = _selecting == _Pick.place && r.onShelf;
            row = Opacity(
              opacity: locked ? 0.45 : 1,
              child: _BookRow(lib: lib, book: r.book, sub: subOf(r), selected: locked ? null : on, onPress: locked ? null : () => _toggle(r.book.id), right: locked ? null : _PickMark(on: on)),
            );
          } else {
            // 시안: 제목 · 저자·상태 · 한 줄 감상 두 줄, 메모가 있으면 메모 아이콘
            row = _BookListRow(
              lib: lib,
              book: r.book,
              sub: [?r.book.author, ?statusLabel[b?.status]].join(' · '),
              note: b?.note,
              memos: memos[r.book.id] ?? const [],
              onPress: () => openBook(context, r.book.id),
              onLongPress: () => _startManage(r.book.id),
            );
          }
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [if (i > 1) const AppDivider(), row]);
        },
      );
    }

    return PopScope(
      // 고르는 중에 기기 뒤로를 누르면 화면을 떠나지 않고 고르기만 끝낸다
      canPop: _selecting == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _stopSelecting();
      },
      child: Screen(
        scroll: false,
        compact: _selecting != null,
        title: _selecting == null ? null : _selectedTitle(_selecting == _Pick.manage ? pickedBooks.length : chosen.length),
        left: _selecting == null ? null : TextLink(label: '취소', soft: true, onPress: _stopSelecting),
        // 제목 대신 뒤로 옆에 검색창(권수는 안내 글자에)
        headerField: _selecting != null
            ? null
            : SearchField(value: _q, onChange: (v) => setState(() => _q = v), placeholder: total > 0 ? '책 $total권에서 찾기' : '제목, 저자 검색', label: '전체 책에서 찾기'),
        right: _selecting != null ? null : IconBtn(label: '책 추가', onPress: () => _notYet('책 추가'), child: const LucideIcon('Plus')),
        footer: switch (_selecting) {
          _Pick.manage => Row(children: [
              Expanded(
                child: Btn(
                  size: 'l',
                  kind: hideOnly ? 'secondary' : 'danger',
                  label: '${hideOnly ? '숨기기' : '삭제'}${pickedBooks.isNotEmpty ? ' ${pickedBooks.length}권' : ''}',
                  disabled: pickedBooks.isEmpty,
                  onPress: () => _openDelete(pickedBooks),
                ),
              ),
              const SizedBox(width: Space.s),
              Expanded(child: Btn(size: 'l', label: chosen.isNotEmpty ? '진열 ${chosen.length}권' : '진열', disabled: chosen.isEmpty, onPress: () => _placeNow(chosen))),
            ]),
          _Pick.place => Btn(size: 'l', label: chosen.isNotEmpty ? '선택한 ${chosen.length}권 진열' : '선택한 책 진열', disabled: chosen.isEmpty, onPress: () => _placeNow(chosen)),
          null => null,
        },
        children: [Expanded(child: LayoutBuilder(builder: (_, box) => body(box.maxWidth)))],
      ),
    );
  }

  String _selectedTitle(int n) => n > 0 ? '$n권 선택' : '책 선택';

  void _notYet(String what) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text('$what: 아직 옮기는 중이에요'), duration: const Duration(seconds: 1)));

  void _openFilter(List<int> years, int offCount, int hiddenCount) => showSheet<void>(
        context,
        title: '필터',
        scroll: true,
        builder: (ctx) => StatefulBuilder(builder: (ctx, redraw) {
          void set(VoidCallback f) {
            setState(f);
            redraw(() {});
          }

          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            FilterGroup(title: '정렬', first: true, children: [
              for (final k in AllBooksSort.values) FilterOption(label: sortLabel[k]!, selected: _sort == k, onPress: () => set(() => _sort = k)),
            ]),
            FilterGroup(title: '책장', children: [
              FilterOption(
                label: '책장에 없는 책',
                sub: '$offCount권',
                right: Toggle(label: '책장에 없는 책', value: _offShelfOnly, onChange: (v) => set(() => _offShelfOnly = v)),
              ),
            ]),
            if (years.isNotEmpty)
              FilterGroup(title: '완독한 해', children: [
                for (final y in years) FilterOption(label: '$y년', selected: _year == y, onPress: () => set(() => _year = _year == y ? null : y)),
              ]),
            if (hiddenCount > 0)
              FilterGroup(title: '숨긴 책', children: [
                FilterOption(
                  label: '숨긴 책 보기',
                  sub: '$hiddenCount권 · 연도 책장에 남아 있는 책',
                  chevron: true,
                  onPress: () {
                    Navigator.pop(ctx);
                    _openHidden();
                  },
                ),
              ]),
          ]);
        }),
      );

  /// 고른 책 삭제·숨기기 확인: 무엇이 지워지고 무엇이 남는지 숫자로
  Future<void> _openDelete(List<String> ids) async {
    final lib = LibraryModel.instance.lib;
    final keptIds = [for (final id in ids) if (_archived.contains(id)) id];
    final removed = [for (final id in ids) if (!_archived.contains(id)) id];
    final hideOnly = keptIds.isNotEmpty && keptIds.length == ids.length;
    final yearsOf = await archivedYears(keptIds);
    if (!mounted) return;
    final years = {for (final l in yearsOf.values) ...l}.toList()..sort();
    final yearText = '${years.join('·')}년 책장';
    final note = deleteNote(deleteSummary(lib, removed));
    final ok = await showSheet<bool>(
      context,
      title: hideOnly ? '${ids.length}권을 숨길까요?' : '${ids.length}권을 삭제할까요?',
      description: hideOnly ? '지금 책장과 책 목록에서 빠지고, $yearText에는 그대로 남아요.' : null,
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ExcludeSemantics(
          child: Padding(
            padding: const EdgeInsets.only(top: Space.xs, bottom: Space.l),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              for (final (i, id) in ids.take(3).indexed) ...[
                if (i > 0) const SizedBox(width: Space.m),
                SizedBox(width: 56, child: BookVisual(lib: lib, id: id, width: 56)),
              ],
              if (ids.length > 3) Padding(padding: const EdgeInsets.only(left: Space.m, bottom: Space.xs), child: Text('외 ${ids.length - 3}권', style: AppType.sub)),
            ]),
          ),
        ),
        if (removed.isNotEmpty) Text('${keptIds.isNotEmpty ? '${removed.length}권은 ' : ''}$note', style: AppType.sub),
        if (keptIds.isNotEmpty && !hideOnly) Padding(padding: const EdgeInsets.only(top: Space.xs), child: Text('${keptIds.length}권은 $yearText에 있어서 숨기기만 해요.', style: AppType.sub)),
        Padding(
          padding: const EdgeInsets.only(top: Space.s, bottom: Space.l),
          child: keptIds.isNotEmpty ? Text(_hiddenWhere, style: AppType.caption) : const SizedBox.shrink(),
        ),
        Btn(label: hideOnly ? '숨기기' : '삭제', kind: hideOnly ? 'primary' : 'danger', size: 'l', onPress: () => Navigator.pop(ctx, true)),
        Padding(padding: const EdgeInsets.only(top: Space.s), child: Center(child: TextLink(label: '취소', soft: true, onPress: () => Navigator.pop(ctx, false)))),
      ]),
    );
    if (ok == true) await _deleteNow(ids);
  }

  /// 숨긴 책: 다시 보이게 하면 갈피·기록과 함께 돌아오고 책장에는 '책장에 없는 책'으로 들어간다
  Future<void> _openHidden() async {
    final model = LibraryModel.instance;
    final years = await archivedYears(model.hiddenBooks.map((b) => b.id));
    if (!mounted) return;
    await showSheet<void>(
      context,
      title: '숨긴 책',
      description: '연도 책장에 남아 있어 지우는 대신 숨긴 책이에요. 다시 보이게 하면 갈피·기록과 함께 돌아와요.',
      scroll: true,
      maxHeight: 0.8,
      builder: (ctx) => ListenableBuilder(
        listenable: model,
        builder: (ctx, _) {
          final lib = model.lib;
          final books = model.hiddenBooks;
          if (books.isEmpty) return Text('숨긴 책이 없어요.', style: AppType.sub);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (final b in books)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.s),
                child: Row(children: [
                  ExcludeSemantics(child: SizedBox(width: 44, child: BookVisual(lib: lib, id: b.id, width: 44))),
                  const SizedBox(width: Space.m),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(lib.editions[b.editionId]?.title ?? '제목 없음', style: AppType.body, maxLines: 1, overflow: TextOverflow.ellipsis),
                      Text(
                        [?lib.editions[b.editionId]?.authors.firstOrNull, if (years[b.id]?.isNotEmpty ?? false) '${years[b.id]!.join('·')}년 책장'].join(' · '),
                        style: AppType.caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ]),
                  ),
                  const SizedBox(width: Space.m),
                  Btn(
                    label: '다시 보이기',
                    kind: 'secondary',
                    size: 's',
                    onPress: () async {
                      final title = lib.editions[b.editionId]?.title ?? '책';
                      final last = books.length <= 1;
                      await model.unhideBook(b.id);
                      // 책장 쪽 책 목록에 다시 넣고 '책장에 없는 책'으로
                      await PlacementStore.instance.reload();
                      await PlacementStore.instance.addToDrawer(b.id);
                      if (!mounted) return;
                      setState(() => _message = '‘$title’ 책을 다시 보이게 했어요. 책장에 없는 책에 있어요.');
                      if (last && ctx.mounted) Navigator.pop(ctx);
                    },
                  ),
                ]),
              ),
          ]);
        },
      ),
    );
  }
}

enum _CellState { normal, free, picked, onShelf }

/// 격자 한 칸: 표지 + 제목·저자 한 줄씩. 고르는 중: 고를 수 있는 책은 표지 오른쪽 위 모서리에 원, 고른 책은 테마색 테두리,
/// 이미 책장에 있는 책은 흐린 표지 + '책장에 있음'
class _GridCell extends StatelessWidget {
  const _GridCell({required this.lib, required this.book, required this.width, required this.label, required this.state, this.onPress, this.onLongPress});
  final Library lib;
  final Book book;
  final double width;
  final String label;
  final _CellState state;
  final VoidCallback? onPress;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final e = lib.editions[lib.books[book.id]?.editionId];
    final r = coverRect(e?.widthMm, e?.heightMm, width);
    final onShelf = state == _CellState.onShelf;
    return Semantics(
      button: true,
      selected: state == _CellState.picked,
      enabled: !onShelf,
      label: label,
      onTap: onPress,
      excludeSemantics: true,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: Pressable(
          onPress: onPress,
          child: SizedBox(
            width: width,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Stack(clipBehavior: Clip.none, children: [
                Opacity(opacity: onShelf ? 0.45 : 1, child: BookVisual(lib: lib, id: book.id, width: width)),
                if (state == _CellState.picked)
                  Positioned(
                    left: r.edge - 2,
                    top: r.edge - 2,
                    width: r.w + 4,
                    height: r.h + 4,
                    child: DecoratedBox(decoration: BoxDecoration(border: Border.all(color: AppColors.accent, width: 2), borderRadius: BorderRadius.circular(5))),
                  ),
                if (state == _CellState.free || state == _CellState.picked) Positioned(top: r.edge - 7, right: r.edge - 5, child: _PickMark(on: state == _CellState.picked)),
                if (onShelf)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: r.edge + 12,
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: Space.m, vertical: Space.xs),
                        decoration: BoxDecoration(color: AppColors.white, borderRadius: BorderRadius.circular(999)),
                        child: Text('책장에 있음', maxLines: 1, style: AppType.caption.copyWith(fontSize: 13, height: 18 / 13, color: AppColors.ink)),
                      ),
                    ),
                  ),
              ]),
              Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: Text(book.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.row.copyWith(fontSize: 15, height: 21 / 15)),
              ),
              if (book.author != null)
                Padding(
                  padding: const EdgeInsets.only(top: 1),
                  child: Text(book.author!, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption.copyWith(fontSize: 13, height: 18 / 13)),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _PickMark extends StatelessWidget {
  const _PickMark({required this.on});
  final bool on;

  @override
  Widget build(BuildContext context) => Container(
        width: 24,
        height: 24,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: on ? AppColors.accent : AppColors.white,
          border: Border.all(color: on ? AppColors.accent : AppColors.inkSoft, width: 1.5),
        ),
        child: on ? const Center(child: LucideIcon('Check', size: 14, color: AppColors.onAccent, stroke: 2.4)) : null,
      );
}

/// 작은 앞모습(목록 줄 왼쪽, 칸 폭 64)
Widget _thumb(Library lib, String id) => SizedBox(width: 64, child: Center(child: ExcludeSemantics(child: BookVisual(lib: lib, id: id, width: 56))));

/// 목록 한 줄(시안): 표지 + 제목 + 저자·상태 + 한 줄 감상 두 줄. 메모가 있으면 오른쪽 위 메모 아이콘을 눌러 작은 상자로 본다
class _BookListRow extends StatelessWidget {
  const _BookListRow({required this.lib, required this.book, required this.sub, required this.note, required this.memos, required this.onPress, required this.onLongPress});
  final Library lib;
  final Book book;
  final String sub;
  final String? note;
  final List<BookMemo> memos;
  final VoidCallback onPress, onLongPress;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: [book.title, sub, ?note].where((t) => t.isNotEmpty).join(', '),
        onTap: onPress,
        child: GestureDetector(
          onLongPress: onLongPress,
          child: Pressable(
            onPress: onPress,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 14),
              child: Row(children: [
                _thumb(lib, book.id),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(child: Text(book.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowStrong)),
                      if (memos.isNotEmpty) const SizedBox(width: Space.xs),
                      if (memos.isNotEmpty)
                        // 지금 앱: 44 누르는 칸에 marginRight −12·marginVertical −10(눌리는 칸은 크게, 줄 높이는 그대로)
                        Builder(
                          builder: (ctx) => SizedBox(
                            width: Space.touch - 12,
                            height: Space.touch - 20,
                            child: OverflowBox(
                              maxWidth: Space.touch,
                              maxHeight: Space.touch,
                              alignment: Alignment.centerLeft,
                              child: IconBtn(
                                label: '메모 ${memos.length}개 보기',
                                onPress: () => _showMemos(ctx, book.id, memos),
                                child: const LucideIcon('StickyNote', size: 18, color: AppColors.inkSoft),
                              ),
                            ),
                          ),
                        ),
                    ]),
                    if (sub.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub)),
                    if ((note ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 3 + Space.xs),
                        child: Text(note!, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.sub.copyWith(color: AppColors.ink)),
                      ),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      );
}

/// 고르는 중의 한 줄: 작은 앞모습 + 제목·저자·상태, 오른쪽 고름 표시
class _BookRow extends StatelessWidget {
  const _BookRow({required this.lib, required this.book, required this.sub, this.selected, this.onPress, this.right});
  final Library lib;
  final Book book;
  final String sub;
  final bool? selected;
  final VoidCallback? onPress;
  final Widget? right;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        selected: selected,
        label: [book.title, ?book.author, sub].where((t) => t.isNotEmpty).join(', '),
        onTap: onPress,
        excludeSemantics: true,
        child: Pressable(
          onPress: onPress,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(children: [
              _thumb(lib, book.id),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(book.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
                  if (book.author != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(book.author!, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub)),
                  if (sub.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(sub, style: AppType.caption)),
                ]),
              ),
              ?right,
            ]),
          ),
        ),
      );
}

/// 메모 작은 상자: 아이콘 옆에서 뜬다(화면 아래쪽 아이콘이면 위로). 최근 메모 다섯 개, 누르면 그 갈피(독서 기록은 책 정보)로
Future<void> _showMemos(BuildContext iconContext, String bookId, List<BookMemo> memos) {
  final box = iconContext.findRenderObject()! as RenderBox;
  final at = box.localToGlobal(Offset.zero) & box.size;
  final screen = MediaQuery.sizeOf(iconContext);
  final below = at.center.dy < screen.height * 0.6;
  const boxW = 268.0, edge = 16.0, arrow = 12.0;
  final right = math.max(edge, screen.width - at.right);
  final arrowRight = math.max(10.0, screen.width - at.center.dx - right - arrow / 2);
  final rest = memos.length - 5;
  return showGeneralDialog<void>(
    context: iconContext,
    barrierDismissible: true,
    barrierLabel: '메모 닫기',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 140),
    pageBuilder: (ctx, _, _) => const SizedBox.shrink(),
    transitionBuilder: (ctx, anim, _, _) {
      final t = Curves.easeOutCubic.transform(anim.value);
      void open(VoidCallback go) {
        Navigator.pop(ctx);
        go();
      }

      return Stack(children: [
        Positioned(
          right: right,
          top: below ? at.bottom + 2 : null,
          bottom: below ? null : screen.height - at.top + 2,
          width: boxW,
          child: Opacity(
            opacity: t,
            child: Transform.scale(
              scale: 0.9 + 0.1 * t,
              alignment: below ? Alignment.topRight : Alignment.bottomRight,
              child: Material(
                color: Colors.transparent,
                child: Stack(clipBehavior: Clip.none, children: [
                  Positioned(
                    right: arrowRight,
                    top: below ? -arrow / 2 + 1 : null,
                    bottom: below ? null : -arrow / 2 + 1,
                    child: Transform.rotate(angle: math.pi / 4, child: Container(width: arrow, height: arrow, color: AppColors.bg)),
                  ),
                  Container(
                    constraints: const BoxConstraints(maxHeight: 260),
                    decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(12), boxShadow: [cssShadow(const Color(0x2E191F28), 0, 6, 20)]),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.symmetric(horizontal: Space.m, vertical: Space.xs),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        for (final m in memos.take(5))
                          Semantics(
                            button: true,
                            label: '${m.text}, ${ymd(m.at)} ${m.bookmark ? '갈피' : '독서 기록'}. 눌러서 열기',
                            excludeSemantics: true,
                            child: Pressable(
                              onPress: () => open(() => m.bookmark ? openBookmark(iconContext, m.id) : openBook(iconContext, bookId)),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: Space.s),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(m.text, maxLines: 4, overflow: TextOverflow.ellipsis, style: AppType.sub.copyWith(color: AppColors.ink)),
                                  Padding(padding: const EdgeInsets.only(top: 3), child: Text('${ymd(m.at)} · ${m.bookmark ? '갈피' : '독서 기록'}', style: AppType.caption)),
                                ]),
                              ),
                            ),
                          ),
                        if (rest > 0)
                          Pressable(
                            onPress: () => open(() => openBook(iconContext, bookId)),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: Space.s),
                              child: Text('그 밖에 $rest개 · 책 정보에서 모두 보기', style: AppType.caption),
                            ),
                          ),
                      ]),
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ]);
    },
  );
}
