// 갈피 색 고르기(지금 앱 features/bookmark/RibbonColorSheet.tsx): 책마다 하나. 책장 갈피 탭·갈피 카드 뒤 종이·테이프가 함께 바뀐다.
// 자동 = 표지에서 고른 색. 기본 색 중에서 고를 수 있고, 자동으로 되돌릴 수 있다.
// (표지에서 뽑은 색 몇 개를 보여 주는 '표지 색' 묶음은 표지 색 뽑기를 옮길 때 함께 넣는다)
library;

import 'package:flutter/material.dart';

import '../../domain/color.dart';
import '../../store/library_model.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'bookmark_card.dart' show hexColor;

Future<void> showRibbonColorSheet(BuildContext context, String bookId) => showSheet<void>(
      context,
      title: '갈피 색',
      description: '책장 갈피와 갈피 카드 색이 함께 바뀌어요',
      scroll: true,
      maxHeight: 0.85,
      builder: (ctx) => ListenableBuilder(listenable: LibraryModel.instance, builder: (ctx, _) => _Body(bookId)),
    );

class _Body extends StatelessWidget {
  const _Body(this.bookId);
  final String bookId;

  @override
  Widget build(BuildContext context) {
    final model = LibraryModel.instance;
    final b = model.lib.books[bookId];
    if (b == null) return const SizedBox.shrink();
    void pick(String? c) => model.updateBook(bookId, ribbonColor: c);
    final shown = ribbonOf(model.lib, bookId);
    final paper = paperColors(shown, bookId);
    final tabs = tabColors(shown, bookId);
    final hair = 1 / MediaQuery.devicePixelRatioOf(context);
    Widget swatches(List<String> list) => Padding(
          padding: const EdgeInsets.symmetric(vertical: Space.s),
          child: Wrap(spacing: Space.m, runSpacing: Space.m, children: [
            for (final c in list)
              Builder(builder: (_) {
                final on = b.ribbonColor?.toLowerCase() == c.toLowerCase();
                return Semantics(
                  button: true,
                  selected: on,
                  label: '갈피 색 $c',
                  onTap: () => pick(c),
                  excludeSemantics: true,
                  child: Pressable(
                    onPress: () => pick(c),
                    child: Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: hexColor(paperColors(c, bookId).tape),
                        border: Border.all(color: on ? AppColors.ink : AppColors.line, width: on ? 2 : hair * 2),
                      ),
                      child: on ? const Center(child: LucideIcon('Check', size: 20, stroke: 2.4)) : null,
                    ),
                  ),
                );
              }),
          ]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      // 미리보기: 책장 갈피 두 장 + 갈피 카드(뒤 종이·테이프)
      ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.only(top: Space.s, bottom: Space.l),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: Space.s),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.line, width: 3))),
              child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                _tab(hexColor(tabs.$2), 22),
                const SizedBox(width: 3),
                _tab(hexColor(tabs.$1), 30),
              ]),
            ),
            const SizedBox(width: Space.xl),
            SizedBox(
              width: 150,
              height: 72,
              child: Stack(clipBehavior: Clip.none, children: [
                Positioned(
                  left: 3,
                  right: -3,
                  top: 4,
                  bottom: -4,
                  child: Transform.rotate(angle: 0.01745, child: Container(decoration: BoxDecoration(color: hexColor(paper.paper), borderRadius: BorderRadius.circular(3)))),
                ),
                Positioned.fill(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: Space.m),
                    alignment: Alignment.centerLeft,
                    decoration: BoxDecoration(color: AppColors.white, borderRadius: BorderRadius.circular(3), border: Border.all(color: AppColors.line, width: hair * 2)),
                    child: Text('마음에 남은 문장', maxLines: 1, style: AppType.caption.copyWith(color: AppColors.ink)),
                  ),
                ),
                Positioned(top: -7, right: 12, width: 28, height: 20, child: ColoredBox(color: hexColor(paper.tape))),
              ]),
            ),
          ]),
        ),
      ),
      FilterGroup(title: '자동', first: true, children: [FilterOption(label: '표지에서 고른 색', selected: b.ribbonColor == null, onPress: () => pick(null))]),
      FilterGroup(title: '다른 색', children: [swatches(ribbonPalette)]),
    ]);
  }

  Widget _tab(Color c, double h) => Container(width: 12, height: h, decoration: BoxDecoration(color: c, borderRadius: const BorderRadius.vertical(top: Radius.circular(2))));
}
