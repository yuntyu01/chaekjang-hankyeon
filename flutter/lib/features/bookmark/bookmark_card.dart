// 갈피 카드(지금 앱 BookmarkCard.tsx): 얇은 흰 종이에 문장을 붙여 둔 모양. 뒤 종이 한 장(갈피 색을 옅게)을 살짝 돌려 네 모서리가 조금씩 보이고,
// 문장 갈피는 오른쪽 위에 한지 테이프, 사진 갈피는 인화 사진. 아래에 출처(표지·제목·저자·날짜), 목록에서는 오른쪽 아래 '아껴두기'
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/color.dart';
import '../../ui/keep_all.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'bookmark_paper.dart';
import 'bookmark_tape.dart';
import 'photo_plate.dart';

const cardPaper = Color(0xFFFFFFFF);
const _coverRatio = 40 / 56;
const _deg = math.pi / 180;

class BookmarkCardData {
  const BookmarkCardData({required this.text, required this.title, required this.date, this.author, this.page, this.memo, this.color, this.coverUri, this.bookId, this.bookColor, this.photoUri, this.photoRatio});
  final String text, title, date;
  final String? author, memo, color, coverUri, photoUri;
  final num? page, photoRatio;
  /// 연결된 책(뒤 종이 색 씨앗)과 그 책 색(대체 표지)
  final String? bookId, bookColor;
}

/// 문장 길이에 맞춘 글자 크기·줄 높이
({double size, double lh}) quoteType(String text) {
  final n = text.replaceAll(RegExp(r'\s+'), '').length;
  if (n <= 36) return (size: 27.5, lh: 46);
  if (n <= 80) return (size: 25, lh: 41);
  if (n <= 160) return (size: 22, lh: 37);
  return (size: 19, lh: 33);
}

Color hexColor(String hex) => Color(0xFF000000 | int.parse(hex.substring(1), radix: 16));

/// 낱말 단위 줄바꿈 글자
class WordWrap extends StatelessWidget {
  const WordWrap(this.text, {super.key, required this.style, this.maxLines});
  final String text;
  final TextStyle style;
  final int? maxLines;

  @override
  Widget build(BuildContext context) => Text(keepAll(text), style: style, maxLines: maxLines, overflow: maxLines != null ? TextOverflow.ellipsis : null);
}

TextStyle _t(String family, double size, double lh, Color color, {double spacing = 0}) =>
    TextStyle(fontFamily: family, fontSize: size, height: lh / size, color: color, letterSpacing: spacing, leadingDistribution: TextLeadingDistribution.even);

final _pageTop = _t(AppFonts.ui, 14, 20, AppColors.inkSoft);
final _srcTitle = _t(AppFonts.uiBold, 15, 21, AppColors.ink);
final _meta = _t(AppFonts.ui, 14, 20, AppColors.inkSoft);

final _ymd = RegExp(r'^\d{4}[.\-/](\d{1,2})[.\-/](\d{1,2}).*$');

class BookmarkCard extends StatelessWidget {
  const BookmarkCard({super.key, required this.data, required this.width, required this.seed, this.showMemo = false, this.compact = false, this.onOpen, this.saved = false, this.onToggleSaved});
  final BookmarkCardData data;
  final double width;
  final String seed;
  final bool showMemo, compact, saved;
  final VoidCallback? onOpen;
  final VoidCallback? onToggleSaved;

  @override
  Widget build(BuildContext context) {
    final hair = 1 / MediaQuery.devicePixelRatioOf(context);
    final qt = compact ? (size: 25.0, lh: 38.0) : quoteType(data.text);
    final cardW = compact ? width - 4 : width * 0.857;
    final coverW = compact ? 40.0 : 56.0; // 표지는 하단의 작은 출처처럼(목록 40×56dp)
    final tone = paperColors(data.color, data.bookId ?? data.title);
    final photo = data.photoUri != null && data.photoUri!.isNotEmpty;
    final date = compact ? data.date.replaceFirstMapped(_ymd, (m) => '${int.parse(m[1]!)}월 ${int.parse(m[2]!)}일') : data.date;
    final padBottom = compact ? 20.0 : 34.0;
    final rule = Container(height: hair, color: AppColors.line);
    final meta = [?data.author, date].where((s) => s.isNotEmpty).join(' · ');

    final body = Padding(
      padding: EdgeInsets.fromLTRB(compact ? 24 : 33, compact ? 22 : 36, compact ? 24 : 33, padBottom),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ConstrainedBox(
          constraints: BoxConstraints(minHeight: compact ? 24 : 28),
          child: Row(children: [
            Text(photo ? '사진 갈피' : data.page != null && data.page != 0 ? 'p. ${data.page}' : '남긴 문장', style: _pageTop),
            if (photo && data.page != null && data.page != 0) ...[const Spacer(), Transform.translate(offset: const Offset(3, 0), child: Text('${data.page}쪽', style: _pageTop))],
          ]),
        ),
        if (photo)
          Padding(
            padding: EdgeInsets.only(top: compact ? 14 : 26),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Align(alignment: Alignment.centerLeft, child: PhotoPlate(uri: data.photoUri!, ratio: data.photoRatio, width: cardW - (compact ? 48 : 66) + 3, seed: seed, compact: compact)),
              if (data.text.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: WordWrap(data.text, style: compact ? _t(AppFonts.reading, 15, 23, const Color(0xFF34302C)) : _t(AppFonts.reading, 16, 27, const Color(0xFF34302C)), maxLines: compact ? 2 : null),
                ),
            ]),
          )
        else
          Padding(
            padding: EdgeInsets.only(top: compact ? 14 : 33),
            child: WordWrap(data.text, style: _t(AppFonts.reading, qt.size, qt.lh, const Color(0xFF292725), spacing: -0.45), maxLines: compact ? 4 : null),
          ),
        Padding(padding: EdgeInsets.only(top: compact ? 20 : 30, bottom: compact ? 16 : 20), child: rule),
        // 표지·제목·저자는 가깝게 한 묶음. 인용문만 명조이고 책 정보는 고딕, 책 이름만 조금 진하게
        Row(children: [
          Container(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(3), border: Border.all(color: AppColors.line, width: hair)),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: RealCover(uri: data.coverUri, title: data.title, color: data.bookColor ?? data.color ?? '#F2F4F6', width: coverW, ratio: _coverRatio),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: compact && onToggleSaved != null ? 40 : 0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(data.title, style: _srcTitle, maxLines: compact ? 1 : 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(meta, style: _meta, maxLines: 1, overflow: TextOverflow.ellipsis),
              ]),
            ),
          ),
        ]),
        if (showMemo && data.memo != null && data.memo!.isNotEmpty) ...[
          Padding(padding: const EdgeInsets.only(top: 18, bottom: 20), child: rule),
          WordWrap(data.memo!, style: _t(AppFonts.reading, 16, 28, const Color(0xFF38332D))),
        ],
      ]),
    );

    final card = Container(
      width: cardW,
      decoration: BoxDecoration(
        color: cardPaper,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [cssShadow(const Color.fromRGBO(60, 50, 45, 0.06), 0, 1, 2), cssShadow(const Color.fromRGBO(60, 50, 45, 0.05), 0, 3, 10)],
      ),
      foregroundDecoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.line, width: hair)),
      child: Stack(clipBehavior: Clip.none, children: [
        Positioned.fill(child: BookmarkPaper(color: cardPaper, radius: 8, seed: '$seed-front')),
        Semantics(
          button: onOpen != null,
          label: onOpen != null ? '${data.text.isNotEmpty ? data.text : '사진 갈피'}, ${data.title}' : null,
          child: Pressable(onPress: onOpen, child: body),
        ),
        if (!photo)
          Positioned(
            right: compact ? 20 : 16,
            top: compact ? -16 : -13,
            child: Transform.rotate(
              angle: 0.7 * _deg,
              child: BookmarkTape(color: hexColor(tone.tape), seed: '$seed-tape', width: compact ? 39 : 44, height: compact ? 43 : 45, paperEdge: compact ? 16 : 13),
            ),
          ),
        // 아껴두기: 출처 줄의 오른쪽 끝(표지 높이 가운데)
        if (compact && onToggleSaved != null)
          Positioned(
            right: 14,
            bottom: padBottom + (coverW / _coverRatio - 44) / 2,
            child: Semantics(
              button: true,
              selected: saved,
              label: saved ? '아껴둔 갈피에서 빼기' : '갈피 아껴두기',
              child: Pressable(
                onPress: onToggleSaved,
                child: SizedBox(width: 44, height: 44, child: Center(child: LucideIcon('Bookmark', size: 22, color: AppColors.inkSoft, fill: saved ? AppColors.inkSoft : null))),
              ),
            ),
          ),
      ]),
    );

    // 카드와 카드 사이는 넓게(아래 36). 뒷종이는 앞 종이와 중심을 맞춰 살짝 돌린다
    return SizedBox(
      width: width,
      child: Padding(
        padding: EdgeInsets.only(top: compact ? 20 : 37, bottom: compact ? 36 : 38),
        child: Stack(clipBehavior: Clip.none, alignment: Alignment.topCenter, children: [
          Positioned(
            top: (compact ? 18 : 35) - (compact ? 20 : 37),
            bottom: (compact ? 34 : 36) - (compact ? 36 : 38),
            left: (width - cardW - 4) / 2,
            width: cardW + 4,
            child: Transform.rotate(
              angle: (compact ? 1.6 : 2) * _deg,
              child: Container(
                decoration: BoxDecoration(color: hexColor(tone.paper), borderRadius: BorderRadius.circular(7)),
                foregroundDecoration: BoxDecoration(borderRadius: BorderRadius.circular(7), border: Border.all(color: const Color.fromRGBO(108, 83, 74, 0.16), width: hair)),
                child: BookmarkPaper(color: hexColor(tone.paper), radius: 7, seed: '$seed-color', kind: PaperKind.colored),
              ),
            ),
          ),
          card,
        ]),
      ),
    );
  }
}
