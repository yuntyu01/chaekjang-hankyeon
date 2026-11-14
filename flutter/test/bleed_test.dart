// 내용 폭 밖으로 넓히기(Bleed): 화면 끝까지 그리고, 화면 틀(Screen) 직속이면 넓힌 자리(양옆 여백)도 누를 수 있어야 한다.
// 다른 줄은 여전히 양옆 24 안쪽. 왼쪽 글자 링크는 여백 없이 글자 폭만큼 왼쪽에
import 'package:chaekjang/ui/kit.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void phone(WidgetTester t) {
  t.view.physicalSize = const Size(1080, 2340);
  t.view.devicePixelRatio = 2.625;
  addTearDown(t.view.reset);
}

void main() {
  for (final scroll in [false, true]) {
    testWidgets('Bleed: 화면 폭, 넓힌 자리도 눌린다(scroll $scroll)', (t) async {
      phone(t);
      var taps = 0;
      await t.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Screen(back: false, scroll: scroll, children: [
            const SizedBox(key: Key('row'), height: 20),
            Bleed(
              child: GestureDetector(
                key: const Key('band'),
                behavior: HitTestBehavior.opaque,
                onTap: () => taps++,
                child: const SizedBox(height: 40),
              ),
            ),
            TextLink(key: const Key('link'), label: '고치기', start: true, onPress: () {}),
            if (!scroll) const Expanded(child: Bleed(child: SizedBox.expand(key: Key('fill')))),
          ]),
        ),
      ));
      final screen = t.view.physicalSize.width / t.view.devicePixelRatio;
      final band = t.getRect(find.byKey(const Key('band')));
      expect(band.left, 0);
      expect(band.width, screen);
      await t.tapAt(Offset(5, band.center.dy)); // 왼쪽 여백 안
      await t.tapAt(Offset(screen - 5, band.center.dy)); // 오른쪽 여백 안
      expect(taps, 2);
      expect(t.getRect(find.byKey(const Key('row'))).left, 24);
      final link = t.getRect(find.text('고치기'));
      expect(link.left, 24);
      expect(link.width, lessThan(100));
      // 줄의 빈 오른쪽은 링크가 아니다
      final before = taps;
      await t.tapAt(Offset(300, link.center.dy));
      expect(taps, before);
      if (!scroll) expect(t.getRect(find.byKey(const Key('fill'))).width, screen);
    });
  }

  testWidgets('Bleed: 다른 줄 속에 있어도 화면 폭으로 그린다', (t) async {
    phone(t);
    await t.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Screen(back: false, children: [
          Padding(padding: EdgeInsets.only(top: 8), child: Bleed(child: SizedBox(key: Key('inner'), height: 10))),
        ]),
      ),
    ));
    final screen = t.view.physicalSize.width / t.view.devicePixelRatio;
    final r = t.getRect(find.byKey(const Key('inner')));
    expect(r.left, 0);
    expect(r.width, screen);
  });
}
