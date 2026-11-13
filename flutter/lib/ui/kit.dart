// 공용 화면 부품: 화면 틀·버튼·칩·목록 줄·전환 칸·거르기 단추·하단 시트·빈 화면·대체 표지. 지금 앱 ui/kit.tsx를 옮긴 것(값·모양 그대로).
// 2026-11 토스·당근 종합 규칙: 흰 바탕, 회색 상자 안 회색 상자 금지, 주요 버튼만 갈색으로 채움, 누르는 동안 0.55로 옅어짐
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../gen/lucide.g.dart';
import '../services/cover_cache.dart';
import '../store/mini_timer_store.dart';
import '../store/reading_store.dart';
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
  const LucideIcon(this.name, {super.key, this.size = 22, this.color = AppColors.ink, this.stroke = 1.6, this.fill});
  final String name;
  final double size;
  final Color color;
  final double stroke;
  /// 채움 색(없으면 선만)
  final Color? fill;

  @override
  Widget build(BuildContext context) {
    final svg = lucideSvg[name] ?? lucideSvg['X']!;
    String hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
    // 지금 앱 lucide는 굵기를 24칸 기준으로 준다(크기를 바꿔도 굵기는 칸 비율)
    var markup = svg.replaceAll('{c}', hex(color)).replaceAll('{w}', '$stroke');
    if (fill != null) markup = markup.replaceFirst('fill="none"', 'fill="${hex(fill!)}"');
    return SvgPicture.string(markup, width: size, height: size);
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
                // 지금 앱 marginRight −10·marginTop −6: 자리째 위로 당긴다(머리줄 높이도 6 줄어든다)
                if (right != null) Transform.translate(offset: const Offset(10, 0), child: PullUp(dy: 6, child: right!)),
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
    // 스크롤하지 않는 화면: 본문이 남은 높이를 다 쓴다(안에서 목록이 Expanded로 스크롤)
    final fixed = Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: contentMax + Space.page * 2),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: pad),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [?largeTitle, ...children]),
        ),
      ),
    );
    // 독서 중이면 작은 타이머에 마지막 내용이 가리지 않게 아래를 더 비운다
    final body = scroll
        ? ListenableBuilder(
            listenable: ReadingStore.instance,
            builder: (context, _) => SingleChildScrollView(
              padding: EdgeInsets.only(
                  bottom: Space.section + bottomPad + (ReadingStore.instance.active != null ? miniTimerSpace : 0) + (footer != null ? 0 : insets.bottom)),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              child: content,
            ),
          )
        : fixed;
    // Material: 글자 기본 모양·잉크 효과의 바탕(밀어 넣은 화면에서도 글자 밑에 노란 줄이 생기지 않게)
    return Material(
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
                child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: contentMax), child: SizedBox(width: double.infinity, child: footer))),
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

/// 실제 표지(도서 이미지·내가 찍은 사진). 없거나 못 읽으면 책 색 대체 표지(제목, 명조).
/// 원격 그림은 표지 캐시로 읽는다(오프라인에서도 한 번 본 표지는 보인다)
class RealCover extends StatefulWidget {
  const RealCover({super.key, this.uri, required this.title, required this.color, required this.width, this.ratio = 0.68});
  final String? uri;
  final String title;
  final String color;
  final double width;
  final double ratio;

  @override
  State<RealCover> createState() => _RealCoverState();
}

class _RealCoverState extends State<RealCover> {
  ui.Image? _img;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(RealCover old) {
    super.didUpdateWidget(old);
    if (old.uri != widget.uri) {
      _img = null;
      _failed = false;
      _load();
    }
  }

  Future<void> _load() async {
    final u = widget.uri;
    if (u == null) return;
    final img = coverInMemory(u) ?? await loadCover(u);
    if (!mounted || u != widget.uri) return;
    setState(() => img == null ? _failed = true : _img = img);
  }

  @override
  Widget build(BuildContext context) {
    final w = widget.width, h = w / widget.ratio;
    if (widget.uri == null || _failed) {
      return Semantics(
        label: '${widget.title} 대체 표지',
        child: Container(
          width: w,
          height: h,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: _hexColor(widget.color), borderRadius: BorderRadius.circular(3)),
          alignment: Alignment.center,
          child: Text(widget.title,
              maxLines: 4,
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: AppFonts.serif, fontSize: math.max(10, w / 8), color: _isLight(widget.color) ? AppColors.inkSoft : AppColors.onAccent)),
        ),
      );
    }
    return Semantics(
      label: '${widget.title} 표지',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: Container(width: w, height: h, color: AppColors.surface, child: _img == null ? null : RawImage(image: _img, fit: BoxFit.cover, width: w, height: h)),
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
Future<T?> showSheet<T>(BuildContext context, {String? title, String? description, required WidgetBuilder builder, bool scroll = false, double? maxHeight, bool fit = false}) {
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
        // maxHeight: 화면 높이에 대한 비율(긴 목록 시트)
        constraints: maxHeight == null ? null : BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * maxHeight),
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
            // fit: 내용이 스스로 스크롤하는 시트(목록+아래 단추): 남은 높이 안에 맞춘다
            if (scroll) Flexible(child: SingleChildScrollView(child: body)) else if (fit) Flexible(child: body) else body,
          ],
        ),
      );
    },
  );
}

/// 밑줄 탭(2026-11-05 시안, 색은 우리 것): 글자 폭대로 두고 탭 사이를 같게 벌린다. 고른 칸은 굵은 본문색 + 글자 폭 테마색 밑줄(3, 둥근 끝).
/// fill: 칸을 똑같이 나눠 화면 끝까지, 고른 칸은 굵은 본문색 + 칸 폭 밑줄(2), 아래 얇은 선
class Tabs<T> extends StatelessWidget {
  const Tabs({super.key, required this.items, required this.value, required this.onChange, this.fill = false, this.gap});
  final List<({T id, String label})> items;
  final T value;
  final ValueChanged<T> onChange;
  final bool fill;
  /// 탭 사이(없으면 양 끝에 맞춰 벌린다)
  final double? gap;

  @override
  Widget build(BuildContext context) {
    Widget tab(({T id, String label}) it) {
      final on = it.id == value;
      final text = fill
          ? TextStyle(fontFamily: AppFonts.uiBold, fontSize: 16, height: 22 / 16, color: on ? AppColors.ink : AppColors.inkSoft)
          : AppType.row.copyWith(fontSize: 17, height: 24 / 17, color: on ? AppColors.ink : AppColors.inkSoft, fontFamily: on ? AppType.button.fontFamily : AppFonts.ui);
      return Semantics(
        selected: on,
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onChange(it.id),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Space.touch),
            child: Padding(
              padding: EdgeInsets.only(top: fill ? 10 : 4),
              child: IntrinsicWidth(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(it.label, maxLines: 1, textAlign: TextAlign.center, style: text, textScaler: MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.25)),
                    Container(
                      height: fill ? 2 : 3,
                      margin: EdgeInsets.only(top: fill ? 10 : 7),
                      decoration: BoxDecoration(
                        color: on ? (fill ? AppColors.ink : AppColors.accent) : Colors.transparent,
                        borderRadius: BorderRadius.circular(fill ? 0 : 2),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    if (fill) {
      return DecoratedBox(
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.line, width: 0.5))),
        child: Row(children: [for (final it in items) Expanded(child: tab(it))]),
      );
    }
    return Row(
      mainAxisAlignment: gap == null ? MainAxisAlignment.spaceBetween : MainAxisAlignment.start,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (i, it) in items.indexed) ...[if (i > 0 && gap != null) SizedBox(width: gap), tab(it)],
      ],
    );
  }
}

/// 필터 아이콘: 누르면 필터 시트. 걸러진 상태면 테마색 점
class FilterIcon extends StatelessWidget {
  const FilterIcon({super.key, required this.onPress, this.active = false});
  final VoidCallback onPress;
  final bool active;

  @override
  Widget build(BuildContext context) => IconBtn(
        label: active ? '필터, 걸러진 상태' : '필터',
        onPress: onPress,
        child: SizedBox(
          width: Space.touch,
          height: Space.touch,
          child: Stack(children: [
            const Center(child: LucideIcon('SlidersHorizontal', size: 22)),
            if (active)
              Positioned(
                top: 9,
                right: 7,
                child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: AppColors.accent, shape: BoxShape.circle)),
              ),
          ]),
        ),
      );
}

/// 필터 시트 묶음: 묶음 이름은 진한 글씨, 첫 묶음 말고는 위에 선
class FilterGroup extends StatelessWidget {
  const FilterGroup({super.key, required this.title, required this.children, this.first = false});
  final String title;
  final List<Widget> children;
  final bool first;

  @override
  Widget build(BuildContext context) => Container(
        margin: EdgeInsets.only(top: first ? 0 : Space.m),
        padding: EdgeInsets.only(top: first ? 0 : Space.l),
        decoration: first ? null : const BoxDecoration(border: Border(top: BorderSide(color: AppColors.line, width: 1))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(padding: const EdgeInsets.only(bottom: Space.xs), child: Semantics(header: true, child: Text(title, style: AppType.rowStrong))),
            ...children,
          ],
        ),
      );
}

/// 필터 항목: 고른 항목만 진한 글씨와 체크. chevron은 다른 시트로 넘어가는 항목, right는 스위치 등
class FilterOption extends StatelessWidget {
  const FilterOption({super.key, required this.label, this.sub, this.selected = false, this.chevron = false, this.right, this.onPress});
  final String label;
  final String? sub;
  final bool selected;
  final bool chevron;
  final Widget? right;
  final VoidCallback? onPress;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        selected: selected,
        child: Pressable(
          onPress: onPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 50),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.row.copyWith(color: selected ? AppColors.ink : AppColors.inkSoft, fontFamily: selected ? AppFonts.uiBold : AppFonts.ui)),
                  if (sub != null) Text(sub!, style: AppType.caption),
                ]),
              ),
              const SizedBox(width: Space.m),
              right ??
                  (selected
                      ? const LucideIcon('Check', size: 20, color: AppColors.accent, stroke: 2.2)
                      : chevron
                          ? const LucideIcon('ChevronRight', size: 22, color: AppColors.inkFaint)
                          : const SizedBox.shrink()),
            ]),
          ),
        ),
      );
}

/// 검색창: 돋보기 + 입력 + 지우기(입력이 있을 때)
class SearchField extends StatefulWidget {
  const SearchField({super.key, required this.value, required this.onChange, this.placeholder, this.label, this.autofocus = false, this.onSubmit, this.busy = false});
  final String value;
  final ValueChanged<String> onChange;
  final String? placeholder;
  final String? label;
  final bool autofocus;
  final VoidCallback? onSubmit;
  final bool busy;

  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> {
  late final _c = TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(SearchField old) {
    super.didUpdateWidget(old);
    if (widget.value != _c.text) _c.text = widget.value;
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Container(
        constraints: const BoxConstraints(minHeight: 52),
        padding: const EdgeInsets.only(right: 2),
        decoration: BoxDecoration(color: AppColors.input, borderRadius: BorderRadius.circular(Shape.input)),
        child: Row(children: [
          Semantics(
            button: widget.onSubmit != null,
            label: widget.onSubmit != null ? '검색' : null,
            child: Pressable(
              onPress: widget.onSubmit,
              child: const SizedBox(width: Space.touch + 4, height: 46, child: Center(child: LucideIcon('Search', size: 22, color: AppColors.inkSoft))),
            ),
          ),
          Expanded(
            child: Semantics(
              label: widget.label,
              textField: true,
              child: TextField(
                controller: _c,
                autofocus: widget.autofocus,
                onChanged: widget.onChange,
                onSubmitted: (_) => widget.onSubmit?.call(),
                textInputAction: widget.onSubmit != null ? TextInputAction.search : TextInputAction.done,
                style: AppType.input,
                cursorColor: AppColors.accent,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  hintText: widget.placeholder,
                  hintStyle: AppType.input.copyWith(color: AppColors.inkFaint),
                ),
              ),
            ),
          ),
          if (widget.busy)
            const SizedBox(width: Space.touch, child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.inkSoft))))
          else if (widget.value.isNotEmpty)
            Semantics(
              button: true,
              label: '검색어 지우기',
              child: Pressable(
                onPress: () => widget.onChange(''),
                child: SizedBox(
                  width: Space.touch + 4,
                  height: 46,
                  child: Center(
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: const BoxDecoration(color: AppColors.inkFaint, shape: BoxShape.circle),
                      child: const Center(child: LucideIcon('X', size: 14, color: AppColors.bg, stroke: 2.2)),
                    ),
                  ),
                ),
              ),
            ),
        ]),
      );
}


/// 음수 위 여백(지금 앱 marginTop −dy): 자식을 dy만큼 위로 그리고, 차지하는 높이도 dy만큼 줄인다
class PullUp extends SingleChildRenderObjectWidget {
  const PullUp({super.key, required this.dy, required Widget super.child});
  final double dy;

  @override
  RenderObject createRenderObject(BuildContext context) => RenderPullUp(dy);

  @override
  void updateRenderObject(BuildContext context, RenderPullUp renderObject) => renderObject.dy = dy;
}

class RenderPullUp extends RenderShiftedBox {
  RenderPullUp(this._dy) : super(null);
  double _dy;
  set dy(double v) {
    if (v == _dy) return;
    _dy = v;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final c = child!;
    c.layout(constraints.loosen(), parentUsesSize: true);
    (c.parentData! as BoxParentData).offset = Offset(0, -_dy);
    size = constraints.constrain(Size(c.size.width, math.max(0, c.size.height - _dy)));
  }
}

/// 고르는 블록(서로 바꿔 고르는 선택지: 분위기·목표 시간). 모서리 14, 안쪽 16. 흰 바탕 + 얇은 테두리, 고르면 갈색 테두리 + 작은 체크
class Choice extends StatelessWidget {
  const Choice({super.key, required this.label, required this.selected, required this.onPress, this.sub, this.compact = false, this.child});
  final String label;
  final String? sub;
  final bool selected, compact;
  final VoidCallback onPress;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    Widget check({double size = 20, bool ring = false}) => Container(
          width: size,
          height: size,
          decoration: BoxDecoration(color: AppColors.accent, shape: BoxShape.circle, border: ring ? Border.all(color: AppColors.bg, width: 2) : null),
          child: const Center(child: LucideIcon('Check', size: 12, color: AppColors.onAccent, stroke: 3)),
        );
    final wide = !compact && sub == null;
    return Semantics(
      button: true,
      selected: selected,
      label: [label, ?sub].join(', '),
      excludeSemantics: true,
      child: _ChoiceBox(
        selected: selected,
        onPress: onPress,
        compact: compact,
        child: Stack(clipBehavior: Clip.none, children: [
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            ?child,
            Padding(
              padding: EdgeInsets.only(right: wide && selected ? 28 : 0),
              child: Text(label, textAlign: compact ? TextAlign.center : TextAlign.left, style: AppType.button.copyWith(color: AppColors.ink)),
            ),
            if (sub != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub!, textAlign: compact ? TextAlign.center : TextAlign.left, style: AppType.caption)),
          ]),
          // 넓은 한 줄은 오른쪽 세로 가운데, 좁은 칸은 모서리에 걸쳐, 설명이 있는 칸은 오른쪽 위
          if (selected)
            wide
                ? Positioned(top: 0, bottom: 0, right: 0, child: Center(child: check()))
                : compact
                    ? Positioned(top: -12 - 7, right: -8 - 7, child: check(size: 22, ring: true))
                    : Positioned(top: -16 + 8, right: -16 + 8, child: check()),
        ]),
      ),
    );
  }
}

class _ChoiceBox extends StatefulWidget {
  const _ChoiceBox({required this.selected, required this.onPress, required this.compact, required this.child});
  final bool selected, compact;
  final VoidCallback onPress;
  final Widget child;

  @override
  State<_ChoiceBox> createState() => _ChoiceBoxState();
}

class _ChoiceBoxState extends State<_ChoiceBox> {
  bool _down = false;

  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: widget.onPress,
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: widget.compact ? const EdgeInsets.symmetric(vertical: 12, horizontal: 8) : const EdgeInsets.all(16),
          alignment: Alignment.centerLeft,
          decoration: BoxDecoration(
            color: _down && !widget.selected ? AppColors.surface : AppColors.bg,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: widget.selected ? AppColors.accent : AppColors.line, width: 1.5),
          ),
          child: widget.child,
        ),
      );
}

/// 밤 장면 위 밝은 색(독서 타이머를 접었을 때)
abstract final class NightColors {
  static const ink = Color(0xFFF6EFE6);
  static const inkSoft = Color.fromRGBO(246, 239, 230, 0.78);
  static const line = Color.fromRGBO(246, 239, 230, 0.22);
  static const shade = Color.fromRGBO(16, 13, 11, 0.28);
  static const fade = Color(0xFF100D0B);
}

/// 막대 조절(소리 크기): 누른 곳부터 끌어 바꾸고, 손을 떼면 onCommit. dim이면 켜진 쪽·손잡이를 회색으로(값은 지키되 꺼진 상태).
/// night: 어두운 장면 위(밝은 크림색 막대와 손잡이)
class AppSlider extends StatefulWidget {
  const AppSlider({super.key, required this.value, required this.onCommit, required this.label, this.onChange, this.valueText, this.dim = false, this.night = false});
  final double value;
  final ValueChanged<double>? onChange;
  final ValueChanged<double> onCommit;
  final String label;
  final String? valueText;
  final bool dim, night;

  @override
  State<AppSlider> createState() => _AppSliderState();
}

class _AppSliderState extends State<AppSlider> {
  static const _pad = 14.0;
  double _last = 0;

  double _at(double x, double w) {
    final span = w - _pad * 2;
    return span > 0 ? ((x - _pad) / span).clamp(0.0, 1.0) : _last;
  }

  @override
  Widget build(BuildContext context) {
    final pct = (widget.value * 100).round();
    final fill = widget.night ? (widget.dim ? NightColors.line : NightColors.ink) : widget.dim ? AppColors.inkFaint : AppColors.accent;
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth, span = math.max(0.0, w - _pad * 2);
      return Semantics(
        slider: true,
        label: widget.label,
        value: widget.valueText ?? '$pct%',
        increasedValue: '${math.min(100, pct + 10)}%',
        decreasedValue: '${math.max(0, pct - 10)}%',
        onIncrease: () => widget.onCommit(math.min(1, ((widget.value + 0.1) * 10).round() / 10)),
        onDecrease: () => widget.onCommit(math.max(0, ((widget.value - 0.1) * 10).round() / 10)),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onHorizontalDragStart: (d) => widget.onChange?.call(_last = _at(d.localPosition.dx, w)),
          onHorizontalDragUpdate: (d) => widget.onChange?.call(_last = _at(d.localPosition.dx, w)),
          onHorizontalDragEnd: (_) => widget.onCommit(_last),
          onTapDown: (d) => widget.onChange?.call(_last = _at(d.localPosition.dx, w)),
          onTapUp: (_) => widget.onCommit(_last),
          child: SizedBox(
            height: 44,
            width: w,
            child: Stack(children: [
              Positioned(left: _pad, right: _pad, top: 19, height: 6, child: _bar(widget.night ? const Color.fromRGBO(246, 239, 230, 0.32) : AppColors.track)),
              Positioned(left: _pad, top: 19, height: 6, width: span * widget.value, child: _bar(fill)),
              Positioned(
                left: _pad + span * widget.value - 12,
                top: 10,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: widget.night ? NightColors.ink : AppColors.white,
                    border: widget.night ? null : Border.all(color: fill, width: 2),
                    boxShadow: const [Shape.floatShadow],
                  ),
                ),
              ),
            ]),
          ),
        ),
      );
    });
  }

  Widget _bar(Color c) => DecoratedBox(decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3)));
}

/// 입력칸 이름 나누기: '쪽수 (선택)', '메모 (선택, 설명)' → 이름·'선택'/'필수'·설명
({String name, String? tag, String? note}) splitLabel(String label) {
  final m = RegExp(r'^(.+?) \((.+)\)$').firstMatch(label);
  if (m == null) return (name: label, tag: null, note: null);
  final parts = m[2]!.split(', ');
  final tag = parts.first == '선택' || parts.first == '필수' ? parts.removeAt(0) : null;
  return (name: m[1]!, tag: tag, note: parts.isEmpty ? null : parts.join(', '));
}

class _LabelRow extends StatelessWidget {
  const _LabelRow(this.name, this.tag);
  final String name;
  final String? tag;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: Space.s),
        child: Wrap(crossAxisAlignment: WrapCrossAlignment.end, spacing: 8, children: [
          Text(name, style: AppType.label),
          if (tag != null) Text(tag!, style: AppType.caption.copyWith(color: AppColors.inkSoft)),
        ]),
      );
}

/// 입력칸: 입력칸색 단색 바탕, 테두리 없음, 누르면 갈색 테두리. 이름은 위에, 단위('쪽')는 칸 안 오른쪽, 도움말·오류는 아래
class Field extends StatefulWidget {
  const Field({super.key, required this.label, required this.value, required this.onChange, this.hint, this.error, this.unit, this.placeholder, this.multiline = false, this.number = false, this.minHeight});
  final String label;
  final String value;
  final ValueChanged<String> onChange;
  final String? hint, error, unit, placeholder;
  final bool multiline, number;
  final double? minHeight;

  @override
  State<Field> createState() => _FieldState();
}

class _FieldState extends State<Field> {
  late final _c = TextEditingController(text: widget.value);
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void didUpdateWidget(Field old) {
    super.didUpdateWidget(old);
    if (widget.value != _c.text) _c.text = widget.value;
  }

  @override
  void dispose() {
    _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = splitLabel(widget.label);
    final placeholder = widget.placeholder ?? l.note;
    final help = widget.placeholder != null && l.note != null ? l.note : widget.hint;
    final border = widget.error != null ? AppColors.danger : _focus.hasFocus ? AppColors.accent : AppColors.input;
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.xl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _LabelRow(l.name, l.tag),
        Stack(children: [
          Container(
            constraints: BoxConstraints(minHeight: widget.minHeight ?? (widget.multiline ? 110 : 56)),
            decoration: BoxDecoration(color: AppColors.input, borderRadius: BorderRadius.circular(Shape.input), border: Border.all(color: border)),
            child: Semantics(
              label: widget.label,
              textField: true,
              child: TextField(
                controller: _c,
                focusNode: _focus,
                onChanged: widget.onChange,
                maxLines: widget.multiline ? null : 1,
                keyboardType: widget.number ? TextInputType.number : (widget.multiline ? TextInputType.multiline : TextInputType.text),
                textInputAction: TextInputAction.done,
                style: AppType.input.copyWith(height: widget.multiline ? 25 / 16 : null),
                cursorColor: AppColors.accent,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.fromLTRB(16, widget.multiline ? 14 : 16, widget.unit != null ? 44 : 16, 16),
                  hintText: placeholder,
                  hintStyle: AppType.input.copyWith(color: AppColors.inkFaint),
                ),
              ),
            ),
          ),
          if (widget.unit != null)
            Positioned(right: 16, top: 0, bottom: 0, child: IgnorePointer(child: Center(child: Text(widget.unit!, style: AppType.input.copyWith(color: AppColors.inkSoft))))),
        ]),
        if (widget.error != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(widget.error!, style: AppType.caption.copyWith(color: AppColors.danger)))
        else if (help != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(help, style: AppType.caption)),
      ]),
    );
  }
}

/// 고르는 칸(누르면 시트·화면에서 고른다): 입력칸과 같은 모양 + 오른쪽 화살표
class SelectField extends StatelessWidget {
  const SelectField({super.key, required this.label, required this.placeholder, required this.onPress, this.value, this.sub, this.disabled = false});
  final String label, placeholder;
  final String? value, sub;
  final VoidCallback onPress;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final l = splitLabel(label);
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.xl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _LabelRow(l.name, l.tag),
        Semantics(
          button: true,
          enabled: !disabled,
          label: '$label, ${value ?? placeholder}',
          excludeSemantics: true,
          child: GestureDetector(
            onTap: disabled ? null : onPress,
            child: Container(
              constraints: const BoxConstraints(minHeight: 52),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
              decoration: BoxDecoration(color: AppColors.input, borderRadius: BorderRadius.circular(Shape.input)),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(value ?? placeholder, maxLines: 2, style: AppType.input.copyWith(color: value != null ? AppColors.ink : AppColors.inkFaint)),
                    if (sub != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub!, maxLines: 1, style: AppType.caption)),
                  ]),
                ),
                if (!disabled) ...[const SizedBox(width: 8), const LucideIcon('ChevronRight', size: 20, color: AppColors.inkSoft)],
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}

/// 글자 버튼(밑줄 없이 굵은 갈색 = 이어서 할 일, 회색 = 조심스러운 일)
class TextLink extends StatelessWidget {
  const TextLink({super.key, required this.label, required this.onPress, this.soft = false, this.disabled = false});
  final String label;
  final VoidCallback onPress;
  final bool soft, disabled;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        enabled: !disabled,
        label: label,
        excludeSemantics: true,
        child: Opacity(
          opacity: disabled ? 0.4 : 1,
          child: Center(
            child: Pressable(
              onPress: disabled ? null : onPress,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: Space.touch),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Center(widthFactor: 1, child: Text(label, style: AppType.sub.copyWith(fontFamily: AppFonts.uiBold, color: soft ? AppColors.inkSoft : AppColors.accent))),
                ),
              ),
            ),
          ),
        ),
      );
}
