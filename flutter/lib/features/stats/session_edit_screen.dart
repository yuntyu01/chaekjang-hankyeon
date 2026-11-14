// 독서 기록 수정(지금 앱 app/session/[id].tsx): 잘못 저장한 시간·날짜·책 연결을 고치거나 삭제한다.
// 고친 칸만 저장한다(domain/session_edit): 메모만 고치면 시작·끝 시각과 초 단위 독서 시간이 그대로 남는다. 고친 칸이 있으면 나가기 전에 묻는다.
// (커뮤니티에 공유하기는 커뮤니티를 옮길 때 넣는다)
library;

import 'package:flutter/material.dart';

import '../../domain/library.dart' show formatDurationPrecise;
import '../../domain/session_edit.dart';
import '../../store/library_model.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../bookmark/book_picker.dart' show pickBook;

Future<void> openSessionEdit(BuildContext context, String id) =>
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(settings: const RouteSettings(name: '/session'), builder: (_) => SessionEditScreen(id: id)));

class SessionEditScreen extends StatefulWidget {
  const SessionEditScreen({super.key, required this.id});
  final String id;

  @override
  State<SessionEditScreen> createState() => _SessionEditScreenState();
}

class _SessionEditScreenState extends State<SessionEditScreen> {
  final _model = LibraryModel.instance;
  late final _s = _model.lib.sessions[widget.id];
  late final SessionForm? _initial = _s == null ? null : sessionFormOf(_s);
  late SessionForm _f = _initial ?? (bookId: null, day: '', time: '', minutes: '', startPage: '', pages: '', memo: '');
  bool _released = false;

  bool get _dirty => _initial != null && _f != _initial;

  void _set({Object? bookId = _keep, String? day, String? time, String? minutes, String? startPage, String? pages, String? memo}) => setState(() => _f = (
        bookId: identical(bookId, _keep) ? _f.bookId : bookId as String?,
        day: day ?? _f.day,
        time: time ?? _f.time,
        minutes: minutes ?? _f.minutes,
        startPage: startPage ?? _f.startPage,
        pages: pages ?? _f.pages,
        memo: memo ?? _f.memo,
      ));

  void _leave() {
    _released = true;
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final s = _s, initial = _initial;
    if (s == null || initial == null) return const Screen(title: '독서 기록', children: [Empty(title: '기록을 찾을 수 없어요')]);
    final lib = _model.lib;
    final b = _f.bookId == null ? null : lib.books[_f.bookId];
    final e = b == null ? null : lib.editions[b.editionId];
    final patch = sessionEditPatch(s, initial, _f);
    final minutesBad = _f.minutes != initial.minutes && !((num.tryParse(_f.minutes) ?? 0) > 0);
    return PopScope(
      canPop: _released || !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        appAlert(context, '고친 내용을 버릴까요?', '지금 나가면 저장되지 않아요.', [
          const AlertButton('계속 쓰기', style: AlertStyle.cancel),
          AlertButton('버리기', style: AlertStyle.destructive, onPress: _leave),
        ]);
      },
      child: Screen(
        title: '독서 기록 수정',
        footer: Btn(
          label: '저장',
          disabled: patch == null,
          onPress: () {
            if (patch == null) return;
            if (patch.isNotEmpty) _model.updateSession(widget.id, patch);
            _leave();
          },
        ),
        children: [
          Padding(
            padding: const EdgeInsets.only(top: Space.item, bottom: Space.group),
            child: Text('지금 저장된 독서 시간: ${formatDurationPrecise(s.durationMs)} (일시정지 제외)', style: AppType.sub),
          ),
          SelectField(
            label: '연결된 책',
            value: e?.title,
            placeholder: '책 없음 (눌러서 연결)',
            onPress: () async {
              final r = await pickBook(context, lib, allowNone: true);
              if (r.picked) _set(bookId: r.id);
            },
          ),
          // 날짜·시각은 눌러서 고른다
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 13, child: DateField(label: '날짜', value: validDay(_f.day) ? _f.day : '', onChange: (v) => _set(day: v))),
            const SizedBox(width: 10),
            Expanded(flex: 10, child: TimeField(label: '시작 시각', value: validTime(_f.time) ? _f.time : '', onChange: (v) => _set(time: v))),
          ]),
          Field(
            label: '독서 시간(분)',
            value: _f.minutes,
            number: true,
            onChange: (v) => _set(minutes: v),
            hint: _f.minutes == initial.minutes ? '고치지 않으면 저장된 시간(초 단위)이 그대로 남아요.' : null,
            error: minutesBad ? '1분 이상으로 적어 주세요' : null,
          ),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Field(label: '시작 쪽 (선택)', value: _f.startPage, number: true, onChange: (v) => _set(startPage: v))),
            const SizedBox(width: 10),
            Expanded(child: Field(label: '도달한 쪽 (선택)', value: _f.pages, number: true, onChange: (v) => _set(pages: v))),
          ]),
          Field(label: '메모 (선택)', value: _f.memo, onChange: (v) => _set(memo: v)),
          // 기록으로 할 일은 줄 목록으로(버튼을 쌓지 않는다). 저장은 아래 고정 버튼 하나
          Padding(
            padding: const EdgeInsets.only(top: Space.tight),
            child: ListGroup(children: [
              ListItem(
                label: '이 기록 삭제',
                danger: true,
                onPress: () => appAlert(context, '이 독서 기록을 삭제할까요?', '통계에서도 빠져요. 되돌릴 수 없어요.', [
                  const AlertButton('취소', style: AlertStyle.cancel),
                  AlertButton('삭제', style: AlertStyle.destructive, onPress: () {
                    _model.deleteSession(widget.id);
                    _leave();
                  }),
                ]),
              ),
            ]),
          ),
        ],
      ),
    );
  }
}

const _keep = Object();
