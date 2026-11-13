// 공용 부품이 넘치거나 깨지지 않고 그려지는지(폰 폭 411·큰 글자 1.3배)
import 'package:chaekjang/ui/kit.dart';
import 'package:chaekjang/ui/theme.dart';
import 'package:flutter/material.dart' hide Chip;
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final scale in [1.0, 1.3]) {
    testWidgets('화면 틀·목록·전환 칸·칩·빈 화면(글자 $scale배)', (t) async {
      t.view.physicalSize = const Size(1080, 2340);
      t.view.devicePixelRatio = 2.625;
      addTearDown(t.view.reset);
      var seg = 'month';
      await t.pumpWidget(MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(size: const Size(411, 891), textScaler: TextScaler.linear(scale)),
          child: Scaffold(
            body: Screen(back: false, title: '기록', children: [
              StatefulBuilder(
                builder: (ctx, set) => Segmented<String>(
                  items: const [('month', '월'), ('year', '연도')],
                  value: seg,
                  onChange: (v) => set(() => seg = v),
                ),
              ),
              const H2('읽은 책', first: true),
              ListGroup(title: '묶음', children: [
                ListItem(label: '아주 긴 책 제목이 들어가도 줄을 넘겨 그린다 아주 긴 책 제목', sub: '저자', value: '1시간 20분', onPress: () {}, chevron: true),
                const ListItem(label: '두 번째 줄'),
              ]),
              const SectionBand(),
              Wrap(spacing: 8, children: [AppChip(label: '전체', on: true, onPress: () {}), AppChip(label: '읽는 중', onPress: () {}, color: AppColors.accent)]),
              FilterButton(label: '모든 책', onPress: () {}),
              FilterButton(label: '2026년', onPress: () {}, plain: true),
              Empty(title: '아직 기록이 없어요', body: '읽기 탭에서 시작해 보세요', action: '읽기 시작', onAction: () {}),
              const LucideIcon('Timer'),
            ]),
          ),
        ),
      ));
      expect(t.takeException(), isNull);
      expect(find.text('기록'), findsOneWidget);
      await t.tap(find.text('연도'));
      await t.pump();
      expect(seg, 'year');
    });
  }
}
