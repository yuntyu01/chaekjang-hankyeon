// 스토어(지금 앱 app/store.tsx, 2026-11-04 사용자 '선반·벽지·벽 여부를 골라 바꾸게'): 부품을 고르면 위 미리보기(홈 책장과 같은 그림)가 그 자리에서 바뀌고,
// '적용하기'를 누르면 홈 책장에 바로 반영된다(2026-11-10 '실시간으로'). 고르기만 하고 나가면 원래 스킨으로 되돌린다.
// Flutter는 벽 있는 책장만: '벽 없이 선반만'(틀 없음)은 옆 벽이 없어 떨어짐 물리가 다시 필요하고 카메라·판 모양이 달라 아직 두지 않는다.
// 책 측면(색 한 가지·실물 측면·표지 이어 쌓기)은 책장 그림이 아직 한 가지라 고르기를 두지 않았다
library;

import 'package:flutter/material.dart';

import '../../scene_config/skin.dart';
import '../../services/cover_colors.dart' show shelfRefresh;
import '../../store/skin_store.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../home/home_screen.dart' show dropHomeSnapshot;
import 'skin_preview.dart';

Future<void> openStore(BuildContext context) => Navigator.of(context, rootNavigator: true)
    .push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/store'), builder: (_) => const StoreScreen()));

class StoreScreen extends StatefulWidget {
  const StoreScreen({super.key});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  final _saved = skinChoice;
  late SkinChoice _choice = skinChoice;
  bool _applied = false;

  @override
  void dispose() {
    // 고르기만 하고 나가면 원래 스킨으로
    if (!_applied) setSkin(_saved);
    super.dispose();
  }

  void _pick(SkinChoice next) {
    if (!setSkin(next)) return;
    setState(() => _choice = next);
  }

  Future<void> _apply() async {
    _applied = true;
    await saveSkin(_choice);
    await dropHomeSnapshot();
    // 홈 책장을 새 스킨 값으로 다시 굽는다(굽기 열쇠에 맞추기 값이 들어 있어 바뀐 줄은 새로 굽는다)
    shelfRefresh.value++;
    if (mounted) Navigator.maybePop(context);
  }

  Widget _options(Map<String, SkinPart?> table, String value, SkinChoice Function(String k) next) => LayoutBuilder(
        builder: (_, box) => Wrap(
          spacing: Space.s,
          runSpacing: Space.s,
          children: [
            for (final e in table.entries)
              if (e.value != null)
                SizedBox(
                  width: box.maxWidth * 0.48,
                  child: Choice(
                    compact: true,
                    label: e.value!.name,
                    selected: value == e.key,
                    onPress: () => _pick(next(e.key)),
                    child: Container(
                      height: 28,
                      margin: const EdgeInsets.only(bottom: Space.s),
                      decoration: BoxDecoration(
                        color: Color(0xFF000000 | e.value!.color),
                        borderRadius: BorderRadius.circular(Shape.tag),
                        border: Border.all(color: AppColors.line, width: 1 / MediaQuery.devicePixelRatioOf(context)),
                      ),
                    ),
                  ),
                ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final changed = _choice != _saved;
    return Screen(
      title: '스토어',
      footer: Btn(label: '적용하기', size: 'l', disabled: !changed, onPress: _apply),
      children: [
        LayoutBuilder(
          builder: (_, box) => Semantics(
            label: '고른 선반·벽지로 그린 책장 한 칸',
            excludeSemantics: true,
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: AppColors.bg,
                borderRadius: BorderRadius.circular(Shape.sheet),
                border: Border.all(color: AppColors.line, width: 1 / MediaQuery.devicePixelRatioOf(context)),
              ),
              child: SkinPreview(width: box.maxWidth, skin: _choice),
            ),
          ),
        ),
        const H2('선반'),
        _options(plankSkins, _choice.plank, (k) => _choice.copyWith(plank: k)),
        const H2('벽지'),
        _options(wallSkins, _choice.wall, (k) => _choice.copyWith(wall: k)),
        const H2('벽'),
        _options(frameSkins, _choice.frame, (k) => _choice.copyWith(frame: k)),
        Padding(
          padding: const EdgeInsets.only(top: Space.l),
          child: Text('선반·벽지·벽 색은 바로 바뀌어요. 책과 기록은 그대로예요.', style: AppType.sub),
        ),
      ],
    );
  }
}
