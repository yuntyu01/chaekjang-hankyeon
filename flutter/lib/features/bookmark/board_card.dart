// 갈피 보드의 카드 한 장(지금 앱 BoardCard.tsx, 2026-11-02 사용자 시안): 글은 종이 + 테이프 + 명조 문장, 사진은 인화지 + 테이프.
// 테이프는 왼쪽 위(사진 카드와 같은 쪽), 쪽수는 색 막대 없이 오른쪽 맨 아래. 누르기는 보드가 맡는다(여기서는 터치를 받지 않는다).
// 폭과 최소 높이는 보드가 바깥에서 정한다(손잡이로 끄는 동안 글이 바로 다시 줄 바꿈된다)
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/bookmark_board.dart' show boardMaxLines, boardPhotoRatio;
import '../../domain/color.dart' show paperColors;
import '../../domain/library.dart' show Bookmark;
import '../../ui/theme.dart';
import 'bookmark_card.dart' show cardPaper, hexColor;
import 'bookmark_paper.dart';
import 'bookmark_tape.dart';
import 'photo_plate.dart' show BookmarkPhoto;

const _soft = TextStyle(fontFamily: AppFonts.ui, fontSize: 13, height: 18 / 13, color: AppColors.inkSoft);
const _quote = TextStyle(fontFamily: AppFonts.reading, fontSize: 18, height: 29 / 18, color: AppColors.ink, letterSpacing: -0.3);

List<BoxShadow> _shadow(double a1, double a2, double y2, double b2) => [
      BoxShadow(color: Color.fromRGBO(60, 50, 45, a1), offset: const Offset(0, 1), blurRadius: 2),
      BoxShadow(color: Color.fromRGBO(60, 50, 45, a2), offset: Offset(0, y2), blurRadius: b2),
    ];

class BoardCard extends StatelessWidget {
  const BoardCard({super.key, required this.mark, this.color, this.minHeight = 0});
  final Bookmark mark;
  final String? color;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    final hair = 1 / MediaQuery.devicePixelRatioOf(context);
    final tone = paperColors(color, mark.myBookId);
    final page = mark.page != null && mark.page != 0 ? 'p. ${mark.page}' : null;
    final border = Border.all(color: AppColors.line, width: hair);
    if (mark.photoUri != null) {
      return Stack(clipBehavior: Clip.none, children: [
        Container(
          constraints: BoxConstraints(minHeight: minHeight),
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 8),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(2), border: border, boxShadow: _shadow(0.12, 0.09, 5, 12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            AspectRatio(
              aspectRatio: boardPhotoRatio(mark.photoRatio),
              child: ColoredBox(color: const Color(0xFFECE9E4), child: BookmarkPhoto(uri: mark.photoUri!)),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(page ?? mark.text.trim(), maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: page != null ? TextAlign.right : TextAlign.left, style: _soft),
            ),
          ]),
        ),
        Positioned(
          left: -4,
          top: -12,
          child: Transform.rotate(angle: -28 * math.pi / 180, child: BookmarkTape(color: hexColor(tone.tape), seed: '${mark.id}-tape', width: 40, height: 30, paperEdge: 10)),
        ),
      ]);
    }
    return Stack(clipBehavior: Clip.none, children: [
      Container(
        constraints: BoxConstraints(minHeight: minHeight),
        decoration: BoxDecoration(color: cardPaper, borderRadius: BorderRadius.circular(3), border: border, boxShadow: _shadow(0.10, 0.07, 4, 10)),
        // passthrough: 카드 최소 높이가 안쪽 글 칸까지 내려가야 쪽수가 맨 아래로 간다
        child: Stack(fit: StackFit.passthrough, children: [
          Positioned.fill(child: BookmarkPaper(color: cardPaper, radius: 3, seed: '${mark.id}-front')),
          // 쪽수는 카드 맨 아래(카드가 글보다 크면 사이가 벌어진다)
          IntrinsicHeight(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 26, 18, 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(mark.text, maxLines: boardMaxLines, overflow: TextOverflow.ellipsis, style: _quote),
                if (page != null) ...[
                  const Spacer(),
                  Padding(padding: const EdgeInsets.only(top: 8), child: Text(page, textAlign: TextAlign.right, style: _soft)),
                ],
              ]),
            ),
          ),
        ]),
      ),
      Positioned(
        left: 16,
        top: -11,
        child: Transform.rotate(angle: -6 * math.pi / 180, child: BookmarkTape(color: hexColor(tone.tape), seed: '${mark.id}-tape', width: 40, height: 32, paperEdge: 11)),
      ),
    ]);
  }
}
