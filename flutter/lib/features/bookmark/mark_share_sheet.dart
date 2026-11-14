// 갈피 공유 시트(지금 앱 features/bookmark/MarkShare.tsx, 2026-11-10 사용자 시안): 위에서 '책 페이지'·'종이 메모' 모양을 고르면 가운데 큰 미리보기가 바뀌고,
// 아래 '저장'(사진첩)·'공유'(공유창)를 누르면 그 모양을 폭 1080px로 그려 보낸다(11-10 댓글 '가운데 박스, 밑쪽에 다운로드 공유')
library;

import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../services/share_image.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../share/mark_scene.dart';

const _exportW = 1080;

Future<void> showMarkShareSheet(BuildContext context, MarkInput input) => showSheet<void>(context, title: '갈피 공유', builder: (_) => _MarkShare(input: input));

class _MarkShare extends StatefulWidget {
  const _MarkShare({required this.input});
  final MarkInput input;

  @override
  State<_MarkShare> createState() => _MarkShareState();
}

class _MarkShareState extends State<_MarkShare> {
  MarkStyle _style = MarkStyle.page;
  final _plates = <MarkStyle, ui.Image>{};
  ui.Image? _preview;
  Object? _previewKey;
  String? _busy;
  bool _saved = false, _canSave = false;
  Timer? _savedTimer;

  @override
  void initState() {
    super.initState();
    gallerySaveAvailable().then((v) {
      if (mounted) setState(() => _canSave = v);
    });
    for (final s in MarkStyle.values) {
      markPlate(s).then((img) {
        if (mounted) setState(() => _plates[s] = img);
      });
    }
  }

  @override
  void dispose() {
    _savedTimer?.cancel();
    _preview?.dispose();
    super.dispose();
  }

  Future<void> _act(String kind) async {
    final plate = _plates[_style];
    if (_busy != null || plate == null) return;
    setState(() => _busy = kind);
    final nav = Navigator.of(context);
    try {
      await Future<void>.delayed(const Duration(milliseconds: 30));
      final img = renderMark(plate, _style, widget.input, _exportW);
      final png = await pngOf(img);
      img.dispose();
      if (kind == 'save') {
        await savePng(png, name: 'gallpi');
        if (!mounted) return;
        setState(() => _saved = true);
        _savedTimer?.cancel();
        _savedTimer = Timer(const Duration(milliseconds: 2400), () {
          if (mounted) setState(() => _saved = false);
        });
      } else {
        await sharePng(png, name: 'gallpi', title: '갈피 공유');
        if (mounted) nav.pop();
      }
    } catch (e) {
      if (mounted) appAlert(context, shareErrorTitle(e), '$e');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    // 가운데 미리보기: 시트 안 폭과, 화면 높이에서 머리·고르기·버튼 자리를 뺀 높이 중 작은 쪽
    final pw = math.max(160.0, [size.width - Space.page * 2, (size.height * 0.9 - 250) * markW / markH, 320.0].reduce(math.min));
    final ph = pw * markH / markW;
    final plate = _plates[_style];
    if (plate != null) {
      final px = (pw * MediaQuery.devicePixelRatioOf(context)).round();
      final key = (_style, px, plate);
      if (key != _previewKey) {
        _preview?.dispose();
        _preview = renderMark(plate, _style, widget.input, px);
        _previewKey = key;
      }
    }
    final hair = 1 / MediaQuery.devicePixelRatioOf(context);
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Segmented<MarkStyle>(items: const [(MarkStyle.page, '책 페이지'), (MarkStyle.note, '종이 메모')], value: _style, onChange: (s) => setState(() => _style = s)),
      Padding(
        padding: const EdgeInsets.symmetric(vertical: Space.l),
        child: Center(
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.line, width: hair),
              boxShadow: const [BoxShadow(color: Color(0x14191F28), offset: Offset(0, 6), blurRadius: 20)],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: pw,
                height: ph,
                color: const Color(0xFFEEECE9),
                child: plate == null || _preview == null ? null : RawImage(image: _preview, width: pw, height: ph, fit: BoxFit.fill),
              ),
            ),
          ),
        ),
      ),
      Row(children: [
        if (_canSave) ...[
          Expanded(child: Btn(label: _saved ? '저장했어요' : '저장', kind: 'secondary', busy: _busy == 'save', disabled: _busy != null && _busy != 'save', onPress: () => _act('save'))),
          const SizedBox(width: Space.s),
        ],
        Expanded(child: Btn(label: '공유', busy: _busy == 'share', disabled: _busy != null && _busy != 'share', onPress: () => _act('share'))),
      ]),
    ]);
  }
}
