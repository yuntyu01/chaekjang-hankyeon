// 갈피 남기기(지금 앱 app/bookmark/new.tsx, 2026-11-05 사용자 '찍고 나야지 문장을 쓰는 것 아닌가'): 책 → 사진 버튼 → 문장 → 쪽수 → 메모 순서.
// - 문장은 바로 적어도 되고, 사진을 찍거나 골라 간직할 부분을 자르면 기기 안 문장 인식이 바로 돌아 문장 칸을 채운다(사진은 밖으로 보내지 않는다).
//   읽은 글자는 사진과 비교해 고칠 수 있고, 인식하지 못한 부분을 지어내지 않는다.
// - 사진을 고른 뒤 '사진만 저장'을 켜면 글자 없이 종이·테이프 갈피 모양의 사진으로 저장한다. 끄면 원본 사진을 함께 보관할지 고른다.
// 저장에 실패하면 글·사진을 그대로 두고 다시 시도할 수 있다. 적은 것이 있으면 나가기 전에 묻는다
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../domain/ocr_text.dart';
import '../../services/photos.dart';
import '../../services/text_recognition.dart';
import '../../store/files.dart' show keepImage;
import '../../store/library_model.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import 'book_picker.dart' show pickBook;
import 'bookmark_detail_screen.dart' show BookmarkDetailScreen;
import 'photo_plate.dart';

/// 갈피 남기기 열기. book: 고른 책, session: 독서를 끝내고 저장한 기록에서 왔을 때 그 기록(갈피에 연결), photoOnly: '사진 갈피'로
Future<void> openNewBookmark(BuildContext context, {String? book, String? session, String? text, String? page, bool photoOnly = false, num? boardX, num? boardY}) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(
      settings: const RouteSettings(name: '/bookmark/new'),
      builder: (_) => NewBookmarkScreen(book: book, session: session, text: text, page: page, photoOnly: photoOnly, boardX: boardX, boardY: boardY),
    ));

class NewBookmarkScreen extends StatefulWidget {
  const NewBookmarkScreen({super.key, this.book, this.session, this.text, this.page, this.photoOnly = false, this.boardX, this.boardY});
  final String? book, session, text, page;
  final bool photoOnly;
  final num? boardX, boardY;

  @override
  State<NewBookmarkScreen> createState() => _NewBookmarkScreenState();
}

typedef _Photo = ({String uri, double? ratio});

class _NewBookmarkScreenState extends State<NewBookmarkScreen> {
  final _model = LibraryModel.instance;
  late String? _bookId = widget.book != null && _model.lib.books[widget.book] != null ? widget.book : null;
  late String _text = widget.text ?? '';
  late String _page = widget.page ?? '';
  String _memo = '';
  _Photo? _photo;
  late bool _photoOnly = widget.photoOnly;
  bool _keepPhoto = true; // 글자로 저장할 때 원본 사진도 함께 보관
  LineMode _lineMode = LineMode.join;

  /// 인식: 사진 주소와 상태(running · done · failed)
  ({String uri, String state, OcrResult? result})? _recog;
  bool _edited = false; // 인식 결과를 고쳤으면 줄 방식을 바꿀 때 덮어쓰지 않는다
  String? _msg, _saveError;
  bool _saving = false;

  /// 문장 칸(인식 결과로 채울 때 바꾼다)
  int _textVersion = 0;

  bool get _asPhoto => _photo != null && _photoOnly;
  bool get _canSave => _bookId != null && !_saving && (_asPhoto || _text.trim().isNotEmpty);
  bool get _dirty => _text.trim().isNotEmpty || _memo.trim().isNotEmpty || _photo != null;

  void _setText(String t) => setState(() {
        _text = t;
        _textVersion++;
      });

  Future<void> _runOcr(_Photo p) async {
    if (!textRecognitionAvailable) return;
    setState(() => _recog = (uri: p.uri, state: 'running', result: null));
    try {
      final r = await recognizeText(p.uri.startsWith('file://') ? Uri.parse(p.uri).toFilePath() : p.uri);
      if (!mounted || _recog?.uri != p.uri) return;
      setState(() => _recog = (uri: p.uri, state: 'done', result: r));
      // 비어 있던 문장만 채운다(직접 적은 글을 덮지 않는다)
      if (_text.trim().isEmpty) _setText(ocrText(r, _lineMode));
      _edited = false;
    } catch (e) {
      debugPrint('[ocr] 실패 $e');
      if (mounted && _recog?.uri == p.uri) setState(() => _recog = (uri: p.uri, state: 'failed', result: null));
    }
  }

  Future<void> _fromPhoto(String from) async {
    // 간직할 부분 자르기·돌리기는 사진 고르기 단계의 자르기 화면에서
    final r = await pickPhoto(from, crop: true);
    if (!mounted) return;
    switch (r) {
      case PhotoFail(:final reason, :final message):
        if (reason == 'denied') setState(() => _msg = deniedMessage(from));
        if (reason == 'error') setState(() => _msg = '사진을 가져오지 못했어요. ${message ?? ''}');
      case PhotoOk(:final uri, :final width, :final height):
        final p = (uri: uri, ratio: width != null && height != null && height > 0 ? width / height : null);
        setState(() {
          _photo = p;
          _msg = null;
          _recog = null;
        });
        if (!_photoOnly) _runOcr(p);
    }
  }

  void _choosePhotoOnly(bool on) {
    setState(() => _photoOnly = on);
    // 글자로 저장으로 돌아오면 아직 읽지 않은 사진을 읽는다(같은 사진은 한 번만)
    final p = _photo;
    if (!on && p != null && _recog?.uri != p.uri) _runOcr(p);
  }

  void _changeLineMode(LineMode m) {
    setState(() => _lineMode = m);
    final r = _recog;
    if (r?.state == 'done' && !_edited) _setText(ocrText(r!.result!, m));
  }

  Future<void> _save() async {
    final bookId = _bookId;
    if (!_canSave || bookId == null) return;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      final n = num.tryParse(_page.trim());
      final p = _photo;
      final photoUri = p != null && (_asPhoto || _keepPhoto) ? await keepImage(p.uri, 'page') : null;
      final s = widget.session;
      final session = s != null && _model.lib.sessions[s]?.myBookId == bookId ? s : null;
      final id = await _model.addBookmark(
        myBookId: bookId,
        text: _text.trim(),
        page: n != null && n > 0 ? n.round() : null,
        memo: _memo.trim().isEmpty ? null : _memo.trim(),
        photoUri: photoUri,
        photoRatio: photoUri != null ? p?.ratio : null,
        sessionId: session,
        // 갈피 보드의 '+ 갈피'에서 왔으면 그때 보던 곳의 빈 자리에 붙인다. 그 밖에는 자리를 비워 두면 보드가 자동으로 놓는다
        boardX: widget.boardX,
        boardY: widget.boardY,
      );
      if (!mounted) return;
      _released = true;
      Navigator.of(context).pushReplacement(MaterialPageRoute<void>(settings: const RouteSettings(name: '/bookmark'), builder: (_) => BookmarkDetailScreen(id: id)));
    } catch (e) {
      // 적은 글·사진은 이 화면에 그대로 있다
      if (mounted) {
        setState(() {
          _saveError = '저장하지 못했어요. 적은 내용과 사진은 그대로 있어요. 다시 시도해 주세요. ($e)';
          _saving = false;
        });
      }
    }
  }

  bool _released = false;

  Future<void> _askLeave() => appAlert(context, '쓰던 내용을 버릴까요?', '지금 나가면 저장되지 않아요.', [
        const AlertButton('계속 쓰기', style: AlertStyle.cancel),
        AlertButton('버리기', style: AlertStyle.destructive, onPress: () {
          _released = true;
          Navigator.of(context).maybePop();
        }),
      ]);

  @override
  Widget build(BuildContext context) {
    final lib = _model.lib;
    final b = _bookId == null ? null : lib.books[_bookId];
    final e = b == null ? null : lib.editions[b.editionId];
    final width = MediaQuery.sizeOf(context).width;
    final photo = _photo;
    final recog = _recog;
    final recognizing = recog?.state == 'running';
    final empty = recog?.state == 'done' && ocrText(recog!.result!, LineMode.keep).isEmpty;
    final unsure = recog?.state == 'done' ? lowConfidenceLines(recog!.result!) : 0;
    return PopScope(
      canPop: _released || !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _askLeave();
      },
      child: Screen(
        title: '갈피 남기기',
        footer: Btn(label: '갈피 저장', onPress: _save, busy: _saving, disabled: !_canSave),
        children: [
          const SizedBox(height: Space.m),
          SelectField(
            label: '책',
            value: e?.title,
            sub: e != null && e.authors.isNotEmpty ? e.authors.join(', ') : null,
            placeholder: '책을 골라 주세요',
            onPress: () async {
              final r = await pickBook(context, lib, addNew: true);
              if (r.picked && r.id != null && mounted) setState(() => _bookId = r.id);
            },
          ),
          if (photo == null)
            Padding(
              padding: const EdgeInsets.only(bottom: Space.l),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(padding: const EdgeInsets.only(bottom: Space.s), child: Text('사진을 찍으면 글자를 바로 읽어 아래에 채워요', style: AppType.sub)),
                Row(children: [
                  Expanded(child: Btn(label: '페이지 찍기', kind: 'secondary', size: 's', onPress: () => _fromPhoto('camera'))),
                  const SizedBox(width: 8),
                  Expanded(child: Btn(label: '사진 고르기', kind: 'secondary', size: 's', onPress: () => _fromPhoto('library'))),
                ]),
                if (_msg != null) Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(_msg!, style: AppType.sub)),
              ]),
            )
          else
            Padding(
              padding: const EdgeInsets.only(bottom: Space.l),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                // 자른 사진(눌러서 크게 보기). 사진만 저장이면 이 모양 그대로 저장된다
                Center(child: PhotoPlate(uri: photo.uri, ratio: photo.ratio, width: math.min(_photoOnly ? 300 : 220, width - Space.page * 2), seed: 'new')),
                Padding(
                  padding: const EdgeInsets.only(top: Space.s),
                  child: Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: [
                    AppChip(label: '다시 찍기', onPress: () => _fromPhoto('camera')),
                    AppChip(label: '다른 사진', onPress: () => _fromPhoto('library')),
                    AppChip(label: '사진 빼기', onPress: () => setState(() {
                          _photo = null;
                          _recog = null;
                        })),
                  ]),
                ),
                ListItem(label: '사진만 저장', sub: '글자 없이 사진 그대로 남겨요', right: Toggle(label: '사진만 저장', value: _photoOnly, onChange: _choosePhotoOnly)),
                if (!_photoOnly) ...[
                  if (!textRecognitionAvailable) const _Notice(textRecognitionReason),
                  if (recognizing) const Loading(label: '사진 속 글자를 읽는 중이에요'),
                  if (recog?.state == 'failed' || empty)
                    Padding(
                      padding: const EdgeInsets.only(top: Space.s),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        _Notice(
                          recog?.state == 'failed'
                              ? '글자를 읽지 못했어요. 다시 읽거나, 직접 적거나, 사진만 저장할 수 있어요.'
                              : '사진에서 글자를 찾지 못했어요. 글자가 크고 반듯하게 보이도록 다시 찍거나, 직접 적거나, 사진만 저장할 수 있어요.',
                          error: true,
                        ),
                        const SizedBox(height: Space.s),
                        Btn(label: '다시 읽기', kind: 'secondary', size: 's', onPress: () => _runOcr(photo)),
                      ]),
                    ),
                  if (recog?.state == 'done' && !empty)
                    Padding(
                      padding: const EdgeInsets.only(top: Space.s),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('읽은 글자를 사진과 비교해 고쳐 주세요.${unsure > 0 ? ' 흐릿하게 읽힌 줄이 $unsure개 있어요.' : ''}', style: AppType.sub),
                        Padding(
                          padding: const EdgeInsets.only(top: Space.s),
                          child: Wrap(spacing: 8, runSpacing: 8, children: [
                            AppChip(label: '줄 끝 이어 쓰기', on: _lineMode == LineMode.join, onPress: () => _changeLineMode(LineMode.join)),
                            AppChip(label: '줄바꿈 그대로(시)', on: _lineMode == LineMode.keep, onPress: () => _changeLineMode(LineMode.keep)),
                          ]),
                        ),
                      ]),
                    ),
                ],
              ]),
            ),
          if (!_asPhoto)
            Field(
              key: ValueKey(('text', _textVersion)),
              label: '문장',
              value: _text,
              onChange: (t) {
                _text = t;
                _edited = true;
                setState(() {});
              },
              placeholder: '마음에 남은 문장을 옮겨 적어 주세요',
              multiline: true,
              minHeight: 160,
            ),
          if (photo != null && !_photoOnly) ListItem(label: '원본 사진도 보관', right: Toggle(label: '원본 사진도 보관', value: _keepPhoto, onChange: (v) => setState(() => _keepPhoto = v))),
          Field(label: '쪽수 (선택)', unit: '쪽', value: _page, onChange: (t) => setState(() => _page = t), number: true),
          Field(label: '한 줄 메모 (선택)', value: _memo, onChange: (t) => setState(() => _memo = t), placeholder: '나만 보는 메모예요. 공유 이미지에는 넣지 않아요', multiline: true, minHeight: 80),
          if (_saveError != null) _Notice(_saveError!, error: true),
        ],
      ),
    );
  }
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
          margin: const EdgeInsets.only(top: Space.s),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(Shape.input)),
          child: Text(text, style: AppType.sub.copyWith(color: error ? AppColors.danger : AppColors.ink)),
        ),
      );
}
