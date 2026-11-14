// 책장에서 책을 짧게 누르면 아래에서 올라오는 책 정보 시트(지금 앱 features/home/BookSheet.tsx, 2026-10-31 책장 시안).
// 왼쪽 작은 표지(실제 표지 사진, 없거나 못 읽으면 이 책의 장정 정면 + '꾸민 표지'), 오른쪽 제목·읽기 상태·한 줄 감상·최근 메모,
// 아래 '책 정보 보기'(회색 테두리 큰 단추)와 '읽기 시작 | 갈피 남기기'(글자만). 선반은 그대로 보이게 바탕을 어둡게 덮지 않는다.
// 배치 조작은 꾹 눌러 꾸미기에서
library;

import 'package:flutter/material.dart';

import '../../domain/cover_url.dart';
import '../../domain/library.dart';
import '../../domain/reference_home.dart' show referenceBooks;
import '../../domain/types.dart' show Book;
import '../../ui/standalone_book.dart' show StandaloneBook;
import '../book/add_book_screen.dart' show openAddBook;
import '../../store/library_model.dart';
import '../../ui/book_visual.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../book/book_screen.dart' show openBook;
import '../bookmark/book_picker.dart' show statusLabel;
import '../reading/reading_screen.dart' show openReadingScene;
import '../stats/stats_widgets.dart' show CoverImage;
import '../bookmark/new_bookmark_screen.dart';

/// 시안(폭 393dp) 실측: 표지 폭 약 104
const _coverW = 104.0;

/// 가장 최근 메모(독서 기록·갈피, 적어 둔 것만)
String? latestMemo(Library lib, String bookId) {
  ({String text, String at})? best;
  for (final s in lib.sessions.values) {
    final t = s.memo?.trim() ?? '';
    if (s.myBookId != bookId || t.isEmpty) continue;
    final at = sessionDay(s);
    if (best == null || at.compareTo(best.at) > 0) best = (text: t, at: at);
  }
  for (final m in lib.bookmarks.values) {
    final t = m.memo?.trim() ?? '';
    if (m.myBookId != bookId || t.isEmpty) continue;
    if (best == null || m.createdAt.compareTo(best.at) > 0) best = (text: t, at: m.createdAt);
  }
  return best?.text;
}

/// view·status·readOnly: 지난 연도 책장(보기 전용)에서 그해 기록(그해 서재·'2025년 · 완독')으로 연다. 읽기·갈피 단추가 없고,
/// 지금 서재에 보이지 않는 책(숨긴 책)은 '책 정보 보기'도 없다(지금 앱 BookSheet readOnly)
Future<void> showBookSheet(BuildContext context, String bookId, {Library? view, String? status, bool readOnly = false}) async {
  final model = LibraryModel.instance;
  await model.load();
  if (!context.mounted) return;
  final lib = view ?? model.lib;
  final canOpen = model.lib.books.containsKey(bookId) && model.lib.books[bookId]!.hiddenAt == null;
  final b = lib.books[bookId];
  final e = b == null ? null : lib.editions[b.editionId];
  // 새 서재 예시 책(표시 전용, 서재에 없음): 읽기·갈피 대신 '이 책을 내 서재에 추가'(지금 앱 BookSheet sample)
  if (b == null && view == null && referenceBooks[bookId] != null) return _sampleSheet(context, referenceBooks[bookId]!);
  if (b == null || e == null) return;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.transparent, // 바탕은 덮지 않는다(시안): 선반을 누르면 닫힌다
    builder: (ctx) {
      final insets = MediaQuery.paddingOf(ctx);
      final ratio = (e.heightMm ?? 0) > 0 && (e.widthMm ?? 0) > 0 ? e.heightMm! / e.widthMm! : 188 / 128;
      final memo = latestMemo(lib, bookId);
      return Container(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.9),
        decoration: const BoxDecoration(
          color: AppColors.bg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(Shape.sheet)),
          boxShadow: [BoxShadow(color: Color(0x1A6F5843), blurRadius: 16, offset: Offset(0, -2))],
        ),
        padding: EdgeInsets.fromLTRB(Space.page + 4, 0, Space.page + 4, insets.bottom + 14),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Center(
            child: Container(
              width: 38,
              height: 4.5,
              margin: const EdgeInsets.only(top: 10),
              decoration: BoxDecoration(color: AppColors.line, borderRadius: BorderRadius.circular(3)),
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(
                  padding: const EdgeInsets.only(top: 24),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                    SizedBox(
                      width: _coverW + 6,
                      child: e.coverUri != null
                          ? Center(
                              child: CoverImage(
                                uris: [coverAtSize(e.coverUri, 'L'), e.coverUri],
                                color: AppColors.input,
                                width: _coverW,
                                height: (_coverW * ratio).roundToDouble(),
                                radius: 3,
                              ),
                            )
                          : Column(children: [
                              BookVisual(lib: lib, id: bookId, width: _coverW + 6),
                              Padding(padding: const EdgeInsets.only(top: 4), child: Text('꾸민 표지', textAlign: TextAlign.center, style: AppType.caption)),
                            ]),
                    ),
                    const SizedBox(width: 18),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Semantics(
                          header: true,
                          child: Text(e.title, style: const TextStyle(fontFamily: AppFonts.uiMedium, fontSize: 20, height: 27 / 20, letterSpacing: -0.2, color: AppColors.ink)),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(status ?? statusLabel[b.status]!, style: AppType.caption.copyWith(fontSize: 14, height: 20 / 14)),
                        ),
                        if ((b.note ?? '').isNotEmpty)
                          Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(b.note!, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppType.sub.copyWith(color: AppColors.ink))),
                        if (memo != null)
                          Padding(
                            padding: const EdgeInsets.only(top: Space.s),
                            child: Semantics(
                              label: '최근 메모, $memo',
                              excludeSemantics: true,
                              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                const Padding(padding: EdgeInsets.only(top: 3), child: LucideIcon('StickyNote', size: 14, color: AppColors.inkSoft)),
                                const SizedBox(width: 6),
                                Expanded(child: Text(memo, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.caption)),
                              ]),
                            ),
                          ),
                      ]),
                    ),
                  ]),
                ),
                if (canOpen)
                  Padding(
                  padding: const EdgeInsets.only(top: 22),
                  child: Btn(
                    label: '책 정보 보기',
                    kind: 'secondary',
                    onPress: () {
                      Navigator.pop(ctx);
                      openBook(context, bookId);
                    },
                  ),
                ),
                if (!readOnly)
                  Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Row(children: [
                    Expanded(
                      child: TextLink(
                        label: '읽기 시작',
                        onPress: () {
                          Navigator.pop(ctx);
                          openReadingScene(context, bookId: bookId);
                        },
                      ),
                    ),
                    Container(width: 1, height: 14, color: AppColors.line),
                    Expanded(
                      child: TextLink(
                        label: '갈피 남기기',
                        onPress: () {
                          Navigator.pop(ctx);
                          openNewBookmark(context, book: bookId);
                        },
                      ),
                    ),
                  ]),
                ),
              ]),
            ),
          ),
        ]),
      );
    },
  );
}

/// 예시 책 시트: 책장과 같은 그림의 앞모습, 제목, '예시 책이에요 / 내 서재에는 없어요', 같은 제목으로 책 추가
Future<void> _sampleSheet(BuildContext context, Book sample) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.transparent,
      builder: (ctx) {
        final insets = MediaQuery.paddingOf(ctx);
        final dims = sample.dims;
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.bg,
            borderRadius: BorderRadius.vertical(top: Radius.circular(Shape.sheet)),
            boxShadow: [BoxShadow(color: Color(0x1A6F5843), blurRadius: 16, offset: Offset(0, -2))],
          ),
          padding: EdgeInsets.fromLTRB(Space.page + 4, 0, Space.page + 4, insets.bottom + 14),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Center(
              child: Container(
                width: 38,
                height: 4.5,
                margin: const EdgeInsets.only(top: 10),
                decoration: BoxDecoration(color: AppColors.line, borderRadius: BorderRadius.circular(3)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                SizedBox(
                  width: _coverW + 6,
                  child: Center(child: StandaloneBook(book: sample, scale: _coverW / (dims?.coverWidth ?? 118))),
                ),
                const SizedBox(width: 18),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Semantics(
                      header: true,
                      child: Text(sample.title, style: const TextStyle(fontFamily: AppFonts.uiMedium, fontSize: 20, height: 27 / 20, letterSpacing: -0.2, color: AppColors.ink)),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('예시 책이에요\n내 서재에는 없어요', style: AppType.caption.copyWith(fontSize: 14, height: 20 / 14)),
                    ),
                  ]),
                ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 22),
              child: Btn(
                label: '이 책을 내 서재에 추가',
                kind: 'secondary',
                onPress: () {
                  Navigator.pop(ctx);
                  openAddBook(context, q: sample.title);
                },
              ),
            ),
          ]),
        );
      },
    );
