// 연결할 책 고르기(지금 앱 features/bookmark/BookPicker.tsx: 갈피 작성·독서 시작·세션 수정이 함께 쓴다). 최근 읽은 책을 먼저.
// multi: 여러 권 고르기(읽기 탭 '책 추가'). 줄을 누르면 체크만 되고 '완료'로 한꺼번에 넘긴다
library;

import 'package:flutter/material.dart';

import '../book/add_book_screen.dart' show openAddBook;

import '../../domain/library.dart';
import '../../domain/reading.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../stats/stats_widgets.dart';

const statusLabel = {ReadStatus.want: '읽기 전', ReadStatus.reading: '읽는 중', ReadStatus.read: '완독', ReadStatus.paused: '보류'};

/// 여러 권 고르기: fixed = 이미 목록에 있어 고를 수 없는 것(체크된 채 흐리게), none = '책 없이 읽기' 줄의 값
class MultiPick {
  const MultiPick({required this.fixed, required this.none});
  final List<String> fixed;
  final String none;
}

/// 한 권 고르기: 고른 책 id(책 없이면 null)를 돌려준다. 닫으면 (picked: false)
/// addNew: 맨 위 '+ 새 책 등록'(책 추가로 갔다가 등록한 책을 고른 것으로 돌아온다)
Future<({bool picked, String? id})> pickBook(BuildContext context, Library lib, {bool allowNone = false, bool addNew = false}) async {
  final r = await showSheet<({bool picked, String? id})>(
    context,
    title: '책 고르기',
    maxHeight: 0.85,
    fit: true,
    builder: (ctx) => _Picker(
      lib: lib,
      allowNone: allowNone,
      onPick: (id) => Navigator.pop(ctx, (picked: true, id: id)),
      onAddNew: addNew ? () => Navigator.pop(ctx, (picked: false, id: _addNew)) : null,
    ),
  );
  if (r?.id == _addNew && context.mounted) {
    final id = await openAddBook(context, pick: true);
    return id != null ? (picked: true, id: id) : (picked: false, id: null);
  }
  return r ?? (picked: false, id: null);
}

const _addNew = '\u0000new';

/// 여러 권 고르기: 새로 고른 것(고른 순서). 닫거나 하나도 안 고르면 빈 목록
Future<List<String>> pickBooks(BuildContext context, Library lib, MultiPick multi, {bool allowNone = false}) async {
  final r = await showSheet<List<String>>(
    context,
    title: '책 추가',
    description: '타이머에 둘 책을 골라요. 여러 권 고를 수 있어요.',
    maxHeight: 0.85,
    fit: true,
    builder: (ctx) => _Picker(lib: lib, allowNone: allowNone, multi: multi, onDone: (ids) => Navigator.pop(ctx, ids)),
  );
  return r ?? const [];
}

class _Picker extends StatefulWidget {
  const _Picker({required this.lib, this.allowNone = false, this.multi, this.onPick, this.onDone, this.onAddNew});
  final Library lib;
  final bool allowNone;
  final MultiPick? multi;
  final ValueChanged<String?>? onPick;
  final ValueChanged<List<String>>? onDone;
  final VoidCallback? onAddNew;

  @override
  State<_Picker> createState() => _PickerState();
}

class _PickerState extends State<_Picker> {
  String _q = '';
  final _picked = <String>[];

  void _choose(String? id) {
    final m = widget.multi;
    if (m == null) return widget.onPick?.call(id);
    final k = id ?? m.none;
    setState(() => _picked.contains(k) ? _picked.remove(k) : _picked.add(k));
  }

  Widget? _mark(String id) {
    final m = widget.multi;
    if (m == null) return null;
    final fixed = m.fixed.contains(id);
    final on = fixed || _picked.contains(id);
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: fixed ? AppColors.inkFaint : on ? AppColors.accent : null,
        border: Border.all(color: fixed ? AppColors.inkFaint : on ? AppColors.accent : AppColors.track, width: 2),
      ),
      child: on ? const Center(child: LucideIcon('Check', size: 14, color: AppColors.onAccent, stroke: 3)) : null,
    );
  }

  Widget _item({required Widget child, required bool fixed, required VoidCallback onPress, String? label, bool? checked}) => Semantics(
        button: true,
        checked: checked,
        enabled: !fixed,
        label: label,
        child: Opacity(
          opacity: fixed ? 0.45 : 1,
          child: Pressable(
            onPress: fixed ? null : onPress,
            child: ConstrainedBox(constraints: const BoxConstraints(minHeight: 60), child: Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: child)),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final lib = widget.lib, m = widget.multi;
    // 숨긴 책(연도 책장에만 남긴 책)은 고를 책에서 뺀다(지금 앱 서재에는 숨긴 책이 없다)
    final recent = [for (final id in recentBookIds(lib)) if (lib.books[id]?.hiddenAt == null) id];
    final rest = lib.books.keys.where((id) => !recent.contains(id) && lib.books[id]!.hiddenAt == null);
    final t = _q.trim();
    final list = [
      for (final id in [...recent, ...rest])
        if (t.isEmpty || '${lib.editions[lib.books[id]!.editionId]?.title} ${lib.editions[lib.books[id]!.editionId]?.authors.join(' ')}'.contains(t)) id,
    ];
    final noneFixed = m != null && m.fixed.contains(m.none);
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.only(top: Space.tight, bottom: 4),
        child: SearchField(value: _q, onChange: (v) => setState(() => _q = v), placeholder: '제목·저자', label: '책 찾기'),
      ),
      Flexible(
        child: ListView(shrinkWrap: true, keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag, children: [
          if (widget.onAddNew != null)
            _item(
              fixed: false,
              checked: null,
              label: '새 책 등록',
              onPress: widget.onAddNew!,
              child: Text('+ 새 책 등록', style: AppType.row.copyWith(color: AppColors.accent)),
            ),
          if (widget.allowNone && widget.onAddNew != null) const AppDivider(),
          if (widget.allowNone)
            _item(
              fixed: noneFixed,
              checked: m == null ? null : noneFixed || _picked.contains(m.none),
              onPress: () => _choose(null),
              child: Row(children: [
                Expanded(child: Text(m != null ? '책 없이 읽기' : '책 연결 없이', style: AppType.row)),
                if (m != null) _mark(m.none)!,
              ]),
            ),
          for (final (i, id) in list.indexed) ...[
            if (i > 0 || widget.allowNone || widget.onAddNew != null) const AppDivider(),
            Builder(builder: (_) {
              final b = lib.books[id]!;
              final e = lib.editions[b.editionId];
              final fixed = m?.fixed.contains(id) ?? false;
              return _item(
                fixed: fixed,
                checked: m == null ? null : fixed || _picked.contains(id),
                label: fixed ? '${e?.title}, 이미 목록에 있어요' : e?.title,
                onPress: () => _choose(id),
                child: Row(children: [
                  SizedBox(width: 34, child: Center(child: IgnorePointer(child: LinkedCover(lib: lib, id: id, width: 34)))),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(e?.title ?? '', style: AppType.rowStrong, maxLines: 2, overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 4),
                      Text([if (e != null && e.authors.isNotEmpty) e.authors.join(', '), fixed ? '목록에 있어요' : statusLabel[b.status]!].join(' · '),
                          style: AppType.sub, maxLines: 1, overflow: TextOverflow.ellipsis),
                    ]),
                  ),
                  if (m != null) ...[const SizedBox(width: 14), _mark(id)!],
                ]),
              );
            }),
          ],
          if (list.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text(t.isNotEmpty ? '맞는 책이 없어요.' : '내 책이 없어요. 먼저 책을 추가해 주세요.', textAlign: TextAlign.center, style: AppType.sub),
            ),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.only(top: Space.tight),
        child: m != null
            ? Btn(label: _picked.isEmpty ? '완료' : '완료 (${_picked.length})', onPress: () => widget.onDone?.call(List.of(_picked)))
            : Btn(label: '닫기', kind: 'ghost', onPress: () => Navigator.pop(context)),
      ),
    ]);
  }
}
