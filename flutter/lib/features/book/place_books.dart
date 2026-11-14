// 책을 책장에 놓기(지금 앱 features/book/place-books.ts + NoRoomSheet): 전체 책·책 정보·책 추가가 같이 쓴다. 책 정보는 그대로, 배치만 바꾼다.
// - 이미 책장에 있는 책은 건너뛴다. 다른 책을 옮기거나 눕혀 끼워 넣지 않는다(빈 자리에만).
// - 자리가 모자라면 묻는다: 잠긴 선반 열기(누를 때마다 한 칸) 또는 '보관만 하기'(책장에 없는 책으로). 다 열었으면 보관한다.
//   바깥을 누르거나 닫으면 보관한다(책이 사라지지 않게)
library;

import 'package:flutter/material.dart';

import '../../domain/layout.dart' show placementOf;
import '../../scene_config/skin.dart' show skinPlank;
import '../../store/library_model.dart';
import '../../store/placement_store.dart';
import '../../ui/book_visual.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../home/locked_rows.dart' show lockedShelfCount;

/// 놓을 수 있는 만큼 놓는다(놓은 책, 자리가 없어 남은 책)
Future<({List<String> placed, List<String> left})> placeBooks(Iterable<String> ids) async {
  final s = PlacementStore.instance;
  await s.ensure();
  final placed = <String>[], left = <String>[];
  for (final id in ids) {
    if (placementOf(s.layout!, id) != null) continue;
    (await s.placeOnShelf(id) ? placed : left).add(id);
  }
  return (placed: placed, left: left);
}

/// 놓아 보고, 남은 책이 있으면 잠긴 선반 열기 / 보관만 하기를 고르게 한다. 끝나면 (놓은 수, 보관만 한 수)
Future<({int placed, int kept})> placeWithChoice(BuildContext context, List<String> ids) async {
  final s = PlacementStore.instance;
  var total = 0;
  var rest = ids;
  var afterNewShelf = false;
  while (true) {
    final r = await placeBooks(rest);
    total += r.placed.length;
    if (r.left.isEmpty) return (placed: total, kept: 0);
    Future<({int placed, int kept})> keep() async {
      for (final id in r.left) {
        await s.addToDrawer(id);
      }
      return (placed: total, kept: r.left.length);
    }

    // 새 빈 선반에도 한 권도 못 놓았으면(선반보다 큰 책) 더 묻지 않는다(선반이 끝없이 늘지 않게). 잠긴 칸을 다 열었어도 보관
    if ((afterNewShelf && r.placed.isEmpty) || lockedShelfCount(s.layout!.shelves.length) == 0 || !context.mounted) return keep();
    final open = await _askNoRoom(context, r.left);
    if (open != true || !await s.addShelf()) return keep();
    rest = r.left;
    afterNewShelf = true;
  }
}

/// 자리가 없을 때 전용 시트: 진열하려던 책이 선반 판 위에 서 있고, 아래에서 선반을 열거나 보관한다. true = 선반 열기
Future<bool?> _askNoRoom(BuildContext context, List<String> ids) {
  final lib = LibraryModel.instance.lib;
  final shown = [for (final id in ids) if (lib.books[id] != null) id].take(3).toList();
  final rest = ids.length - shown.length;
  return showSheet<bool>(
    context,
    title: '책장에 빈 자리가 없어요',
    description: '${ids.length}권을 진열할 자리가 없어요. 선반을 더 열어 볼까요?',
    builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Semantics(
        label: '진열하려던 책 ${ids.length}권',
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.only(top: Space.s, bottom: Space.xl),
          child: Column(children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 100),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                for (final (i, id) in shown.indexed) ...[
                  if (i > 0) const SizedBox(width: Space.m),
                  SizedBox(width: 68, child: BookVisual(lib: lib, id: id, width: 68)),
                ],
                if (rest > 0) Padding(padding: const EdgeInsets.only(left: Space.m, bottom: Space.xs), child: Text('외 $rest권', style: AppType.sub)),
              ]),
            ),
            // 선반 판(지금 책장 판 색), 좌우로 조금 넓게
            LayoutBuilder(
              builder: (_, box) => SizedBox(
                height: 8,
                child: OverflowBox(
                  maxWidth: box.maxWidth + Space.xs * 2,
                  child: Container(height: 8, decoration: BoxDecoration(color: Color(0xFF000000 | skinPlank.color), borderRadius: BorderRadius.circular(2))),
                ),
              ),
            ),
          ]),
        ),
      ),
      Btn(label: '무료로 선반 열고 진열하기', size: 'l', onPress: () => Navigator.pop(ctx, true)),
      Padding(
        padding: const EdgeInsets.only(top: Space.s),
        child: Center(child: TextLink(label: '보관만 하기', soft: true, onPress: () => Navigator.pop(ctx, false))),
      ),
    ]),
  );
}
