// 공용 화면 부품: 화면 틀·버튼·칩·목록 줄·전환 칸·거르기 단추·하단 시트·빈 화면·대체 표지. 지금 앱 ui/kit.tsx를 옮긴 것(값·모양 그대로).
// 2026-11 토스·당근 종합 규칙: 흰 바탕, 회색 상자 안 회색 상자 금지, 주요 버튼만 갈색으로 채움, 누르는 동안 0.55로 옅어짐
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../gen/lucide.g.dart';
import 'theme.dart';

/// 간격: 화면 좌우 24, 4·8·12·16·28·40 단계
abstract final class Space {
  static const page = 24.0, section = 40.0, group = 28.0, item = 12.0, tight = 8.0;
  static const xs = 4.0, s = 8.0, m = 12.0, l = 16.0, xl = 28.0, xxl = 40.0;
  static const row = 56.0, touch = 44.0;
}

/// 모양: 조작 요소 10, 칩 알약, 시트 20, 확인창 18
abstract final class Shape {
  static const button = 10.0, input = 10.0, sheet = 20.0, dialog = 18.0, tag = 6.0;
  static const floatShadow = BoxShadow(color: Color(0x1F191F28), offset: Offset(0, 4), blurRadius: 10);
}

/// 내용 폭 상한(태블릿에서 화면 끝까지 늘어나지 않게)
const contentMax = 640.0;
const _sheetMax = 560.0;

/// 선 아이콘(지금 앱 lucide 아이콘, 굵기 1.6)
class LucideIcon extends StatelessWidget {
  const LucideIcon(this.name, {super.key, this.size = 22, this.color = AppColors.ink, this.stroke = 1.6});
  final String name;
  final double size;
  final Color color;
  final double stroke;

  @override
  Widget build(BuildContext context) {
    final svg = lucideSvg[name] ?? lucideSvg['X']!;
    final hex = '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    // 지금 앱 lucide는 굵기를 24칸 기준으로 준다(크기를 바꿔도 굵기는 칸 비율)
    return SvgPicture.string(svg.replaceAll('{c}', hex).replaceAll('{w}', '$stroke'), width: size, height: size);
  }
}

/// 눌리는 동안 옅어지는 누를 것(바탕을 칠하지 않는 글자·아이콘·목록 줄)
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onPress, this.disabled = false, this.pressedOpacity = pressOpacity});
  final Widget child;
  final VoidCallback? onPress;
  final bool disabled;
  final double pressedOpacity;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final on = widget.onPress != null && !widget.disabled;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: on ? (_) => setState(() => _down = true) : null,
      onTapCancel: on ? () => setState(() => _down = false) : null,
      onTapUp: on ? (_) => setState(() => _down = false) : null,
      onTap: on ? widget.onPress : null,
      child: Opacity(opacity: _down ? widget.pressedOpacity : 1, child: widget.child),
    );
  }
}

/// 화면 틀: 위 안전 영역 + 머리줄(뒤로·가운데 제목·오른쪽 행동) + 스크롤 본문. 뒤로가 없는 화면(탭 첫 화면)은 제목을 왼쪽에 크게(책장 홈 머리줄과 같은 기준).
/// 뒤로가 있는 화면은 머리줄에 뒤로·행동만, 제목은 내용 맨 위 왼쪽에 크게(24 Bold). bottomPad: 떠 있는 하단바 등에 가리지 않게 더할 아래 여백
class Screen extends StatelessWidget {
  const Screen({
    super.key,
    required this.children,
    this.title,
    this.titleNote,
    this.subtitle,
    this.right,
    this.back = true,
    this.scroll = true,
    this.bottomPad = 0,
    this.footer,
    this.compact = false,
  });
  final List<Widget> children;
  final String? title;
  final String? titleNote;
  final String? subtitle;
  final Widget? right;
  final bool back;
  final bool scroll;
  final double bottomPad;
  final Widget? footer;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.paddingOf(context);
    final large = back && !compact && title != null;
    Widget tabHead() => Padding(
          padding: const EdgeInsets.fromLTRB(TabHeader.paddingH, TabHeader.paddingTop, TabHeader.paddingH, TabHeader.paddingBottom),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: TabHeader.minHeight - TabHeader.paddingTop - TabHeader.paddingBottom),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(header: true, child: Text(title ?? '', style: AppType.title)),
                      if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(subtitle!, style: AppType.sub)),
                    ],
                  ),
                ),
                if (right != null) Transform.translate(offset: const Offset(10, -6), child: right),
              ],
            ),
          ),
        );
    final largeTitle = large
        ? Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text.rich(TextSpan(text: title, style: AppType.title, children: [
                    if (titleNote != null) TextSpan(text: '  $titleNote', style: AppType.title.copyWith(fontFamily: AppFonts.ui, color: AppColors.inkSoft)),
                  ])),
                ),
                if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(subtitle!, style: AppType.sub)),
              ],
            ),
          )
        : null;
    const pad = Space.page;
    final content = Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: contentMax + Space.page * 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            // 탭 첫 화면 제목도 내용과 함께 올라간다(머리줄 고정 아님)
            if (!back && title != null && scroll) tabHead(),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: pad),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [?largeTitle, ...children],
              ),
            ),
          ],
        ),
      ),
    );
    final body = scroll
        ? SingleChildScrollView(
            padding: EdgeInsets.only(bottom: Space.section + bottomPad + (footer != null ? 0 : insets.bottom)),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: content,
          )
        : content;
    return ColoredBox(
      color: AppColors.bg,
      child: Padding(
        padding: EdgeInsets.only(top: insets.top),
        child: Column(
          children: [
            if (back)
              SizedBox(
                height: 60,
                child: Stack(
                  children: [
                    if (!large && title != null)
                      Positioned(
                        left: 64,
                        right: 64,
                        top: 4,
                        bottom: 0,
                        child: Center(child: Text(title!, style: AppType.navTitle, maxLines: 1, overflow: TextOverflow.ellipsis)),
                      ),
                    Positioned(
                      left: 8,
                      top: 4,
                      bottom: 0,
                      child: Center(
                        child: Semantics(
                          button: true,
                          label: '뒤로',
                          child: Pressable(
                            onPress: () => Navigator.maybePop(context),
                            child: const SizedBox(width: Space.touch, height: Space.touch, child: Center(child: LucideIcon('ChevronLeft', size: 28))),
                          ),
                        ),
                      ),
                    ),
                    if (right != null) Positioned(right: 10, top: 4, bottom: 0, child: Center(child: right)),
                  ],
                ),
              )
            else if (!scroll)
              tabHead(),
            Expanded(child: body),
            if (footer != null)
              Container(
                color: AppColors.bg,
                padding: EdgeInsets.fromLTRB(Space.page, 12, Space.page, 12 + insets.bottom),
                child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: contentMax), child: footer)),
              ),
          ],
        ),
      ),
    );
  }
}

/// 구역 제목
class H2 extends StatelessWidget {
  const H2(this.text, {super.key, this.first = false});
  final String text;
  final bool first;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: first ? Space.l : Space.section, bottom: Space.s),
        child: Semantics(header: true, child: Text(text, style: AppType.section)),
      );
}

/// 버튼: 주요(갈색 채움·흰 글자, 화면에 하나), 보조·삭제(흰 바탕 + 회색 선), 글자만. 크기 l 60·m 54·s 44
class Btn extends StatefulWidget {
  const Btn({super.key, required this.label, required this.onPress, this.kind = 'primary', this.size = 'm', this.disabled = false, this.busy = false, this.icon});
  final String label;
  final VoidCallback onPress;
  final String kind;
  final String size;
  final bool disabled;
  final bool busy;
  final Widget? icon;

  @override
  State<Btn> createState() => _BtnState();
}

class _BtnState extends State<Btn> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final primary = widget.kind == 'primary';
    final outlined = widget.kind == 'secondary' || widget.kind == 'danger';
    final off = widget.disabled || widget.busy;
    final ink = primary ? (widget.disabled ? AppColors.inkFaint : AppColors.onAccent) : widget.kind == 'danger' ? AppColors.danger : AppColors.ink;
    final pressed = _down && !off;
    final fill = primary
        ? (widget.disabled ? AppColors.line : pressed ? AppColors.accentPressed : AppColors.accent)
        : outlined
            ? (pressed ? AppColors.input : AppColors.bg)
            : (pressed ? AppColors.line : Colors.transparent);
    final h = switch (widget.size) { 'l' => 60.0, 's' => 44.0, _ => 54.0 };
    final small = widget.size == 's';
    return Semantics(
      button: true,
      label: widget.label,
      enabled: !off,
      child: GestureDetector(
        onTapDown: off ? null : (_) => setState(() => _down = true),
        onTapCancel: off ? null : () => setState(() => _down = false),
        onTapUp: off ? null : (_) => setState(() => _down = false),
        onTap: off ? null : widget.onPress,
        child: Opacity(
          opacity: !primary && widget.disabled ? 0.45 : 1,
          child: Container(
            constraints: BoxConstraints(minHeight: h),
            padding: EdgeInsets.symmetric(horizontal: small ? 16 : 20, vertical: small ? 10 : 14),
            decoration: BoxDecoration(
              color: fill,
              borderRadius: BorderRadius.circular(Shape.button),
              border: outlined ? Border.all(color: AppColors.line) : null,
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Opacity(
                  opacity: widget.busy ? 0 : 1,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (widget.icon != null) ...[widget.icon!, const SizedBox(width: 8)],
                      Flexible(
                        child: Text(widget.label,
                            maxLines: 2,
                            textAlign: TextAlign.center,
                            style: (small ? AppType.button.copyWith(fontSize: 16, height: 22 / 16) : AppType.button).copyWith(color: ink)),
                      ),
                    ],
                  ),
                ),
                if (widget.busy) SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: ink)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 아이콘 단추(누르는 자리 44)
class IconBtn extends StatelessWidget {
  const IconBtn({super.key, required this.label, required this.onPress, required this.child, this.circle = false, this.disabled = false});
  final String label;
  final VoidCallback onPress;
  final Widget child;
  final bool circle;
  final bool disabled;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        enabled: !disabled,
        child: Opacity(
          opacity: disabled ? 0.3 : 1,
          child: Pressable(
            onPress: disabled ? null : onPress,
            child: SizedBox(
              width: Space.touch,
              height: Space.touch,
              child: Center(
                child: circle
                    ? Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: AppColors.line)),
                        child: Center(child: child),
                      )
                    : child,
              ),
            ),
          ),
        ),
      );
}

/// 칩: 옅은 회색 알약, 고르면 갈색 채움·흰 글자. color가 있으면 앞에 색 점
class AppChip extends StatefulWidget {
  const AppChip({super.key, required this.label, this.on = false, this.onPress, this.color});
  final String label;
  final bool on;
  final VoidCallback? onPress;
  final Color? color;

  @override
  State<AppChip> createState() => _ChipState();
}

class _ChipState extends State<AppChip> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final bg = widget.on ? AppColors.chipOn : (_down ? AppColors.line : AppColors.input);
    return Semantics(
      button: true,
      selected: widget.on,
      child: GestureDetector(
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: widget.onPress,
        child: Container(
          constraints: const BoxConstraints(minHeight: 40),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999), border: Border.all(color: bg)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.color != null) ...[
                Container(width: 10, height: 10, decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle)),
                const SizedBox(width: 6),
              ],
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 230),
                child: Text(widget.label,
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub.copyWith(fontSize: 15, color: widget.on ? AppColors.onAccent : AppColors.ink)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 빈 화면: 제목(가운데) + 설명 + 행동 하나
class Empty extends StatelessWidget {
  const Empty({super.key, required this.title, this.body, this.action, this.onAction, this.actionKind = 'primary'});
  final String title;
  final String? body;
  final String? action;
  final VoidCallback? onAction;
  final String actionKind;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, textAlign: TextAlign.center, style: AppType.heading),
            if (body != null) Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(body!, textAlign: TextAlign.center, style: AppType.sub)),
            if (action != null && onAction != null)
              Padding(
                padding: const EdgeInsets.only(top: Space.xl),
                child: Center(child: ConstrainedBox(constraints: const BoxConstraints(minWidth: 160), child: Btn(label: action!, kind: actionKind, onPress: onAction!))),
              ),
          ],
        ),
      );
}

/// 불러오는 중
class Loading extends StatelessWidget {
  const Loading({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Column(children: [
          const CircularProgressIndicator(color: AppColors.accent),
          if (label != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(label!, style: AppType.sub)),
        ]),
      );
}

bool _isLight(String hex) {
  final m = RegExp(r'^#([\da-f]{6})$', caseSensitive: false).firstMatch(hex);
  if (m == null) return false;
  final c = m.group(1)!;
  final r = int.parse(c.substring(0, 2), radix: 16), g = int.parse(c.substring(2, 4), radix: 16), b = int.parse(c.substring(4, 6), radix: 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 180;
}

/// 실제 표지(도서 이미지). 없거나 못 읽으면 책 색 대체 표지(제목)
class RealCover extends StatelessWidget {
  const RealCover({super.key, this.uri, required this.title, required this.color, required this.width, this.ratio = 0.68});
  final String? uri;
  final String title;
  final String color;
  final double width;
  final double ratio;

  @override
  Widget build(BuildContext context) {
    final h = width / ratio;
    Widget fallback() => Container(
          width: width,
          height: h,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: _hexColor(color), borderRadius: BorderRadius.circular(3)),
          alignment: Alignment.center,
          child: Text(title,
              maxLines: 4,
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: AppFonts.ui, fontSize: math.max(10, width / 8), color: _isLight(color) ? AppColors.inkSoft : AppColors.onAccent)),
        );
    if (uri == null) return Semantics(label: '$title 대체 표지', child: fallback());
    return Semantics(
      label: '$title 표지',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: Image.network(uri!, width: width, height: h, fit: BoxFit.cover, errorBuilder: (_, _, _) => fallback()),
      ),
    );
  }
}

Color _hexColor(String hex) => Color(0xFF000000 | int.parse(hex.replaceAll('#', ''), radix: 16));

/// 목록 한 줄: 이름(+ 아래 설명) · 오른쪽 값 · 화살표(다른 화면으로 넘어가는 줄에만)
class ListItem extends StatelessWidget {
  const ListItem({super.key, required this.label, this.sub, this.value, this.onPress, this.danger = false, this.chevron = false, this.right, this.icon, this.selected});
  final String label;
  final String? sub;
  final String? value;
  final VoidCallback? onPress;
  final bool danger;
  final bool chevron;
  final Widget? right;
  final Widget? icon;
  final bool? selected;

  @override
  Widget build(BuildContext context) => Semantics(
        button: onPress != null,
        selected: selected,
        label: [label, ?sub, ?value].join(', '),
        child: Pressable(
          onPress: onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Space.row),
            child: Row(
              children: [
                if (icon != null) SizedBox(width: 32, child: Align(alignment: Alignment.centerLeft, child: icon)),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(top: sub != null ? 18 : 16, bottom: sub != null ? 18 : 16, right: right != null || value != null || chevron ? 12 : 0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(label, style: AppType.row.copyWith(color: danger ? AppColors.danger : null)),
                        if (sub != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(sub!, style: AppType.sub)),
                      ],
                    ),
                  ),
                ),
                if (value != null)
                  ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.55),
                    child: Padding(
                      padding: const EdgeInsets.only(left: 12),
                      child: Text(value!, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.right, style: AppType.sub.copyWith(fontSize: 15)),
                    ),
                  ),
                ?right,
                if (chevron) const Padding(padding: EdgeInsets.only(left: 6), child: LucideIcon('ChevronRight', size: 20, color: AppColors.inkSoft)),
              ],
            ),
          ),
        ),
      );
}

/// 전환 칸: 옅은 회색 칸(높이 44) 안에 고른 칸만 흰 바탕·옅은 그림자
class Segmented<T> extends StatelessWidget {
  const Segmented({super.key, required this.items, required this.value, required this.onChange});
  final List<(T, String)> items;
  final T value;
  final ValueChanged<T> onChange;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14)),
        child: Row(
          children: [
            for (final (id, label) in items)
              Expanded(
                child: Semantics(
                  selected: id == value,
                  button: true,
                  child: GestureDetector(
                    onTap: () => onChange(id),
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 44),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      alignment: Alignment.center,
                      decoration: id == value
                          ? BoxDecoration(
                              color: AppColors.bg,
                              borderRadius: BorderRadius.circular(11),
                              boxShadow: const [BoxShadow(color: Color(0x14191F28), offset: Offset(0, 4), blurRadius: 10)],
                            )
                          : null,
                      child: Text(label,
                          maxLines: 1,
                          style: TextStyle(
                            fontFamily: id == value ? AppFonts.uiBold : AppFonts.ui,
                            fontSize: 16,
                            height: 22 / 16,
                            color: id == value ? AppColors.ink : AppColors.inkSoft,
                          )),
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
}

/// 거르기 단추: 옅은 회색 알약(고르면 갈색), plain이면 글자 + 아래 꺾쇠만
class FilterButton extends StatelessWidget {
  const FilterButton({super.key, required this.label, required this.onPress, this.active = false, this.plain = false, this.icon});
  final String label;
  final VoidCallback onPress;
  final bool active;
  final bool plain;
  final Widget? icon;

  @override
  Widget build(BuildContext context) {
    final text = TextStyle(
      fontFamily: active ? AppFonts.uiBold : AppFonts.ui,
      fontSize: 16,
      height: 22 / 16,
      color: active && !plain ? AppColors.onAccent : AppColors.ink,
    );
    if (plain) {
      return Semantics(
        button: true,
        label: '$label, 바꾸기',
        child: Pressable(
          onPress: onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 32, maxWidth: 220),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: text)),
              const SizedBox(width: 4),
              const LucideIcon('ChevronDown', size: 16),
            ]),
          ),
        ),
      );
    }
    return Semantics(
      button: true,
      label: '$label, 바꾸기',
      child: GestureDetector(
        onTap: onPress,
        child: Container(
          constraints: const BoxConstraints(minHeight: 40, maxWidth: 220),
          padding: const EdgeInsets.only(left: 16, right: 12),
          decoration: BoxDecoration(color: active ? AppColors.chipOn : AppColors.surface, borderRadius: BorderRadius.circular(20)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[icon!, const SizedBox(width: 4)],
            Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: text)),
            const SizedBox(width: 4),
            LucideIcon('ChevronDown', size: 16, color: active ? AppColors.onAccent : AppColors.inkSoft),
          ]),
        ),
      ),
    );
  }
}

/// 목록 묶음(줄 사이에 선을 긋지 않는다): 묶음 이름은 작은 회색 글자
class ListGroup extends StatelessWidget {
  const ListGroup({super.key, required this.children, this.title});
  final List<Widget> children;
  final String? title;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null) Padding(padding: const EdgeInsets.only(bottom: 4), child: Semantics(header: true, child: Text(title!, style: AppType.caption))),
          ...children,
        ],
      );
}

/// 묶음 사이: 화면 끝까지 닿는 1dp 선
class SectionBand extends StatelessWidget {
  const SectionBand({super.key});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        // 내용 폭 안에서 양옆 여백(24)을 넘어 화면 끝까지
        child: SizedBox(
          height: 1,
          child: OverflowBox(
            minWidth: 0,
            maxWidth: double.infinity,
            child: Container(height: 1, width: MediaQuery.sizeOf(context).width, color: AppColors.sectionLine),
          ),
        ),
      );
}

class AppDivider extends StatelessWidget {
  const AppDivider({super.key});

  @override
  Widget build(BuildContext context) => Container(height: 0.5, color: AppColors.line);
}

/// 하단 시트: 어두운 덮개 + 위쪽만 둥근 판(손잡이·제목·설명·내용). 바깥을 누르거나 뒤로 가면, 손잡이를 끌어 내리면 닫힌다. 닫기 단추는 두지 않는다
Future<T?> showSheet<T>(BuildContext context, {String? title, String? description, required WidgetBuilder builder, bool scroll = false}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: AppColors.scrim,
    constraints: const BoxConstraints(maxWidth: _sheetMax),
    builder: (ctx) {
      final insets = MediaQuery.paddingOf(ctx);
      final body = builder(ctx);
      return Container(
        decoration: const BoxDecoration(
          color: AppColors.bg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(Shape.sheet)),
        ),
        padding: EdgeInsets.fromLTRB(Space.page, 8, Space.page, insets.bottom + Space.item),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: EdgeInsets.only(bottom: title != null ? 4 : 16),
                decoration: BoxDecoration(color: AppColors.track, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: Space.m),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: Space.touch),
                    child: Align(alignment: Alignment.centerLeft, child: Semantics(header: true, child: Text(title, style: AppType.heading))),
                  ),
                  if (description != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(description, style: AppType.sub)),
                ]),
              ),
            if (scroll) Flexible(child: SingleChildScrollView(child: body)) else body,
          ],
        ),
      );
    },
  );
}
