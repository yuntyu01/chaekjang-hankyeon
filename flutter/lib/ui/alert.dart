// 앱이 직접 그리는 확인창(지금 앱 ui/alert.tsx): 제목·본문·버튼. 버튼 하나면 꽉 찬 주요 버튼, 둘이면 나란히(취소는 왼쪽 회색 선),
// 셋 이상이면 세로로 쌓고 취소는 맨 아래 글자 버튼. 바깥 누르기·뒤로 가기는 취소 버튼이 있을 때만 취소로 닫는다(한 버튼 안내는 확인으로)
library;

import 'package:flutter/material.dart';

import 'keep_all.dart';
import 'kit.dart';
import 'theme.dart';

enum AlertStyle { normal, cancel, destructive }

class AlertButton {
  const AlertButton(this.text, {this.onPress, this.style = AlertStyle.normal});
  final String text;
  final VoidCallback? onPress;
  final AlertStyle style;
}

/// stacked: 버튼을 늘 세로로 쌓는다(지금 앱 Dialog처럼: 주요 → 보조 → 맨 아래 글자 버튼)
Future<void> appAlert(BuildContext context, String title, [String? message, List<AlertButton>? buttons, bool cancelable = true, bool stacked = false]) async {
  final list = buttons == null || buttons.isEmpty ? const [AlertButton('확인')] : buttons;
  final cancel = list.where((b) => b.style == AlertStyle.cancel).firstOrNull;
  final dismissTo = cancel ?? (list.length == 1 ? list.first : null);
  final picked = await showGeneralDialog<AlertButton>(
    context: context,
    barrierDismissible: cancelable && dismissTo != null,
    barrierLabel: dismissTo?.text ?? '닫기',
    barrierColor: AppColors.scrim,
    transitionDuration: const Duration(milliseconds: 180),
    transitionBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: child),
    pageBuilder: (ctx, _, _) {
      final actions = list.where((b) => b != cancel).toList();
      Widget btn(AlertButton b, String kind) => Btn(label: b.text, kind: kind, onPress: () => Navigator.pop(ctx, b));
      final body = list.length <= 2 && !stacked
          ? Row(children: [
              if (cancel != null) Expanded(child: btn(cancel, 'secondary')),
              for (final (i, b) in actions.indexed) ...[
                if (cancel != null || i > 0) const SizedBox(width: Space.s),
                Expanded(child: btn(b, b.style == AlertStyle.destructive ? 'danger' : i == 0 && cancel == null && actions.length > 1 ? 'secondary' : 'primary')),
              ],
            ])
          : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final (i, b) in actions.indexed) ...[
                if (i > 0) const SizedBox(height: Space.s),
                btn(b, b.style == AlertStyle.destructive ? 'danger' : i == 0 ? 'primary' : 'secondary'),
              ],
              if (cancel != null) ...[const SizedBox(height: Space.s), btn(cancel, 'ghost')],
            ]);
      return PopScope(
        canPop: dismissTo != null,
        onPopInvokedWithResult: (didPop, _) {},
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(Space.page),
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: 400, maxHeight: MediaQuery.sizeOf(ctx).height * 0.86),
                child: Material(
                  color: AppColors.bg,
                  borderRadius: BorderRadius.circular(Shape.dialog),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(Space.page, Space.page + 2, Space.page, Space.page),
                    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Flexible(
                        child: SingleChildScrollView(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Semantics(header: true, child: Text(keepAll(title), style: AppType.heading)),
                            if (message != null && message.isNotEmpty)
                              Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(keepAll(message), style: AppType.body.copyWith(color: AppColors.inkSoft))),
                          ]),
                        ),
                      ),
                      const SizedBox(height: Space.xl),
                      body,
                    ]),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
  (picked ?? dismissTo)?.onPress?.call();
}
