// 장정 편집(지금 앱 app/book/[id]/binding.tsx): 책 색·재질·표지 그림·책등 글자 배치. 장정만 바뀌고 독서 기록·배치는 그대로다.
// 저장하면 사용자 장정으로 남아 다시 켜도 유지된다. 아무것도 고르지 않았으면 책장에 보이는 모습 그대로 보여 주고, 저장해도 바꾸지 않는다
library;

import 'package:flutter/material.dart';

import '../../store/library_model.dart';
import '../../store/placement_store.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'binding_editor.dart';

Future<void> openBindingEditor(BuildContext context, String id) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/book/binding'), builder: (_) => BindingScreen(id: id)));

class BindingScreen extends StatefulWidget {
  const BindingScreen({super.key, required this.id});
  final String id;

  @override
  State<BindingScreen> createState() => _BindingScreenState();
}

class _BindingScreenState extends State<BindingScreen> {
  final _model = LibraryModel.instance;
  late final _book = _model.lib.books[widget.id];
  late final _edition = _book == null ? null : _model.lib.editions[_book.editionId];
  late final _recommended = BindingDraft.recommended(_edition);
  late BindingDraft _v = BindingDraft.saved(_book?.bindingId == null ? null : _model.lib.bindings[_book!.bindingId], _recommended);
  bool _touched = false, _saving = false;

  void _set(BindingDraft next) => setState(() {
        _touched = true;
        _v = next;
      });

  Future<void> _save() async {
    final nav = Navigator.of(context);
    if (!_touched) return nav.pop();
    if (_saving) return;
    setState(() => _saving = true);
    // 추천으로 되돌려 재질·표지 그림이 비면 예전 값도 지운다
    await _model.setBinding(widget.id, _v);
    await PlacementStore.instance.reload();
    if (mounted) nav.pop();
  }

  @override
  Widget build(BuildContext context) {
    final e = _edition;
    if (_book == null || e == null) return const Screen(title: '장정 편집', children: [Empty(title: '책을 찾을 수 없어요')]);
    return Screen(
      title: '장정 편집',
      right: Semantics(
        button: true,
        label: '추천 장정으로 초기화',
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _set(BindingDraft(
            spineColor: _recommended.spineColor,
            motif: _recommended.motif,
            seed: _v.seed,
            inkColor: _recommended.inkColor,
            accentColor: _recommended.accentColor,
            layout: _recommended.layout,
          )),
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            alignment: Alignment.center,
            padding: const EdgeInsets.only(right: 10, left: 10),
            child: Text('초기화', style: AppType.sub.copyWith(fontSize: 16)),
          ),
        ),
      ),
      footer: Btn(label: '저장', onPress: _save, busy: _saving),
      children: [
        BindingEditor(
          title: e.title,
          author: e.authors.join(', '),
          size: e.widthMm != null && e.heightMm != null ? (widthMm: e.widthMm!, heightMm: e.heightMm!) : null,
          pages: e.pageCount,
          value: _v,
          recommended: _recommended,
          current: _touched ? null : PlacementStore.instance.books[widget.id],
          realCover: e.coverUri,
          onChange: _set,
        ),
      ],
    );
  }
}
