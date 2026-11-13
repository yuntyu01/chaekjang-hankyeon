// 독서 종료 기록(지금 앱 app/reading/finish.tsx): 연결된 책(바꾸거나 연결하기), 실제 독서 시간, 선택 입력(시작 쪽·도달한 쪽·짧은 메모) → 개인 기록 저장 또는 버리기.
// 적는 중인 쪽수·메모는 종료 초안에 함께 저장돼 앱이 꺼져도 이어서 쓴다. 분량은 시작 쪽과 도달한 쪽을 둘 다 알 때만 보인다.
// 저장 후: 이번 기록 요약 → 이어서 할 수 있는 일(줄 목록) → 아래 '확인' 하나
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../domain/library.dart';
import '../../domain/reading.dart';
import '../../services/ambient.dart';
import '../../store/finish_reading.dart';
import '../../store/library_model.dart';
import '../../store/reading_store.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart';
import '../stats/stats_screen.dart';

int? _page(String? v) {
  final digits = (v ?? '').replaceAll(RegExp(r'[^\d]'), '');
  final n = int.tryParse(digits);
  return v != null && v.trim().isNotEmpty && n != null && n > 0 ? n : null;
}

String hm(String iso) {
  final d = DateTime.parse(iso).toLocal();
  return '${d.hour}:${d.minute.toString().padLeft(2, '0')}';
}

const _tabular = [FontFeature.tabularFigures()];

/// 아직 옮기지 않은 화면
Future<void> _pending(BuildContext context, String title) => Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => Screen(title: title, children: const [Empty(title: '준비 중이에요', body: '이 화면은 다음 단계에서 옮겨요.')]),
    ));

class FinishScreen extends StatefulWidget {
  const FinishScreen({super.key});

  @override
  State<FinishScreen> createState() => _FinishScreenState();
}

class _FinishScreenState extends State<FinishScreen> {
  final _reading = ReadingStore.instance;
  final _lib = LibraryModel.instance;
  late String _startPage, _pages, _memo;
  ({String? bookId, String sessionId})? _saved;
  bool _saving = false;
  bool _leaving = false;
  Timer? _notes;
  String? _lastBook;

  @override
  void initState() {
    super.initState();
    final p = _reading.pending;
    final n = p?.notes;
    _startPage = n?.startPage ?? (p?.startPage != null ? '${p!.startPage}' : '');
    _pages = n?.pages ?? '';
    _memo = n?.memo ?? '';
    _lastBook = p?.myBookId;
    _reading.addListener(_changed);
    _lib.addListener(_changed);
    _lib.load();
  }

  @override
  void dispose() {
    _notes?.cancel();
    _reading.removeListener(_changed);
    _lib.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    // 책을 바꾸면 시작 쪽 기본값도 그 책의 지금 쪽으로
    final p = _reading.pending;
    if (p != null && p.myBookId != _lastBook) {
      _lastBook = p.myBookId;
      _startPage = p.startPage != null ? '${p.startPage}' : '';
    }
    setState(() {});
  }

  // 적는 중인 값을 초안에 남긴다(잠깐 멈춘 뒤 한 번)
  void _edited() {
    setState(() {});
    _notes?.cancel();
    _notes = Timer(const Duration(milliseconds: 400), () {
      if (_saved == null) _reading.setPendingNotes(startPage: _startPage, pages: _pages, memo: _memo);
    });
  }

  void _toRead() => Navigator.of(context).popUntil((r) => r.isFirst);

  Future<void> _save(FinishDraft pending, int? sp, int? ep) async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      await saveFinishedReading(pending, startPage: pending.myBookId != null ? sp : null, pagesRead: pending.myBookId != null ? ep : null, memo: _memo.trim().isEmpty ? null : _memo.trim());
      Ambient.instance.stop();
      setState(() => _saved = (bookId: pending.myBookId, sessionId: pending.id));
    } catch (e) {
      if (mounted) appAlert(context, '저장하지 못했어요', '독서 기록을 유지하고 있어요. 다시 시도해 주세요.\n$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _discard(FinishDraft pending) => appAlert(context, '이번 독서 기록을 버릴까요?', '${formatDurationPrecise(pending.durationMs)}이 저장되지 않아요.', [
        const AlertButton('취소', style: AlertStyle.cancel),
        AlertButton('버리기', style: AlertStyle.destructive, onPress: () {
          if (_leaving) return;
          _leaving = true;
          Ambient.instance.stop();
          final nav = Navigator.of(context);
          final reading = _reading;
          _toRead();
          // 화면을 먼저 옮긴 뒤 초안을 지운다
          Future<void>.delayed(const Duration(milliseconds: 500), () => reading.clearPending().catchError((_) {
                if (nav.mounted) appAlert(nav.context, '버리지 못했어요', '독서 기록을 저장소에서 지우지 못했어요. 다음에 다시 열면 다시 물어볼게요.');
              }));
        }),
      ]);

  @override
  Widget build(BuildContext context) {
    final lib = _lib.lib;
    final saved = _saved;
    if (saved != null) {
      final ss = lib.sessions[saved.sessionId];
      final sb = saved.bookId == null ? null : lib.books[saved.bookId];
      final se = sb == null ? null : lib.editions[sb.editionId];
      final pagesText = ss != null && ss.startPage != null && ss.pagesRead != null && ss.pagesRead! >= ss.startPage!
          ? '${ss.startPage}→${ss.pagesRead}쪽(${ss.pagesRead! - ss.startPage!}쪽)'
          : ss?.pagesRead != null && ss!.pagesRead != 0
              ? '${ss.pagesRead}쪽까지'
              : null;
      return Screen(
        title: '저장했어요',
        back: false,
        footer: Btn(label: '확인', size: 'l', onPress: _toRead),
        children: [
          Container(
            padding: const EdgeInsets.symmetric(vertical: Space.l),
            decoration: BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.line, width: 1 / MediaQuery.devicePixelRatioOf(context)))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(se?.title ?? '책 없이 읽은 시간', maxLines: 2, style: AppType.rowStrong),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  [if (ss != null) ss.durationMs < 60000 ? formatDurationPrecise(ss.durationMs) : formatDuration(ss.durationMs), ?pagesText].join(' · '),
                  style: AppType.sub,
                ),
              ),
            ]),
          ),
          const H2('이어서 할 수 있어요', first: true),
          ListGroup(children: [
            if (saved.bookId != null) ListItem(label: '이 책에 갈피 남기기', sub: '이번 기록과 연결돼요', chevron: true, onPress: () => _pending(context, '갈피 남기기')),
            if (saved.bookId != null) ListItem(label: '책 정보 보기', chevron: true, onPress: () => _pending(context, '책 정보')),
            ListItem(
              label: '내 기록 보기',
              chevron: true,
              onPress: () => Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => const StatsScreen(tab: false))),
            ),
          ]),
        ],
      );
    }
    final pending = _reading.pending;
    if (pending == null) {
      return Screen(title: '독서 기록', children: [Empty(title: '끝낸 독서가 없어요', action: '읽기로', onAction: _toRead)]);
    }
    final b = pending.myBookId == null ? null : lib.books[pending.myBookId];
    final e = b == null ? null : lib.editions[b.editionId];
    final sp = _page(_startPage), ep = _page(_pages);
    final amount = sp != null && ep != null && ep >= sp ? ep - sp : null;
    final badRange = sp != null && ep != null && ep < sp;
    final hair = 1 / MediaQuery.devicePixelRatioOf(context);
    return Screen(
      title: '독서 끝',
      back: false,
      footer: Btn(label: '개인 기록 저장', busy: _saving, disabled: !_lib.loaded || _saving || pending.durationMs < 1000 || badRange, onPress: () => _save(pending, sp, ep)),
      children: [
        if (_reading.error != null) Text('독서 기록을 기기에 저장하지 못했어요. 저장을 다시 시도해 주세요.', style: AppType.sub),
        Semantics(
          label: '실제 독서 시간 ${formatDurationPrecise(pending.durationMs)}',
          excludeSemantics: true,
          child: Container(
            margin: const EdgeInsets.only(top: Space.s, bottom: Space.xl),
            padding: const EdgeInsets.symmetric(vertical: Space.xl),
            decoration: BoxDecoration(border: Border(bottom: BorderSide(color: AppColors.line, width: hair))),
            child: Column(children: [
              Text('실제 독서 시간', style: AppType.sub),
              Padding(
                padding: const EdgeInsets.only(top: Space.s),
                child: Text(pending.durationMs < 60000 ? formatDurationPrecise(pending.durationMs) : formatDuration(pending.durationMs),
                    style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 36, height: 44 / 36, color: AppColors.ink, fontFeatures: _tabular)),
              ),
              Padding(padding: const EdgeInsets.only(top: Space.xs), child: Text('${hm(pending.startedAt)} ~ ${hm(pending.endedAt)} · 일시정지 시간 제외', style: AppType.caption)),
            ]),
          ),
        ),
        SelectField(
          label: '연결된 책',
          value: e?.title,
          placeholder: '책 연결하기 (선택)',
          onPress: () async {
            final r = await pickBook(context, lib, allowNone: true);
            if (r.picked) _reading.setPendingBook(r.id, r.id == null ? null : lib.books[r.id]?.currentPage);
          },
        ),
        if (b != null) ...[
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Field(
                label: '시작 쪽 (선택)',
                unit: '쪽',
                number: true,
                value: _startPage,
                placeholder: b.currentPage != null && b.currentPage != 0 ? '지난번 ${b.currentPage}' : null,
                onChange: (v) {
                  _startPage = v;
                  _edited();
                },
              ),
            ),
            const SizedBox(width: Space.m),
            Expanded(
              child: Field(
                label: '도달한 쪽 (선택)',
                unit: '쪽',
                number: true,
                value: _pages,
                error: badRange ? '시작 쪽보다 앞이에요' : null,
                onChange: (v) {
                  _pages = v;
                  _edited();
                },
              ),
            ),
          ]),
          if (amount != null) Transform.translate(offset: const Offset(0, -Space.s), child: Padding(padding: const EdgeInsets.only(bottom: Space.l - Space.s), child: Text('이번에 $amount쪽 읽었어요.', style: AppType.sub))),
        ],
        Field(
          label: '짧은 메모 (선택)',
          value: _memo,
          placeholder: '나만 보는 메모예요',
          multiline: true,
          minHeight: 80,
          onChange: (v) {
            _memo = v;
            _edited();
          },
        ),
        Padding(padding: const EdgeInsets.only(top: Space.s), child: TextLink(label: '이 기록 버리기', soft: true, onPress: () => _discard(pending))),
      ],
    );
  }
}
