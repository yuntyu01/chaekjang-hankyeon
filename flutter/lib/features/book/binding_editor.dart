// 재장정 미리보기·편집(지금 앱 features/book/BindingEditor.tsx: 책 추가 확인 화면과 책 상세가 함께 쓴다). 2026-10-10 시안: 책 미리보기 → 그림·색상·재질 탭 → 그 탭의 옵션.
// 책장과 같은 책 그림·빛으로 같은 책을 돌려 보며 고른 장정이 바로 반영된다.
// - 그림: 기본 정면 장정 6종(3열) + '그림 없음'(단색 정면 또는 실제 표지). 그림을 골라도 책 색은 그대로
// - 색상: 표지 색(많은 순서) + 이 책 추천 색 + 모든 색. 고른 색에 테두리와 체크. 추천 장정으로 되돌리기
// - 재질: 고운 종이·린넨·매끈 무광·줄무늬 종이 + 책등 글자 배치
// 탭을 바꿔도 고르던 값은 그대로다(값은 부르는 쪽이 가진다). 고르면 사용자 장정(source 'custom')
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/binding_draft.dart';
import '../../domain/cover_artworks.dart';
import '../../domain/cover_url.dart' show coverAtSize, spineRatioOf;
import '../../domain/geometry.dart' show realDimensions;
import '../../domain/rebinding.dart';
import '../../domain/types.dart';

import '../../services/cover_colors.dart' show coverPalette;
import '../../ui/kit.dart';
import '../../ui/standalone_book.dart';
import '../../ui/theme.dart';

export '../../domain/binding_draft.dart';

const _layoutNames = {'spine_a': '기본', 'spine_b': '제목 낮게', 'spine_c': '무늬 낮게'};
const _materials = ['fine', 'linen', 'matte', 'laid'];
const _materialNames = {'fine': '고운 종이', 'linen': '린넨', 'matte': '매끈 무광', 'laid': '줄무늬 종이'};
const _ink = AppColors.accent; // 고른 것 표시(공통 강조색)

int _hex(String h) => int.tryParse(h.substring(1, 7), radix: 16) ?? 0x8F6E55;

/// 미리보기 책: 고른 장정으로 그린 책(실제 표지가 있고 그림을 고르지 않았으면 정면은 실제 표지)
Book previewBook({required String title, String? author, ({num widthMm, num heightMm})? size, num? pages, required BindingDraft binding, String? realCover}) {
  final w = (size?.widthMm ?? 128).toDouble(), h = (size?.heightMm ?? 188).toDouble();
  final art = isCoverArtworkId(binding.coverArtId);
  return Book(
    id: 'preview',
    title: title.isEmpty ? '제목' : title,
    author: author == null || author.isEmpty ? null : author,
    themeColor: _hex(binding.spineColor),
    coverAspectRatio: w / h,
    physical: Physical(widthMm: w, heightMm: h, pages: (pages ?? 250).toInt()),
    dims: realDimensions(w, h, (pages ?? 250).toInt(), spineRatioOf(realCover)),
    coverArtUri: art ? null : coverAtSize(realCover, 'XL'),
    coverUri: realCover,
    inkColor: binding.inkColor,
    titleTop: switch (binding.layout ?? 'spine_a') {
      'spine_b' => 0.16,
      'spine_c' => 0.11,
      _ => null,
    },
    material: binding.material,
    coverArtId: art ? binding.coverArtId : null,
  );
}

/// current: 아직 아무것도 고르지 않았을 때 보여 줄 지금 모습(책장에 놓인 그대로). 하나라도 고르면 고른 장정으로 바뀐다
class BindingEditor extends StatefulWidget {
  const BindingEditor({super.key, required this.title, this.author, this.size, this.pages, required this.value, required this.recommended, this.current, this.realCover, required this.onChange});
  final String title;
  final String? author, realCover;
  final ({num widthMm, num heightMm})? size;
  final num? pages;
  final BindingDraft value, recommended;
  final Book? current;
  final ValueChanged<BindingDraft> onChange;

  @override
  State<BindingEditor> createState() => _BindingEditorState();
}

class _BindingEditorState extends State<BindingEditor> {
  String _tab = 'art';
  List<String> _fromCover = const [];

  @override
  void initState() {
    super.initState();
    // 표지에서 많은 색 순서(표지가 없거나 못 읽으면 빈 목록이라 줄이 보이지 않는다)
    final uri = widget.realCover == null ? null : coverAtSize(widget.realCover, 'L');
    if (uri != null) {
      coverPalette(uri, 6).then((p) {
        if (mounted) setState(() => _fromCover = coverSwatches(p));
      });
    }
  }

  Book _book(BindingDraft b) => previewBook(title: widget.title, author: widget.author, size: widget.size, pages: widget.pages, binding: b, realCover: widget.realCover);

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final shown = widget.current ?? _book(widget.value);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Column(
            children: [
              RotatableBook(key: ValueKey(shown), book: shown, frontWidth: math.min(170, width * 0.39), initialSpin: 32, shadow: true),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('드래그해서 돌려보세요', style: AppType.caption),
              ),
            ],
          ),
        ),
        // 전환 칸(토스 SegmentedControl처럼): 회색 바탕 안에서 고른 칸만 흰 칸 + 진한 굵은 글자
        Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(Shape.input + 3)),
          child: Row(
            children: [
              for (final (id, label) in const [('art', '그림'), ('color', '색상'), ('material', '재질')])
                Expanded(
                  child: Semantics(
                    selected: _tab == id,
                    button: true,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(() => _tab = id),
                      child: Container(
                        constraints: const BoxConstraints(minHeight: 42),
                        alignment: Alignment.center,
                        decoration: _tab == id
                            ? BoxDecoration(
                                color: AppColors.bg,
                                borderRadius: BorderRadius.circular(Shape.input),
                                boxShadow: const [BoxShadow(color: Color(0x14191F28), offset: Offset(0, 4), blurRadius: 10)],
                              )
                            : null,
                        child: Text(
                          label,
                          style: AppType.row.copyWith(fontSize: 15, color: _tab == id ? AppColors.ink : AppColors.inkSoft, fontFamily: _tab == id ? AppFonts.uiBold : AppFonts.ui),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        switch (_tab) {
          'color' => _colorPane(),
          'material' => _materialPane(),
          _ => _artPane(),
        },
      ],
    );
  }

  Widget _check(double size, double icon, [Color color = AppColors.onAccent]) => Container(
    width: size,
    height: size,
    decoration: const BoxDecoration(color: _ink, shape: BoxShape.circle),
    child: Center(
      child: LucideIcon('Check', size: icon, color: color, stroke: 2.4),
    ),
  );

  /// 그림: 6종 3열. 고른 그림만 얇은 테두리 + 작은 체크. 아래에 '그림 없음'(실제 표지가 있으면 실제 표지)
  Widget _artPane() {
    final v = widget.value;
    // 책장 모습 그대로 보여 주는 중이면 아무것도 고르지 않은 상태로 둔다
    final none = v.coverArtId == null && widget.current == null;
    return LayoutBuilder(
      builder: (_, box) {
        final cell = box.maxWidth * 0.315;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 18),
              child: Wrap(
                alignment: WrapAlignment.spaceBetween,
                runSpacing: 16,
                children: [
                  for (final a in coverArtworks)
                    Semantics(
                      button: true,
                      selected: v.coverArtId == a.id,
                      label: '표지 그림 ${a.name}',
                      excludeSemantics: true,
                      child: GestureDetector(
                        onTap: () => widget.onChange(v.custom(coverArtId: a.id)),
                        child: SizedBox(
                          width: cell,
                          child: Column(
                            children: [
                              Container(
                                width: cell,
                                height: cell,
                                padding: const EdgeInsets.all(3),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: v.coverArtId == a.id ? _ink : Colors.transparent, width: 1.5),
                                ),
                                child: Stack(
                                  fit: StackFit.expand,
                                  children: [
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(5),
                                      child: Image.asset(artworkThumb(a.id), fit: BoxFit.cover),
                                    ),
                                    if (v.coverArtId == a.id) Positioned(top: 4, right: 4, child: _check(20, 13)),
                                  ],
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(
                                  a.name,
                                  style: AppType.caption.copyWith(fontFamily: v.coverArtId == a.id ? AppFonts.uiBold : null, color: v.coverArtId == a.id ? AppColors.ink : null),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            // 기본 정면 그림을 고르지 않으면: 실제 표지가 있는 책은 실제 표지(책장과 같다), 없는 책은 단색 정면
            Semantics(
              button: true,
              selected: none,
              label: widget.realCover != null ? '실제 표지' : '그림 없음, 단색 정면',
              excludeSemantics: true,
              child: GestureDetector(
                onTap: () => widget.onChange(v.custom(coverArtId: null)),
                child: Container(
                  margin: const EdgeInsets.only(top: 18),
                  constraints: const BoxConstraints(minHeight: 50),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: AppColors.input,
                    borderRadius: BorderRadius.circular(Shape.input),
                    border: Border.all(color: none ? _ink : AppColors.input),
                  ),
                  child: Row(
                    children: [
                      if (widget.realCover != null)
                        RealCover(uri: coverAtSize(widget.realCover, 'L'), title: widget.title, color: v.spineColor, width: 22)
                      else
                        Container(
                          width: 22,
                          height: 30,
                          decoration: BoxDecoration(
                            color: Color(0xFF000000 | _hex(v.spineColor)),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(color: const Color(0x1F000000)),
                          ),
                        ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          widget.realCover != null ? '실제 표지' : '그림 없음 · 단색 정면',
                          style: AppType.sub.copyWith(fontFamily: none ? AppFonts.uiBold : null, color: none ? AppColors.ink : null),
                        ),
                      ),
                      if (none) const LucideIcon('Check', size: 16, color: _ink, stroke: 2.2),
                    ],
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _h(String t) => Padding(
    padding: const EdgeInsets.only(top: Space.section, bottom: Space.item),
    child: Text(t, style: AppType.section),
  );

  /// 색상: 표지 색 + 이 책에 어울리는 색 + 모든 색. 맨 아래 추천 장정으로 되돌리기
  Widget _colorPane() {
    final v = widget.value, rec0 = widget.recommended;
    final rec = [
      for (final h in suggestColors(rec0.spineColor))
        if (!_fromCover.contains(h)) h,
    ];
    final rest = [
      for (final c in bookColors)
        if (!rec.contains(c.hex) && !_fromCover.contains(c.hex)) c,
    ];
    final same = v.spineColor == rec0.spineColor && v.motif == rec0.motif && v.layout == rec0.layout && (v.material ?? 'fine') == (rec0.material ?? 'fine') && v.coverArtId == null;
    Widget swatch(String hex, String name) {
      final on = v.spineColor == hex;
      return Semantics(
        button: true,
        selected: on,
        label: '책 색 $name',
        excludeSemantics: true,
        child: GestureDetector(
          onTap: () {
            final t = tonesFor(hex);
            widget.onChange(v.custom(spineColor: hex, inkColor: t.inkColor, accentColor: t.accentColor));
          },
          child: SizedBox(
            width: 44,
            height: 44,
            child: Center(
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Color(0xFF000000 | _hex(hex)),
                  shape: BoxShape.circle,
                  border: Border.all(color: on ? _ink : const Color(0x14000000), width: on ? 2.5 : 1),
                ),
                child: on ? Center(child: LucideIcon('Check', size: 16, color: Color(0xFF000000 | _hex(tonesFor(hex).inkColor)), stroke: 2.4)) : null,
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_fromCover.isNotEmpty) ...[
          _h('표지 색'),
          Wrap(spacing: 12, runSpacing: 12, children: [for (final (i, h) in _fromCover.indexed) swatch(h, '표지 색 ${i + 1}')]),
        ],
        _h('이 책에 어울리는 색'),
        Wrap(spacing: 12, runSpacing: 12, children: [for (final (i, h) in rec.indexed) swatch(h, i == 0 ? '추천' : '추천 ${i + 1}')]),
        _h('모든 색'),
        Wrap(spacing: 12, runSpacing: 12, children: [for (final c in rest) swatch(c.hex, c.name)]),
        Padding(
          padding: const EdgeInsets.only(top: Space.group),
          child: TextLink(
            label: '추천 장정으로 되돌리기',
            soft: true,
            disabled: same && v.source != 'custom',
            onPress: () => widget.onChange(
              BindingDraft(
                spineColor: rec0.spineColor,
                motif: rec0.motif,
                seed: v.seed,
                inkColor: rec0.inkColor,
                accentColor: rec0.accentColor,
                layout: rec0.layout,
                material: rec0.material,
                coverArtId: rec0.coverArtId,
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// 재질: 이 책 색에 그 재질의 결을 크게 그린 견본 + 책등 글자 배치(이 책 책등)
  Widget _materialPane() {
    final v = widget.value;
    final material = v.material ?? 'fine', layout = v.layout ?? 'spine_a';
    return LayoutBuilder(
      builder: (_, box) {
        final tile = (box.maxWidth - 16) / 3;
        Widget tileBox({required bool on, required Widget child, bool spine = false}) => Container(
          width: tile,
          height: tile * 0.86,
          decoration: BoxDecoration(
            color: spine ? AppColors.bg : AppColors.surface,
            borderRadius: BorderRadius.circular(Shape.input),
            border: Border.all(color: on ? _ink : (spine ? AppColors.line : Colors.transparent), width: spine && !on ? 1.5 : 2),
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            alignment: Alignment.center,
            children: [
              child,
              if (on) Positioned(top: 7, right: 7, child: _check(20, 15)),
            ],
          ),
        );
        Widget name(String t, bool on) => Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            t,
            style: AppType.caption.copyWith(fontFamily: on ? AppFonts.uiBold : null, color: on ? AppColors.ink : null),
          ),
        );
        // 책등 배율: 칸 높이에 맞게
        final spineBook = _book(v);
        final spineH = (spineBook.dims?.height ?? 188) + bookPad * 2;
        final zoom = tile * 0.8 / spineH;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _h('표면'),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                for (final m in _materials)
                  Semantics(
                    button: true,
                    selected: material == m,
                    label: '재질 ${_materialNames[m]}',
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: () => widget.onChange(v.custom(material: m)),
                      child: SizedBox(
                        width: (box.maxWidth - 24) / 4,
                        child: Column(
                          children: [
                            SizedBox(
                              width: (box.maxWidth - 24) / 4,
                              child: AspectRatio(
                                aspectRatio: 1 / 0.86,
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    borderRadius: BorderRadius.circular(Shape.input),
                                    border: Border.all(color: material == m ? _ink : Colors.transparent, width: 2),
                                  ),
                                  clipBehavior: Clip.antiAlias,
                                  child: Stack(
                                    fit: StackFit.expand,
                                    children: [
                                      Padding(
                                        padding: const EdgeInsets.all(2),
                                        child: CustomPaint(painter: _MaterialSwatch(m, Color(0xFF000000 | _hex(v.spineColor)))),
                                      ),
                                      if (material == m) Positioned(top: 7, right: 7, child: _check(20, 15)),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            name(_materialNames[m]!, material == m),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            _h('책등 글자'),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                for (final l in const ['spine_a', 'spine_b', 'spine_c'])
                  Semantics(
                    button: true,
                    selected: layout == l,
                    label: '책등 글자 ${_layoutNames[l]}',
                    excludeSemantics: true,
                    child: GestureDetector(
                      onTap: () => widget.onChange(v.custom(layout: l)),
                      child: Column(
                        children: [
                          tileBox(
                            on: layout == l,
                            spine: true,
                            child: IgnorePointer(
                              child: StandaloneBook(
                                book: _book(v.custom(layout: l)),
                                pose: Pose.upright,
                                scale: zoom,
                              ),
                            ),
                          ),
                          name(_layoutNames[l]!, layout == l),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

/// 재질 견본: 책 그림의 결은 아주 은은해서 작은 칸에서는 똑같아 보인다. 견본은 결을 과장해 차이가 보이게 그린다
/// 고운 종이 = 고른 잔 얼룩, 린넨 = 가로세로 실 짜임, 줄무늬 종이 = 가로 줄, 매끈 무광 = 비스듬한 광택
class _MaterialSwatch extends CustomPainter {
  _MaterialSwatch(this.material, this.color);
  final String material;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final r = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(10));
    canvas.save();
    canvas.clipRRect(r);
    canvas.drawRect(Offset.zero & size, Paint()..color = color);
    if (material == 'fine') {
      var x = 7;
      double rnd() => (x = (x * 16807) % 2147483647) / 2147483647;
      for (var i = 0; i < 140; i++) {
        final cx = rnd() * w, cy = rnd() * h, rr = 0.5 + rnd() * 1.4, o = 0.05 + rnd() * 0.08, dark = rnd() > 0.25;
        canvas.drawCircle(Offset(cx, cy), rr, Paint()..color = (dark ? Colors.black : Colors.white).withValues(alpha: dark ? o : o * 0.5));
      }
    }
    if (material == 'linen' || material == 'laid') {
      final horiz = Paint()
        ..color = Colors.black.withValues(alpha: material == 'linen' ? 0.22 : 0.14)
        ..strokeWidth = material == 'linen' ? 1.1 : 1;
      for (var y = 1.0; y < h; y += 3) {
        canvas.drawLine(Offset(0, y), Offset(w, y), horiz);
      }
      if (material == 'linen') {
        final vert = Paint()
          ..color = Colors.white.withValues(alpha: 0.14)
          ..strokeWidth = 1.1;
        for (var x2 = 1.0; x2 < w; x2 += 3) {
          canvas.drawLine(Offset(x2, 0), Offset(x2, h), vert);
        }
      }
    }
    final shade = material == 'matte'
        ? const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0x33FFFFFF), Color(0x0AFFFFFF), Color(0x38000000)], stops: [0, 0.45, 1])
        : const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x0FFFFFFF), Color(0x14000000)]);
    canvas.drawRect(Offset.zero & size, Paint()..shader = shade.createShader(Offset.zero & size));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_MaterialSwatch old) => old.material != material || old.color != color;
}
