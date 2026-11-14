// 책 정보(지금 앱 app/book/[id]/index.tsx): 표지 위 가운데 전환 칸 [책 정보 | 평가 | 내 기록]. 이어서 읽기와 갈피 남기기는 아래에 늘 보인다.
// 날짜·쪽수·별점은 모두 선택 입력. 완독 여부는 사용자가 정한다(타이머로 자동 판정하지 않는다).
// 완독한 책을 '읽는 중'·'보류'로 바꾸면 새 회차(다시 읽기)라 먼저 묻는다
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app_nav.dart';
import '../../domain/color.dart';
import '../../domain/library.dart';
import '../../store/library_model.dart';
import '../../ui/alert.dart';
import '../../ui/book_visual.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart' show statusLabel;
import '../bookmark/bookmark_detail_screen.dart' show openBookmark;
import '../bookmark/bookmark_card.dart' show hexColor;
import '../bookmark/photo_plate.dart' show BookmarkPhoto;
import '../bookmark/ribbon_color_sheet.dart';
import '../stats/stats_screen.dart';
import 'labels.dart';
import '../bookmark/new_bookmark_screen.dart';
import '../../domain/layout.dart' show placementOf;
import '../../store/library_store.dart' show archivedYears;
import '../../store/placement_store.dart';
import '../home/home_screen.dart' show focusBookOnShelf;
import 'all_books.dart' show deleteNote, deleteSummary;
import '../bookmark/board_screen.dart' show openBookmarkBoard;
import 'binding_screen.dart' show openBindingEditor;
import 'book_share_screen.dart' show openBookShare;
import 'edit_book_screen.dart' show openEditBook;
import 'place_books.dart' show placeWithChoice;
import '../community/book_reviews.dart';

const _views = [('info', '책 정보'), ('rate', '평가'), ('mine', '내 기록')];
const _statuses = [ReadStatus.want, ReadStatus.reading, ReadStatus.read, ReadStatus.paused];

/// 책 정보 화면 열기
Future<void> openBook(BuildContext context, String id) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/book'), builder: (_) => BookScreen(id: id)));

/// 책 정보 화면
class BookScreen extends StatefulWidget {
  const BookScreen({super.key, required this.id, this.onRead});
  final String id;

  /// '읽기 시작·이어서 읽기': 읽기 탭으로 넘겨준다(앱 틀이 정한다)
  final void Function(String id)? onRead;

  @override
  State<BookScreen> createState() => _BookScreenState();
}

class _BookScreenState extends State<BookScreen> {
  final _model = LibraryModel.instance;
  String _tab = 'info';
  bool _pageEdit = false;
  Timer? _noteTimer;
  final _note = TextEditingController();
  final _page = TextEditingController();
  bool _noteLoaded = false;
  BookReviewsState? _reviews; // 같은 판본(ISBN-13)의 공개 후기. 판본 ISBN을 고치면 새로 받는다
  String? _reviewsIsbn;

  BookReviewsState _reviewsOf(String? isbn13) {
    final r = _reviews;
    if (r != null && _reviewsIsbn == isbn13) return r;
    r?.dispose();
    _reviewsIsbn = isbn13;
    return _reviews = BookReviewsState(isbn13)..addListener(_changed);
  }

  @override
  void initState() {
    super.initState();
    _model.addListener(_changed);
    _model.load();
  }

  @override
  void dispose() {
    _model.removeListener(_changed);
    // 화면을 떠나도 적던 한 줄 감상은 남긴다
    if (_noteTimer?.isActive ?? false) {
      _noteTimer!.cancel();
      _saveNote();
    }
    _note.dispose();
    _page.dispose();
    _reviews?.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  String get id => widget.id;

  void _saveNote() {
    final t = _note.text.trim();
    _model.updateBook(id, note: t.isEmpty ? null : t);
  }

  void _chooseStatus(MyBook b, Round? last, ReadStatus s) {
    if (s == b.status) return;
    if ((s == ReadStatus.reading || s == ReadStatus.paused) && last?.finishedAt != null) {
      appAlert(context, '다시 읽기를 시작할까요?', '${last!.index + 1}회차가 생기고 진도는 0쪽부터예요. 지난 회차의 완독일·독서 기록·갈피는 그대로 남아요.', [
        const AlertButton('취소', style: AlertStyle.cancel),
        AlertButton('다시 읽기', onPress: () async {
          await _model.reread(id);
          if (s == ReadStatus.paused) await _model.setStatus(id, ReadStatus.paused);
        }),
      ]);
      return;
    }
    _model.setStatus(id, s);
  }

  /// 책 메뉴(지금 앱): 공유·정보 수정·장정 편집·책장 위치로·책장에서 빼기/진열·숨기기/삭제
  Future<void> _menu() async {
    final place = PlacementStore.instance;
    await place.ensure();
    final years = (await archivedYears([id]))[id] ?? const <int>[];
    if (!mounted) return;
    final onShelf = place.layout != null && placementOf(place.layout!, id) != null;
    showSheet<void>(
      context,
      builder: (ctx) => ListGroup(children: [
        ListItem(label: '이미지로 공유', sub: '한 줄 감상·별점을 넣은 카드', onPress: () {
          Navigator.pop(ctx);
          openBookShare(context, id);
        }),
        ListItem(label: '책 정보 수정', onPress: () {
          Navigator.pop(ctx);
          openEditBook(context, id);
        }),
        ListItem(label: '장정 편집', onPress: () {
          Navigator.pop(ctx);
          openBindingEditor(context, id);
        }),
        if (onShelf)
          ListItem(label: '책장 위치로 이동', onPress: () {
            Navigator.pop(ctx);
            focusBookOnShelf.value = id;
            Navigator.of(context).popUntil((r) => r.isFirst);
          }),
        // 책장에서 빼기는 배치만 푼다(책 정보·장정·독서 기록·갈피 그대로). 삭제(빨간 글자)는 책 데이터 자체를 지운다
        if (onShelf)
          ListItem(label: '책장에서 빼기', sub: '기록은 그대로, 전체 책에 남아요', onPress: () async {
            Navigator.pop(ctx);
            if (await place.toDrawer(id) && mounted) appAlert(context, '책장에서 뺐어요. 전체 책에 그대로 있어요.');
          })
        else
          ListItem(label: '책장에 진열', onPress: () {
            Navigator.pop(ctx);
            placeWithChoice(context, [id]);
          }),
        if (years.isNotEmpty)
          ListItem(label: '책 숨기기', sub: '${years.join('·')}년 책장에는 남아요', onPress: () {
            Navigator.pop(ctx);
            _confirmDelete(years);
          })
        else
          ListItem(label: '책 삭제', sub: '갈피·읽은 기록까지 지워요', danger: true, onPress: () {
            Navigator.pop(ctx);
            _confirmDelete(years);
          }),
      ]),
    );
  }

  /// 연도 책장에 있는 책은 지우지 않고 숨긴다(2026-11-06 사용자 '삭제 말고 숨기기로')
  void _confirmDelete(List<int> years) {
    final hide = years.isNotEmpty;
    final lib = _model.lib;
    appAlert(
      context,
      hide ? '책을 숨길까요?' : '책을 삭제할까요?',
      hide ? '지금 책장과 책 목록에서 빠지고, ${years.join('·')}년 책장에는 그대로 남아요.\n전체 책 › 필터 › 숨긴 책 보기에서 다시 꺼낼 수 있어요.' : deleteNote(deleteSummary(lib, [id])),
      [
        const AlertButton('취소', style: AlertStyle.cancel),
        AlertButton(hide ? '숨기기' : '삭제', style: hide ? AlertStyle.normal : AlertStyle.destructive, onPress: () async {
          final nav = Navigator.of(context);
          await _model.deleteBook(id, archived: hide);
          await PlacementStore.instance.forget([id]);
          nav.popUntil((r) => r.isFirst);
        }),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final lib = _model.lib;
    final b = lib.books[id];
    final e = b == null ? null : lib.editions[b.editionId];
    if (!_model.loaded) return const Screen(children: [Loading()]);
    if (b == null || e == null) {
      return Screen(title: '책', children: [Empty(title: '책을 찾을 수 없어요', body: '삭제되었거나 예시 책장 책이에요.', action: '책장으로', onAction: () => Navigator.of(context).popUntil((r) => r.isFirst))]);
    }
    if (!_noteLoaded) {
      _note.text = b.note ?? '';
      _noteLoaded = true;
    }
    final rounds = roundsOf(lib, id);
    final marks = bookmarksOf(lib, id);
    final readMs = bookReadMs(lib, id);
    final sessions = lib.sessions.values.where((s) => s.myBookId == id).length;
    final done = completions(lib, id);
    final pub = [?e.publisher, if (e.publishedAt != null && e.publishedAt!.length >= 4) e.publishedAt!.substring(0, 4)].where((x) => x.isNotEmpty).join(' · ');
    final last = rounds.isEmpty ? null : rounds.last;
    final reviews = _reviewsOf(e.isbn13);
    final hair = 1 / MediaQuery.devicePixelRatioOf(context);
    final readLabel = b.status == ReadStatus.reading || b.status == ReadStatus.paused
        ? '이어서 읽기'
        : b.status == ReadStatus.read
            ? '다시 읽기'
            : '읽기 시작';

    Widget infoPane() => ListGroup(children: [
          ListItem(label: '출판', value: pub.isEmpty ? '미입력' : pub),
          ListItem(label: 'ISBN', value: e.isbn13 ?? '미입력'),
          ListItem(label: '쪽수', value: e.pageCount != null ? '${e.pageCount}쪽' : '미입력'),
          ListItem(
            label: '판형',
            value: e.widthMm != null && e.heightMm != null ? '${e.widthMm}×${e.heightMm}mm' : '확인 전',
            sub: e.widthMm != null && e.heightMm != null ? null : '책장에는 기본 크기로 표시해요',
          ),
          ListItem(label: '도서 정보', value: e.source == 'search' ? e.sourceName ?? '검색' : e.source == 'photo' ? '사진으로 추가' : '직접 입력'),
          ListItem(
            label: '갈피 색',
            sub: b.ribbonColor != null ? '직접 고른 색' : '표지에서 고른 색',
            onPress: () => showRibbonColorSheet(context, id),
            right: Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: hexColor(paperColors(ribbonOf(lib, id), id).tape),
                border: Border.all(color: AppColors.line, width: hair * 2),
              ),
            ),
          ),
          // 판매 페이지는 맨 아래(YES24 약관: 출처와 상품 링크를 함께 보인다)
          if (e.link != null) ListItem(label: '${e.sourceName ?? '판매처'}에서 보기', onPress: () => launchUrl(Uri.parse(e.link!), mode: LaunchMode.externalApplication)),
        ]);

    Widget ratePane() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ConstrainedBox(
            constraints: const BoxConstraints(minHeight: Space.touch),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Semantics(header: true, child: Text('내 평가', style: AppType.section)),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text('나만 보는 평가예요', style: AppType.caption)),
                ]),
              ),
              Stars(value: b.rating, onChange: (v) => _model.updateBook(id, rating: v)),
            ]),
          ),
          Padding(padding: const EdgeInsets.symmetric(vertical: Space.l), child: Container(height: 0.5, color: AppColors.line)),
          Padding(padding: const EdgeInsets.only(bottom: Space.s), child: Text('한 줄 감상', style: AppType.label)),
          Container(
            constraints: const BoxConstraints(minHeight: 56),
            decoration: BoxDecoration(color: AppColors.input, borderRadius: BorderRadius.circular(Shape.input)),
            child: Semantics(
              label: '한 줄 감상',
              textField: true,
              child: TextField(
                controller: _note,
                maxLength: 140,
                style: AppType.input,
                cursorColor: AppColors.accent,
                decoration: InputDecoration(
                  isCollapsed: true,
                  counterText: '',
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.all(16),
                  hintText: '이 책은 나에게…',
                  hintStyle: AppType.input.copyWith(color: AppColors.inkFaint),
                ),
                // 적는 대로 잠깐 뒤 저장한다(입력 중에 칸을 바꾸거나 화면을 떠나도 남게)
                onChanged: (_) {
                  _noteTimer?.cancel();
                  _noteTimer = Timer(const Duration(milliseconds: 600), _saveNote);
                },
                onEditingComplete: () {
                  _noteTimer?.cancel();
                  _saveNote();
                  FocusScope.of(context).unfocus();
                },
              ),
            ),
          ),
          if (reviews.available) ...[
            const SectionBand(),
            Padding(padding: const EdgeInsets.only(top: Space.xl), child: ReviewsPane(title: e.title, myRating: b.rating, state: reviews)),
          ],
        ]);

    void togglePage() => setState(() {
          _pageEdit = !_pageEdit;
          _page.text = b.currentPage != null && b.currentPage != 0 ? '${b.currentPage}' : '';
        });
    Widget minePane() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Expanded(child: Semantics(header: true, child: Text('내 독서', style: AppType.section))),
            Text([statusLabel[b.status]!, if (done > 0) '완독 $done회'].join(' · '), style: AppType.caption),
          ]),
          Semantics(
            button: true,
            label: '현재 쪽 ${b.currentPage ?? 0}${e.pageCount != null ? ' / ${e.pageCount}쪽' : '쪽'}, 눌러서 고치기',
            onTap: togglePage,
            excludeSemantics: true,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: togglePage,
              child: Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: Space.touch),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                    Expanded(
                      child: Text.rich(TextSpan(
                        text: '${b.currentPage ?? 0}',
                        style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 32, height: 40 / 32, color: AppColors.ink, fontFeatures: [FontFeature.tabularFigures()]),
                        children: [TextSpan(text: e.pageCount != null ? '  /  ${e.pageCount}쪽' : '쪽', style: const TextStyle(fontSize: 18, color: AppColors.inkSoft))],
                      )),
                    ),
                    if (e.pageCount == null) Text('전체 쪽수 미입력', style: AppType.caption),
                  ]),
                ),
              ),
            ),
          ),
          // 쪽수 진행 막대: 8 두께, 끝은 둥글게(전체 쪽수를 알 때만)
          if (e.pageCount != null && e.pageCount! > 0)
            Padding(
              padding: const EdgeInsets.only(top: Space.m),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedBox(
                  height: 8,
                  child: Stack(children: [
                    Container(color: AppColors.line),
                    FractionallySizedBox(
                      widthFactor: (((b.currentPage ?? 0) / e.pageCount!).clamp(0.0, 1.0)).toDouble(),
                      child: Container(decoration: BoxDecoration(color: AppColors.accent, borderRadius: BorderRadius.circular(4))),
                    ),
                  ]),
                ),
              ),
            ),
          if (_pageEdit)
            Container(
              margin: const EdgeInsets.only(top: Space.s),
              decoration: BoxDecoration(color: AppColors.input, borderRadius: BorderRadius.circular(Shape.input)),
              child: TextField(
                controller: _page,
                autofocus: true,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                textInputAction: TextInputAction.done,
                style: AppType.input,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.all(16),
                  hintText: '읽은 쪽수',
                  hintStyle: AppType.input.copyWith(color: AppColors.inkFaint),
                ),
                onSubmitted: (v) {
                  final n = num.tryParse(v);
                  _model.updateBook(id, currentPage: n != null && n > 0 ? n.round() : null);
                  setState(() => _pageEdit = false);
                },
              ),
            ),
          const H2('읽기 상태'),
          Wrap(spacing: Space.s, runSpacing: Space.s, children: [
            for (final s in _statuses) AppChip(label: statusLabel[s]!, on: b.status == s, onPress: () => _chooseStatus(b, last, s)),
          ]),
          if (b.status == ReadStatus.read)
            Padding(
              padding: const EdgeInsets.only(top: Space.s),
              child: Row(children: [
                Btn(label: '완독 카드 공유', kind: 'ghost', size: 's', onPress: () => openBookShare(context, id)),
                const SizedBox(width: Space.l),
                Btn(label: '다시 읽기 시작(새 회차)', kind: 'ghost', size: 's', onPress: () => _chooseStatus(b, last, ReadStatus.reading)),
              ]),
            ),
          const H2('내 기록'),
          ListGroup(children: [
            ListItem(label: '누적 독서 시간', value: formatDuration(readMs)),
            ListItem(label: '완독', value: done > 0 ? '$done회${done > 1 ? ' (재독 ${done - 1}회)' : ''}' : '아직'),
            ListItem(
              label: '독서 기록',
              value: '$sessions회',
              onPress: sessions > 0 ? () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => StatsScreen(tab: false, initialBook: id))) : null,
            ),
          ]),
          if (rounds.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: Space.s),
              child: Column(children: [
                for (final r in rounds) _RoundCard(key: ValueKey('${r.id}|${r.startedAt}|${r.finishedAt}'), round: r, onSave: (s, f) => _model.updateRound(r.id, startedAt: s, finishedAt: f)),
              ]),
            )
          else
            Padding(padding: const EdgeInsets.only(top: Space.item), child: Text('읽기 시작하면 회차가 생겨요. 날짜는 나중에 고칠 수 있어요.', style: AppType.sub)),
          H2('남긴 갈피${marks.isNotEmpty ? ' · ${marks.length}' : ''}'),
          if (marks.isNotEmpty) ...[
            ListGroup(children: [
              for (final m in marks.take(5))
                Pressable(
                  onPress: () => openBookmark(context, m.id),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: Space.l),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (m.photoUri != null && m.photoUri!.isNotEmpty) ...[
                        ClipRRect(borderRadius: BorderRadius.circular(3), child: Container(width: 48, height: 64, color: AppColors.surface, child: BookmarkPhoto(uri: m.photoUri!))),
                        const SizedBox(width: Space.m),
                      ],
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          // 사진만 남긴 갈피는 글이 없다: '사진 갈피'로 보인다
                          if (m.text.trim().isNotEmpty)
                            Text(m.text, maxLines: 4, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: AppFonts.serif, fontSize: 16, height: 27 / 16, color: AppColors.ink))
                          else
                            Text('사진 갈피', style: AppType.row),
                          Padding(
                            padding: const EdgeInsets.only(top: Space.s),
                            child: Text([if (m.page != null && m.page != 0) '${m.page}쪽', ymd(m.createdAt)].where((x) => x.isNotEmpty).join(' · '), style: AppType.caption),
                          ),
                        ]),
                      ),
                    ]),
                  ),
                ),
            ]),
            Padding(padding: const EdgeInsets.only(top: Space.m), child: Btn(label: '갈피 보드로 보기', kind: 'secondary', onPress: () => openBookmarkBoard(context, id))),
          ] else
            Empty(title: '아직 남긴 갈피가 없어요', action: '첫 갈피 남기기', actionKind: 'secondary', onAction: () => openNewBookmark(context, book: widget.id)),
        ]);

    return Screen(
      compact: true,
      right: Row(mainAxisSize: MainAxisSize.min, children: [
        IconBtn(label: '책 공유', onPress: () => openBookShare(context, id), child: const LucideIcon('Share')),
        IconBtn(label: '더 보기', onPress: _menu, child: const LucideIcon('MoreHorizontal')),
      ]),
      footer: Row(children: [
        Expanded(child: Btn(label: '갈피 남기기', kind: 'secondary', size: 'l', onPress: () => openNewBookmark(context, book: widget.id))),
        const SizedBox(width: Space.s),
        Expanded(
          child: Btn(
            label: readLabel,
            size: 'l',
            onPress: () {
              Navigator.of(context).popUntil((r) => r.isFirst);
              widget.onRead != null ? widget.onRead!(id) : AppNav.instance.goRead(id);
            },
          ),
        ),
      ]),
      children: [
        Center(
          child: Padding(
            padding: const EdgeInsets.only(top: Space.xs),
            child: SizedBox(width: 300, child: Segmented<String>(items: _views, value: _tab, onChange: (v) => setState(() => _tab = v))),
          ),
        ),
        // 표지와 제목·지은이
        Padding(
          padding: const EdgeInsets.only(top: Space.xl),
          child: Column(children: [
            // 책장과 같은 판형 비율의 앞면(지금 앱 BookVisual 170)
            BookVisual(lib: lib, id: id, width: 170),
            Padding(
              padding: const EdgeInsets.only(top: Space.l),
              child: Text(e.title, textAlign: TextAlign.center, style: const TextStyle(fontFamily: AppFonts.uiTitle, fontSize: 24, height: 32 / 24, color: AppColors.ink)),
            ),
            if (e.authors.isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: Space.xs), child: Text(e.authors.join(', '), textAlign: TextAlign.center, style: AppType.sub.copyWith(fontSize: 16, height: 22 / 16))),
            ReaderRating(data: reviews.data),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.only(top: Space.xl),
          child: switch (_tab) { 'rate' => ratePane(), 'mine' => minePane(), _ => infoPane() },
        ),
      ],
    );
  }
}

/// 회차 하나: 위 구분선 + '1회차 · 읽는 중' + 시작일·완독일(달력 고르기). 완독일은 시작일 이후·시작일은 완독일 이전만 고를 수 있다
class _RoundCard extends StatelessWidget {
  const _RoundCard({super.key, required this.round, required this.onSave});
  final Round round;
  final void Function(Object? startedAt, Object? finishedAt) onSave;

  @override
  Widget build(BuildContext context) {
    final r = round;
    final s = r.startedAt != null && isDay(r.startedAt!) ? r.startedAt! : '';
    final f = r.finishedAt != null && isDay(r.finishedAt!) ? r.finishedAt! : '';
    final today = todayKey();
    const keep = Object();
    return Container(
      margin: const EdgeInsets.only(top: Space.s),
      padding: const EdgeInsets.only(top: Space.xl),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: AppColors.line, width: 1 / MediaQuery.devicePixelRatioOf(context)))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text.rich(TextSpan(
          text: '${r.index}회차${r.index > 1 ? ' · 재독' : ''}',
          style: AppType.rowStrong,
          children: [TextSpan(text: r.finishedAt != null ? '   완독' : r.paused ? '   보류' : '   읽는 중', style: AppType.sub)],
        )),
        Padding(
          padding: const EdgeInsets.only(top: Space.m),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: DateField(label: '시작일', value: s, max: f.isNotEmpty ? f : today, clearable: true, onChange: (v) => onSave(v.isEmpty ? null : v, keep)),
            ),
            const SizedBox(width: Space.m),
            Expanded(
              child: DateField(
                label: '완독일',
                value: f,
                min: s.isNotEmpty ? s : null,
                max: today,
                placeholder: '완독하면',
                disabled: r.finishedAt == null,
                onChange: (v) {
                  if (v.isNotEmpty) onSave(keep, v);
                },
              ),
            ),
          ]),
        ),
      ]),
    );
  }
}
