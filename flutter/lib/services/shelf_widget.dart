// 홈 화면 위젯(Android, 지금 앱 ui/home-snapshot captureWidget·ui/shelf-widget-shapes를 옮긴 것): 책장 첫 네 칸을 위젯에 넘긴다.
// 지금 앱은 화면을 찍어 다 보이는 칸만 떴지만(하단바에 가린 4단째는 스크롤해야), Flutter는 책장 전체를 한 장으로 굳힌 그림이 있어
// 거기서 바로 잘라 네 칸을 한 번에 넘긴다. 네이티브(ShelfWidgetChannel)가 칸마다 잘라 두고, 투명 위젯용으로 책·판·갈피만 오려 낸다.
// 칸 열쇠: 그림이 같은지 가린다(같으면 다시 넘기지 않는다). 칸 수가 줄면 네이티브가 그 아래 칸을 버린다
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

/// 위젯에 넘길 칸(콘텐츠 dp 좌표, 머리글 포함). top·bottom: 이 칸을 자를 범위, rel: 책장 내용(머리글 아래) 기준 칸 위 끝(이어 붙일 자리).
/// books·boards: 책·선반 판 외곽 [x0,y0,x1,y1,…], ribbons: 갈피 띠 [x,y,w,h](모두 콘텐츠 dp)
class WidgetRow {
  const WidgetRow({required this.key, required this.top, required this.bottom, required this.rel, this.books = const [], this.ribbons = const [], this.boards = const []});
  final String key;
  final double top, bottom, rel;
  final List<List<double>> books, ribbons, boards;
}

/// 위젯 칸 수 상한(4단)
const widgetRowsMax = 4;

/// 선반 판 밑 그늘까지 담는 여유(dp). 더 내리면 다음 칸 벽이 띠처럼 비친다(지금 앱 WIDGET_SHADOW)
const widgetShadow = 1.5;

const _channel = MethodChannel('app.covebook/shelf_widget');

/// 짧은 해시(지금 앱 hash: djb2를 36진수로)
String widgetHash(String s) {
  var h = 5381;
  for (final c in s.codeUnits) {
    h = ((h << 5) + h + c) & 0xFFFFFFFF;
  }
  return h.toRadixString(36);
}

String _sent = '';
bool _busy = false;

/// 굳힌 책장 그림(shelf: 콘텐츠 전체, 화면 밀도 dpr 배)에서 칸들을 잘라 위젯에 넘긴다. 같은 칸들을 이미 넘겼으면 하지 않는다.
/// bg: 화면 바탕색(책장 그림 밖, 구멍 위 벽 위쪽). 놓인 위젯 수(못 했으면 null)
Future<int?> sendShelfWidget(ui.Image shelf, double dpr, List<WidgetRow> rows, ui.Color bg) async {
  if (!Platform.isAndroid || rows.isEmpty || _busy) return null;
  final keys = [for (final r in rows) r.key];
  if (keys.join(',') == _sent) return null;
  _busy = true;
  try {
    final first = rows.first.top, last = rows.last.bottom + widgetShadow;
    final y0 = (first * dpr).round().clamp(0, shelf.height - 1);
    final y1 = (last * dpr).round().clamp(y0 + 1, shelf.height);
    final w = shelf.width, h = y1 - y0;
    final rec = ui.PictureRecorder();
    final c = ui.Canvas(rec);
    c.drawRect(ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), ui.Paint()..color = bg);
    c.drawImageRect(shelf, ui.Rect.fromLTWH(0, y0.toDouble(), w.toDouble(), h.toDouble()), ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), ui.Paint());
    final pic = rec.endRecording();
    final img = await pic.toImage(w, h);
    pic.dispose();
    final png = await img.toByteData(format: ui.ImageByteFormat.png);
    img.dispose();
    if (png == null) return null;
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/shelf-widget');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    final file = File('${dir.path}/band-${DateTime.now().millisecondsSinceEpoch}.png');
    await file.writeAsBytes(png.buffer.asUint8List(), flush: true);
    // 모양은 그림 기준 px로(그림 위 끝 = 첫 칸 위 끝)
    double x(double v) => v * dpr;
    double y(double v) => v * dpr - y0;
    List<double> poly(List<double> f) => [for (var i = 0; i < f.length; i++) i.isOdd ? y(f[i]) : x(f[i])];
    final n = await _channel.invokeMethod<int>('updateRows', {
      'path': file.path,
      'band': [for (final (i, r) in rows.indexed) [i, y(r.top).round(), y(r.bottom + widgetShadow).round().clamp(0, h), (r.rel * dpr).round()]],
      'bandKeys': keys,
      'keys': keys,
      'books': [for (final r in rows) for (final f in r.books) poly(f)],
      'ribbons': [for (final r in rows) for (final b in r.ribbons) [x(b[0]), y(b[1]), x(b[2]), b[3] * dpr]],
      'boards': [for (final r in rows) for (final f in r.boards) poly(f)],
    });
    _sent = keys.join(',');
    debugPrint('[widget] rows ${rows.length} ${w}x$h placed ${n ?? 0}');
    return n;
  } catch (e) {
    debugPrint('[widget] failed $e');
    return null;
  } finally {
    _busy = false;
  }
}
