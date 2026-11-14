// 책 정보 수정(지금 앱 app/book/[id]/edit.tsx, 판본 정보): 잘못 인식·입력한 값을 고친다. 비운 값은 '확인 전'이 된다.
// 크기를 바꾸면 책장에서 책 크기도 바뀐다(자리가 모자라면 그 선반 끝 책이 책장에서 빠진다). 고친 칸이 있으면 나가기 전에 묻는다
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../services/photos.dart';
import '../../store/files.dart' show keepImage;
import '../../store/library_model.dart';
import '../../store/placement_store.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';

Future<void> openEditBook(BuildContext context, String id) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/book/edit'), builder: (_) => EditBookScreen(id: id)));

int? _num(String v) {
  final n = double.tryParse(v.replaceAll(RegExp(r'[^\d.]'), ''));
  return n != null && n.isFinite && n > 0 ? n.round() : null;
}

class EditBookScreen extends StatefulWidget {
  const EditBookScreen({super.key, required this.id});
  final String id;

  @override
  State<EditBookScreen> createState() => _EditBookScreenState();
}

class _EditBookScreenState extends State<EditBookScreen> {
  final _model = LibraryModel.instance;
  late final Map<String, String?> _f0 = () {
    final b = _model.lib.books[widget.id];
    final e = b == null ? null : _model.lib.editions[b.editionId];
    return <String, String?>{
      'title': e?.title ?? '',
      'authors': e?.authors.join(', ') ?? '',
      'publisher': e?.publisher ?? '',
      'publishedAt': e?.publishedAt ?? '',
      'isbn': e?.isbn13 ?? '',
      'pages': e?.pageCount != null ? '${e!.pageCount}' : '',
      'width': e?.widthMm != null && e?.heightMm != null ? '${e!.widthMm}' : '',
      'height': e?.widthMm != null && e?.heightMm != null ? '${e!.heightMm}' : '',
      'coverUri': e?.coverUri,
      'coverSource': e?.coverSource,
    };
  }();
  late final Map<String, String?> _f = {..._f0};
  String? _msg;
  bool _saving = false, _released = false;

  bool get _dirty => _f.entries.any((e) => _f0[e.key] != e.value);

  void _set(String k, String? v) => setState(() => _f[k] = v);

  Future<void> _save() async {
    final b = _model.lib.books[widget.id];
    final e = b == null ? null : _model.lib.editions[b.editionId];
    if (_saving || e == null) return;
    var coverUri = _f['coverUri'];
    setState(() => _saving = true);
    if (coverUri != e.coverUri && _f['coverSource'] == 'photo' && coverUri != null) {
      // 사진을 앱 안으로 옮기는 동안 두 번 눌리지 않게, 실패하면 알린다
      try {
        coverUri = await keepImage(coverUri, 'cover');
      } catch (_) {
        if (mounted) {
          setState(() {
            _saving = false;
            _msg = '표지 사진을 저장하지 못했어요. 다시 골라 주세요.';
          });
        }
        return;
      }
    }
    final w = _num(_f['width']!), h = _num(_f['height']!);
    final isbn = _f['isbn']!.replaceAll(RegExp(r'[^\dXx]'), '');
    String? opt(String k) => _f[k]!.trim().isEmpty ? null : _f[k]!.trim();
    await _model.updateEdition(
      e.id,
      title: _f['title']!.trim().isEmpty ? e.title : _f['title']!.trim(),
      authors: [for (final a in _f['authors']!.split(',')) if (a.trim().isNotEmpty) a.trim()],
      publisher: opt('publisher'),
      publishedAt: opt('publishedAt'),
      isbn13: isbn.isEmpty ? null : isbn,
      pageCount: _num(_f['pages']!),
      widthMm: w != null && h != null ? math.min(w, h) : null,
      heightMm: w != null && h != null ? math.max(w, h) : null,
      coverUri: coverUri,
      coverSource: coverUri != null ? _f['coverSource'] : null,
    );
    // 크기가 바뀌었으면 책장에서도 맞춘다(안 들어가면 끝 책이 빠진다)
    final moved = await PlacementStore.instance.reload();
    if (!mounted) return;
    _released = true;
    final nav = Navigator.of(context);
    if (moved > 0) await appAlert(context, '선반 크기가 바뀌어 들어가지 않는 책 $moved권을 책장에서 뺐어요. 전체 책에서 다시 진열할 수 있어요.');
    // 저장했으니 PopScope(고친 내용 버릴까요)를 거치지 않고 닫는다
    nav.pop();
  }

  @override
  Widget build(BuildContext context) {
    final b = _model.lib.books[widget.id];
    if (b == null || _model.lib.editions[b.editionId] == null) {
      return Screen(title: '책 정보 수정', children: [
        Empty(title: '책을 찾을 수 없어요', body: '삭제되었거나 예시 책장 책이에요.', action: '책장으로', onAction: () => Navigator.of(context).popUntil((r) => r.isFirst)),
      ]);
    }
    return PopScope(
      canPop: _released || !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        appAlert(context, '고친 내용을 버릴까요?', '지금 나가면 저장되지 않아요.', [
          const AlertButton('계속 쓰기', style: AlertStyle.cancel),
          AlertButton('버리기', style: AlertStyle.destructive, onPress: () {
            _released = true;
            Navigator.of(context).pop();
          }),
        ]);
      },
      child: Screen(
        title: '책 정보 수정',
        footer: Btn(label: '저장', onPress: _save, busy: _saving, disabled: _f['title']!.trim().isEmpty),
        children: [
          // 책 추가 '책 확인'과 같은 짜임: 표지 96 · 사이 16 · 작은 보조 버튼
          Padding(
            padding: const EdgeInsets.only(top: Space.m),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              RealCover(uri: _f['coverUri'], title: _f['title']!, color: '#F2F4F6', width: 96),
              const SizedBox(width: Space.l),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Btn(
                    label: '표지 사진 바꾸기',
                    kind: 'secondary',
                    size: 's',
                    onPress: () async {
                      final r = await pickPhoto('library');
                      if (!mounted) return;
                      if (r case PhotoOk(:final uri)) {
                        setState(() {
                          _f['coverUri'] = uri;
                          _f['coverSource'] = 'photo';
                        });
                      } else if (r case PhotoFail(reason: 'denied')) {
                        setState(() => _msg = deniedMessage('library'));
                      }
                    },
                  ),
                  if (_f['coverUri'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: Space.s),
                      // 지금 앱: 글자만 있는 작은 단추(좌우 여백 0)
                      child: Transform.translate(
                        offset: const Offset(-16, 0),
                        child: Btn(label: '표지 지우기', kind: 'ghost', size: 's', onPress: () => setState(() {
                              _f['coverUri'] = null;
                              _f['coverSource'] = null;
                            })),
                      ),
                    ),
                  if (_msg != null) Padding(padding: const EdgeInsets.only(top: Space.s), child: Text(_msg!, style: AppType.sub)),
                ]),
              ),
            ]),
          ),
          // 기본 정보(제목 필수) / 추가 서지정보(모두 선택)를 구역 이름과 간격으로 나눈다
          const H2('기본 정보'),
          Field(label: '제목 (필수)', value: _f['title']!, onChange: (t) => _set('title', t)),
          Field(label: '저자 (선택)', value: _f['authors']!, onChange: (t) => _set('authors', t)),
          const H2('추가 서지정보 (선택)'),
          Field(label: '출판사', value: _f['publisher']!, onChange: (t) => _set('publisher', t)),
          Field(label: '출간', value: _f['publishedAt']!, onChange: (t) => _set('publishedAt', t), placeholder: 'YYYY 또는 YYYY-MM'),
          Field(label: 'ISBN', value: _f['isbn']!, onChange: (t) => _set('isbn', t), number: true),
          Field(label: '쪽수', value: _f['pages']!, onChange: (t) => _set('pages', t), number: true, hint: '비우면 ‘확인 전’으로 표시돼요.'),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Field(label: '판형 가로(mm)', value: _f['width']!, onChange: (t) => _set('width', t), number: true)),
            const SizedBox(width: Space.m),
            Expanded(child: Field(label: '판형 세로(mm)', value: _f['height']!, onChange: (t) => _set('height', t), number: true)),
          ]),
          Text('크기를 바꾸면 책장에서 책 크기도 바뀌어요. 자리가 모자라면 그 선반 끝 책이 책장에서 빠질 수 있어요(전체 책에는 그대로 있어요).', style: AppType.sub),
        ],
      ),
    );
  }
}
