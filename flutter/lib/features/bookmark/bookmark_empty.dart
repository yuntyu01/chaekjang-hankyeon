// 갈피 탭 빈 화면(저장된 갈피가 하나도 없을 때만): 예시 갈피 한 장 + 안내 + '갈피 남기기'(지금 앱 BookmarkEmpty.tsx).
// 예시 카드는 갈피 탭 목록과 같은 카드 부품이다. 예시 문장은 화면 표현용이다(사용자 데이터에 저장하지 않는다)
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'bookmark_card.dart';

const _sample = '어떤 문장은\n책을 덮은 뒤에도\n곁에 남아요.';
// 예시 책: 실제 책 표지. 문장은 이 책의 문장이 아니라서 저자는 적지 않고 '예시'로 밝힌다
const _sampleBook = (title: '채식주의자', coverUri: 'https://image.yes24.com/goods/108422348/L', color: '#5276B3');

class BookmarkEmpty extends StatelessWidget {
  const BookmarkEmpty({super.key, required this.onAdd, this.bottomPad = 0});
  final VoidCallback onAdd;
  final double bottomPad;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final cardW = math.min(MediaQuery.sizeOf(context).width - Space.page * 2, contentMax);
    return LayoutBuilder(
      builder: (context, box) => SingleChildScrollView(
        padding: EdgeInsets.only(top: 12, bottom: bottomPad + 24),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: math.max(0, box.maxHeight - 12 - bottomPad - 24)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: const Color(0xFFE5E8EB), width: 2 / MediaQuery.devicePixelRatioOf(context))),
              child: Text('예시', style: AppType.caption.copyWith(fontSize: 12, height: null)),
            ),
            Semantics(
              label: '예시 갈피. ${_sample.replaceAll('\n', ' ')}',
              excludeSemantics: true,
              child: IgnorePointer(
                child: BookmarkCard(
                  compact: true,
                  width: cardW,
                  seed: 'sample',
                  data: BookmarkCardData(text: _sample, title: _sampleBook.title, page: 12, date: '${now.month}월 ${now.day}일', color: _sampleBook.color, coverUri: _sampleBook.coverUri),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Semantics(header: true, child: Text('첫 갈피를 남겨보세요', textAlign: TextAlign.center, style: AppType.heading)),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text('문장이나 사진으로\n간직하고 싶은 순간을 모아요.', textAlign: TextAlign.center, style: AppType.sub.copyWith(fontSize: 15, height: 22 / 15)),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 28),
              child: SizedBox(width: double.infinity, child: Btn(label: '갈피 남기기', onPress: onAdd)),
            ),
          ]),
        ),
      ),
    );
  }
}
