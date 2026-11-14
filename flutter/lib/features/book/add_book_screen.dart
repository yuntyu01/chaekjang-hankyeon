// 책 추가(지금 앱 app/book/add.tsx): 책 찾기(검색·직접 입력) → 책·판본 확인 → 추가하고 책장에 놓기(기본) 또는 보관만 하기.
// 저장한 뒤 다시 묻지 않는다. 자리가 모자랄 때만 새 선반 열기 / 보관만 하기를 고른다(place_books). 보관만 한 책도 전체 책에 있다.
// 검색 결과·표지·쪽수가 없어도 직접 입력과 기본 장정으로 끝낼 수 있다. 추정 크기를 확인된 정보처럼 저장하지 않는다
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../domain/library.dart';
import '../../domain/rebinding.dart';
import '../../services/book_search.dart';
import '../../services/cover_colors.dart' show coverDominantColor, coverPalette, measureCover;
import '../../services/photos.dart';
import '../../store/files.dart' show keepImage;
import '../../store/library_model.dart';
import '../../store/placement_store.dart';
import '../../ui/alert.dart';
import '../../ui/book_visual.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart' show statusLabel;
import 'all_books_screen.dart' show openAllBooks;
import 'book_screen.dart' show BookScreen;
import 'place_books.dart';

const _statuses = [ReadStatus.want, ReadStatus.reading, ReadStatus.read, ReadStatus.paused];

/// 책 추가 열기. q: 바로 검색, title: 직접 입력 확인 단계로. pick: 책 고르기에서 '새 책 등록'으로 왔다(추가한 책 id를 돌려준다)
Future<String?> openAddBook(BuildContext context, {String? q, String? title, bool pick = false}) => Navigator.of(context, rootNavigator: true)
    .push<String>(MaterialPageRoute(settings: const RouteSettings(name: '/book/add'), builder: (_) => AddBookScreen(q: q, title: title, pick: pick)));

class _Draft {
  _Draft(this.source);
  String title = '', authors = '', publisher = '', publishedAt = '', isbn = '', pages = '', width = '', height = '';
  String? coverUri, coverSource, category, seriesTitle, sourceName, link, productId;
  final String source; // manual · search · photo
  ReadStatus status = ReadStatus.want;
}

int? _num(String v) {
  final n = double.tryParse(v.replaceAll(RegExp(r'[^\d.]'), ''));
  return n != null && n.isFinite && n > 0 ? n.round() : null;
}

class AddBookScreen extends StatefulWidget {
  const AddBookScreen({super.key, this.q, this.title, this.pick = false});
  final String? q, title;
  final bool pick;

  @override
  State<AddBookScreen> createState() => _AddBookScreenState();
}

class _AddBookScreenState extends State<AddBookScreen> {
  late String _step = widget.title != null ? 'confirm' : 'find'; // find · confirm
  late _Draft _draft = _Draft('manual')..title = widget.title ?? '';
  String? _notice;
  bool _saving = false, _more = false;

  /// 판형(가로·세로 mm): 둘 다 있을 때만
  ({int widthMm, int heightMm})? get _size {
    final w = _num(_draft.width), h = _num(_draft.height);
    return w != null && h != null ? (widthMm: math.min(w, h), heightMm: math.max(w, h)) : null;
  }

  void _toConfirm(_Draft d, [String? msg]) => setState(() {
        _draft = d;
        _notice = msg;
        _step = 'confirm';
      });

  /// 고르면 그 판본의 상세(쪽수·판형·ISBN)를 읽어 채운다(없으면 비워 둔 채로 확인 단계로)
  Future<void> _fromCandidate(BookCandidate picked) async {
    setState(() => _notice = '판본 정보를 확인하는 중…');
    final c = await candidateDetails(picked);
    if (!mounted) return;
    final d = _Draft('search')
      ..title = c.title
      ..authors = c.authors.join(', ')
      ..publisher = c.publisher ?? ''
      ..publishedAt = c.publishedAt ?? ''
      ..isbn = c.isbn13 ?? ''
      ..pages = c.pageCount?.toString() ?? ''
      ..width = c.size?.widthMm.toString() ?? ''
      ..height = c.size?.heightMm.toString() ?? ''
      ..coverUri = c.coverUrl
      ..coverSource = c.coverUrl != null ? 'api' : null
      ..category = c.category
      ..seriesTitle = c.seriesTitle
      ..sourceName = c.sourceName
      ..link = c.link
      ..productId = c.productId;
    final missing = [if (c.pageCount == null) '쪽수', if (c.size == null) '판형'];
    _toConfirm(d, missing.isEmpty ? null : '${c.sourceName} 판본 기록에 ${missing.join('·')} 정보가 없어요. 알면 적고, 모르면 비워 두세요(장정은 흔한 크기로 만들고 ‘확인 전’으로 표시해요).');
  }

  /// 같은 ISBN이 이미 서재에 있으면: 기존 책 보기 / 별도 소장본으로 추가. 다시 읽기는 재등록이 아니라 기존 책에서
  void _confirmDuplicate(VoidCallback go) {
    final code = _draft.isbn.replaceAll(RegExp(r'[^\dXx]'), '');
    final lib = LibraryModel.instance.lib;
    final dup = code.isEmpty ? null : lib.books.values.where((b) => b.hiddenAt == null && lib.editions[b.editionId]?.isbn13 == code).firstOrNull;
    if (dup == null) return go();
    appAlert(context, '이미 내 서재에 있는 책이에요',
        '같은 ISBN의 책이 있어요. 다시 읽으려면 그 책에서 ‘다시 읽기’를 하면 지난 기록이 그대로 이어져요. 같은 책을 한 권 더 가지고 있다면 별도 소장본으로 추가할 수 있어요.', [
      const AlertButton('취소', style: AlertStyle.cancel),
      AlertButton('기존 책 보기', onPress: () => Navigator.of(context).pushReplacement(MaterialPageRoute<void>(settings: const RouteSettings(name: '/book'), builder: (_) => BookScreen(id: dup.id)))),
      AlertButton('별도 소장본으로 추가', onPress: go),
    ]);
  }

  /// 추천 장정 계산: 표지는 색 추출에만 쓰고(화면에 그리지 않는다) 결과 장정만 저장한다. 책등 사진 비율·갈피 색도 먼저 잰다(처음 놓을 때부터 실제 두께로)
  Future<BookArtParams> _prepareArt() async {
    final d = _draft;
    final api = d.coverSource == 'api' && d.coverUri != null;
    final palette = api ? await coverPalette(d.coverUri) : null;
    if (api) await measureCover(d.coverUri!);
    final coverColor = api ? await coverDominantColor(d.coverUri) : null;
    final year = int.tryParse(d.publishedAt.length >= 4 ? d.publishedAt.substring(0, 4) : '') ?? 0;
    final built = buildBookArt(
      RebindInput(
        title: d.title.trim(),
        isbn: d.isbn.replaceAll(RegExp(r'[^\dXx]'), '').isEmpty ? null : d.isbn.replaceAll(RegExp(r'[^\dXx]'), ''),
        authors: const [],
        publisher: d.publisher,
        publishedYear: year > 0 ? year : null,
        pageCount: _num(d.pages),
        heightMm: _size?.heightMm,
        widthMm: _size?.widthMm,
        category: d.category,
        seriesTitle: d.seriesTitle,
        palette: palette,
        coverColor: coverColor,
      ),
      DateTime.now().toUtc().toIso8601String(),
    );
    // 표지 색을 못 읽었으면 판 번호를 낮춰 다음 시작 때 다시 맞춘다(표지 색 맞추기)
    return BookArtParams(built.baseColor, built.inkColor, built.accentColor, built.motifId, built.layoutVariant, built.heightClass, built.thicknessClass, built.generatedAt,
        api && coverColor == null ? 1 : built.version);
  }

  /// 등록 완료: shelf(기본)는 바로 책장에 놓고, keep은 책장에 없는 책으로 보관만 한다
  Future<void> _add({bool keep = false}) async {
    setState(() => _saving = true);
    try {
      final art = await _prepareArt();
      final d = _draft;
      var coverUri = d.coverUri;
      if (coverUri != null && d.coverSource == 'photo') coverUri = await keepImage(coverUri, 'cover');
      final isbn = d.isbn.replaceAll(RegExp(r'[^\dXx]'), '');
      final id = await LibraryModel.instance.addBook(
        title: d.title.trim(),
        authors: [for (final a in d.authors.split(',')) if (a.trim().isNotEmpty) a.trim()],
        publisher: d.publisher.trim().isEmpty ? null : d.publisher.trim(),
        publishedAt: d.publishedAt.trim().isEmpty ? null : d.publishedAt.trim(),
        isbn13: isbn.isEmpty ? null : isbn,
        pageCount: _num(d.pages),
        widthMm: _size?.widthMm,
        heightMm: _size?.heightMm,
        category: d.category,
        seriesTitle: d.seriesTitle,
        art: art,
        coverUri: coverUri,
        coverSource: coverUri != null ? d.coverSource : null,
        source: d.source,
        sourceName: d.sourceName,
        link: d.link,
        productId: d.productId,
        status: d.status,
      );
      // 책장 쪽 책 목록에 새 책을 넣고 놓는다
      await PlacementStore.instance.reload();
      if (!mounted) return;
      String placed;
      if (keep) {
        await PlacementStore.instance.addToDrawer(id);
        placed = 'kept';
      } else {
        final r = await placeWithChoice(context, [id]);
        placed = r.placed > 0 ? 'shelf' : 'kept';
      }
      if (mounted) await _showDone(id, placed);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// 추가 완료(결과만 알린다. 다시 묻지 않는다): 밑에서 올라오는 시트. 닫으면 책 추가를 부른 화면으로
  Future<void> _showDone(String id, String placed) async {
    final lib = LibraryModel.instance.lib;
    final nav = Navigator.of(context);
    String? next;
    await showSheet<void>(
      context,
      title: '추가했어요',
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (lib.books[id] != null) SizedBox(width: 88, child: BookVisual(lib: lib, id: id, width: 88)),
          const SizedBox(width: Space.l),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_draft.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
              if (_draft.authors.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(_draft.authors, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub)),
              Padding(
                padding: const EdgeInsets.only(top: Space.m),
                child: Text(placed == 'shelf' ? '책장에 진열했어요' : '전체 책에만 보관했어요', style: AppType.button.copyWith(color: AppColors.accent)),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(placed == 'shelf' ? '꾸미기에서 자리와 자세를 바꿀 수 있어요.' : '책장에는 아직 없어요. 전체 책에서 언제든 진열할 수 있어요.', style: AppType.caption),
              ),
            ]),
          ),
        ]),
        const SizedBox(height: Space.xl),
        if (widget.pick)
          Btn(label: '이 책으로 계속 쓰기', onPress: () => Navigator.pop(ctx))
        else ...[
          if (placed == 'shelf')
            Btn(label: '책장에서 보기', onPress: () {
              next = 'shelf';
              Navigator.pop(ctx);
            })
          else
            Btn(label: '전체 책 보기', onPress: () {
              next = 'books';
              Navigator.pop(ctx);
            }),
          const SizedBox(height: Space.s),
          Btn(label: '책 정보 보기', kind: 'secondary', onPress: () {
            next = 'book';
            Navigator.pop(ctx);
          }),
          const SizedBox(height: Space.s),
          Btn(label: '한 권 더 추가', kind: 'ghost', onPress: () {
            next = 'again';
            Navigator.pop(ctx);
          }),
        ],
      ]),
    );
    if (!mounted) return;
    switch (next) {
      case 'shelf':
        nav.popUntil((r) => r.isFirst);
      case 'books':
        nav.pop(id);
        if (nav.context.mounted) openAllBooks(nav.context, offShelf: true);
      case 'book':
        nav.pushReplacement(MaterialPageRoute<void>(settings: const RouteSettings(name: '/book'), builder: (_) => BookScreen(id: id)));
      case 'again':
        nav.pushReplacement(MaterialPageRoute<void>(settings: const RouteSettings(name: '/book/add'), builder: (_) => const AddBookScreen()));
      default:
        // 닫으면 책 추가를 부른 화면으로(이미 추가했으니 확인 화면에 머물지 않는다)
        nav.pop(id);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_step == 'find') {
      return _FindStep(initial: widget.q, notice: _notice, onPick: _fromCandidate, onManual: (q) => _toConfirm(_Draft('manual')..title = q));
    }
    final d = _draft;
    final ready = d.title.trim().isNotEmpty && !_saving;
    return Screen(
      title: '책 확인',
      footer: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // 주요 행동: 추천 장정으로 바로 추가(책장에 놓기). 장정은 고르고 싶을 때만(보조)
        Btn(label: '추천 장정으로 추가', disabled: !ready, busy: _saving, onPress: () => _confirmDuplicate(() => _add())),
        Padding(
          padding: const EdgeInsets.only(top: Space.xs),
          child: Center(child: TextLink(label: '보관만 하기', soft: true, disabled: !ready, onPress: () => _confirmDuplicate(() => _add(keep: true)))),
        ),
      ]),
      children: [
        if (_notice != null) Padding(padding: const EdgeInsets.only(top: Space.m, bottom: Space.l), child: _Notice(_notice!)),
        // 시안: 표지 가운데 + '표지 바꾸기', 아래 제공처 한 줄. 입력은 제목(필수)·저자·전체 쪽수만 펼쳐 두고 나머지는 '추가 정보'에 접는다
        Padding(
          padding: const EdgeInsets.only(top: Space.s, bottom: Space.l),
          child: Column(children: [
            DecoratedBox(
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(3), boxShadow: [cssShadow(const Color(0x1A000000), 0, 2, 4)]),
              child: RealCover(uri: d.coverUri, title: d.title.isEmpty ? '표지' : d.title, color: '#F2F4F6', width: 120),
            ),
            Padding(
              padding: const EdgeInsets.only(top: Space.l),
              // 지금 앱: 작은 글자 단추에 옅은 회색 바탕, 좌우 여백 넓게(coverButton)
              child: DecoratedBox(
                decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(Shape.button)),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Space.xl - 16), // 작은 단추 안쪽 16 → 지금 앱 28
                  child: Btn(
                label: d.coverUri != null ? '표지 바꾸기' : '표지 사진 등록',
                kind: 'ghost',
                size: 's',
                onPress: () async {
                  final r = await pickPhoto('library');
                  if (!mounted) return;
                  if (r case PhotoOk(:final uri)) {
                    setState(() => d
                      ..coverUri = uri
                      ..coverSource = 'photo');
                  } else if (r case PhotoFail(reason: 'denied')) {
                    setState(() => _notice = deniedMessage('library'));
                  }
                },
              ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: Space.s),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Text(d.coverUri != null ? (d.coverSource == 'photo' ? '내가 찍은 사진' : '${d.sourceName ?? '도서 정보'} 제공') : '표지가 없어요', style: AppType.caption),
                if (d.link != null && d.coverSource != 'photo')
                  Semantics(
                    link: true,
                    label: '${d.sourceName ?? '판매처'}에서 원문 보기',
                    excludeSemantics: true,
                    child: Pressable(
                      onPress: () => launchUrl(Uri.parse(d.link!), mode: LaunchMode.externalApplication),
                      child: Text.rich(TextSpan(text: ' · ', style: AppType.caption, children: [
                        TextSpan(text: '원문 보기', style: AppType.caption.copyWith(decoration: TextDecoration.underline, color: AppColors.inkSoft)),
                      ])),
                    ),
                  ),
              ]),
            ),
          ]),
        ),
        Field(label: '제목 (필수)', value: d.title, onChange: (t) => setState(() => d.title = t), placeholder: '책 제목'),
        Field(label: '저자 (선택)', value: d.authors, onChange: (t) => setState(() => d.authors = t), placeholder: '여러 명은 쉼표로'),
        Field(label: '전체 쪽수 (선택)', value: d.pages, onChange: (t) => setState(() => d.pages = t), placeholder: '쪽수 입력', number: true),
        Semantics(
          button: true,
          expanded: _more,
          child: Pressable(
            onPress: () => setState(() => _more = !_more),
            child: Container(
              constraints: const BoxConstraints(minHeight: 64),
              margin: const EdgeInsets.only(top: Space.xl),
              padding: const EdgeInsets.only(top: Space.l),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: AppColors.line, width: 1 / MediaQuery.devicePixelRatioOf(context)))),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('추가 정보', style: AppType.section),
                    Padding(padding: const EdgeInsets.only(top: 2), child: Text('출판사 · ISBN · 판형 · 읽기 상태', style: AppType.caption)),
                  ]),
                ),
                LucideIcon(_more ? 'ChevronUp' : 'ChevronDown', color: AppColors.inkSoft),
              ]),
            ),
          ),
        ),
        if (_more)
          Padding(
            padding: const EdgeInsets.only(top: Space.s),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Field(label: '출판사', value: d.publisher, onChange: (t) => setState(() => d.publisher = t)),
              Field(label: 'ISBN', value: d.isbn, onChange: (t) => setState(() => d.isbn = t), number: true),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Field(label: '판형 가로(mm)', value: d.width, onChange: (t) => setState(() => d.width = t), number: true)),
                const SizedBox(width: Space.m),
                Expanded(child: Field(label: '판형 세로(mm)', value: d.height, onChange: (t) => setState(() => d.height = t), number: true)),
              ]),
              Text('쪽수·판형을 모르면 비워 두세요. 책장에는 흔한 크기로 보이고, 상세에는 ‘확인 전’으로 표시돼요.', style: AppType.sub),
              const H2('읽기 상태'),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final s in _statuses) AppChip(label: statusLabel[s]!, on: d.status == s, onPress: () => setState(() => d.status = s)),
              ]),
            ]),
          ),
      ],
    );
  }
}

/// 책 추가 첫 화면(2026-11-01 사용자): 검색창 → 결과 → 추가가 전부. 직접 입력은 결과 아래·결과 없음·검색 실패 때의 작은 '직접 등록'으로만
class _FindStep extends StatefulWidget {
  const _FindStep({required this.initial, required this.notice, required this.onPick, required this.onManual});
  final String? initial, notice;
  final ValueChanged<BookCandidate> onPick;
  final ValueChanged<String> onManual;

  @override
  State<_FindStep> createState() => _FindStepState();
}

class _FindStepState extends State<_FindStep> {
  late String _q = widget.initial ?? '';
  List<BookCandidate>? _items;
  String? _provider, _err;
  bool _busy = false;
  int _run = 0;
  List<BookCandidate> _popular = const [];

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _search(widget.initial!);
    } else {
      popularBooks().then((list) {
        if (mounted) setState(() => _popular = list);
      });
    }
  }

  Future<void> _search([String? text]) async {
    final t = (text ?? _q).trim();
    if (t.isEmpty) return;
    final run = ++_run;
    setState(() {
      _busy = true;
      _err = null;
    });
    final r = await searchBooks(t);
    // 늦게 온 결과로 새 검색 화면을 덮지 않는다
    if (!mounted || run != _run) return;
    setState(() {
      _busy = false;
      if (r.ok) {
        _items = r.items;
        _provider = r.provider;
      } else {
        _err = r.message;
        _items = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Screen(
      // 큰 제목 없이 뒤로 옆에 검색창(전체 책·내 책 찾기와 같은 머리줄)
      headerField: SearchField(
        value: _q,
        onChange: (t) => setState(() {
          _q = t;
          if (t.isEmpty) {
            _run++;
            _busy = false;
            _items = null;
            _err = null;
          }
        }),
        onSubmit: () => _search(),
        busy: _busy,
        placeholder: '새 책 찾기 · 제목이나 저자',
        label: '제목이나 저자로 찾기',
      ),
      children: [
        if (widget.notice != null) Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(widget.notice!, style: AppType.sub)),
        if (_busy && items == null) const Loading(label: '책을 찾는 중이에요'),
        if (_err != null)
          Padding(
            padding: const EdgeInsets.only(top: Space.xl),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _Notice(_err!, error: true),
              const SizedBox(height: Space.s),
              Btn(label: '다시 시도', kind: 'secondary', size: 's', onPress: () => _search()),
              _ManualLink(onPress: () => widget.onManual(_q)),
            ]),
          ),
        if (items != null && items.isEmpty && !_busy)
          Empty(title: '‘${_q.trim()}’에 맞는 책이 없어요', body: '제목이나 저자 이름을 짧게 줄여 찾거나, 직접 등록할 수 있어요.', action: '직접 등록', actionKind: 'secondary', onAction: () => widget.onManual(_q)),
        // 검색 전: 인기 많은 책(YES24 베스트셀러 순위 그대로, 못 받으면 아무것도 보이지 않는다)
        if (_q.trim().isEmpty && items == null && !_busy && _err == null && _popular.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: Space.xl),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                Expanded(child: Semantics(header: true, child: Text('인기 많은 책', style: AppType.section))),
                Text('YES24 베스트셀러', style: AppType.caption),
              ]),
              const SizedBox(height: Space.s),
              for (final (i, c) in _popular.indexed) _ResultRow(c: c, rank: i + 1, onPick: widget.onPick),
            ]),
          ),
        if (items != null && items.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: Space.xl),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              // 결과 머리: 구역 이름처럼 작게(출처 표시는 YES24 약관)
              Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                Expanded(child: Text('검색 결과 ${items.length}권', style: AppType.sub)),
                if (_provider != null) Text('$_provider 제공', style: AppType.caption),
              ]),
              const SizedBox(height: Space.s),
              for (final c in items) _ResultRow(c: c, onPick: widget.onPick),
              _ManualLink(onPress: () => widget.onManual(_q)),
            ]),
          ),
      ],
    );
  }
}

/// 검색 결과·인기 책 한 줄: 표지·제목·저자, 오른쪽 '추가'. rank가 있으면 맨 앞에 순위. 줄 사이 선 없이 여백만, 누르는 동안 옅은 바탕(화면 끝까지)
class _ResultRow extends StatefulWidget {
  const _ResultRow({required this.c, required this.onPick, this.rank});
  final BookCandidate c;
  final int? rank;
  final ValueChanged<BookCandidate> onPick;

  @override
  State<_ResultRow> createState() => _ResultRowState();
}

class _ResultRowState extends State<_ResultRow> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    return Semantics(
      button: true,
      label: '${c.title}, ${c.authors.join(', ')}, 추가',
      excludeSemantics: true,
      onTap: () => widget.onPick(c),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: () => widget.onPick(c),
        // 누르는 동안 옅은 바탕을 화면 끝까지(좌우 여백만큼 바깥으로) 칠한다
        child: Stack(clipBehavior: Clip.none, children: [
          if (_down) const Positioned(left: -Space.page, right: -Space.page, top: 0, bottom: 0, child: ColoredBox(color: AppColors.surface)),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Space.m),
            child: Row(children: [
              if (widget.rank != null)
                SizedBox(width: 22, child: Text('${widget.rank}', textAlign: TextAlign.center, style: AppType.rowStrong.copyWith(fontFeatures: const [FontFeature.tabularFigures()]))),
              if (widget.rank != null) const SizedBox(width: Space.l),
              DecoratedBox(
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(3), boxShadow: [cssShadow(const Color(0x1A000000), 0, 2, 4)]),
                child: RealCover(uri: c.coverUrl, title: c.title, color: '#F2F4F6', width: 56, ratio: 0.72),
              ),
              const SizedBox(width: Space.l),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowStrong),
                  if (c.authors.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(c.authors.join(', '), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.sub)),
                ]),
              ),
              const SizedBox(width: Space.l),
              Container(
                constraints: const BoxConstraints(minHeight: 36),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.line)),
                child: Text('추가', style: TextStyle(fontFamily: AppFonts.uiBold, fontSize: 15, height: 20 / 15, color: AppColors.ink)),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// 검색으로 못 찾았을 때만 쓰는 보조 경로
class _ManualLink extends StatelessWidget {
  const _ManualLink({required this.onPress});
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: '원하는 책이 없나요? 직접 등록',
        excludeSemantics: true,
        child: Center(
          child: Pressable(
            onPress: onPress,
            child: Container(
              constraints: const BoxConstraints(minHeight: Space.touch),
              margin: const EdgeInsets.only(top: Space.l),
              alignment: Alignment.center,
              child: Text.rich(TextSpan(text: '원하는 책이 없나요? ', style: AppType.sub, children: [
                TextSpan(text: '직접 등록', style: AppType.sub.copyWith(fontFamily: AppFonts.uiBold, color: AppColors.accent)),
              ])),
            ),
          ),
        ),
      );
}

/// 안내 상자(지금 앱 Notice): 옅은 회색 바탕, 오류면 붉은 글자
class _Notice extends StatelessWidget {
  const _Notice(this.text, {this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) => Semantics(
        liveRegion: true,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(Shape.input)),
          child: Text(text, style: AppType.sub.copyWith(color: error ? AppColors.danger : AppColors.ink)),
        ),
      );
}
