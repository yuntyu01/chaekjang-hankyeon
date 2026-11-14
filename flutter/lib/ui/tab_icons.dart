// 하단 탭 아이콘(지금 앱 ui/TabIcons.tsx와 같은 모양·크기를 SVG 그대로): 고르지 않은 탭은 속이 빈 회색 윤곽선, 고른 탭은 진한 색으로 속이 찬 모양.
// 선 굵기 2.4, 끝·꺾임은 둥글게. 아이콘마다 키가 달라도 세로 가운데가 맞게 viewBox를 모양 가운데에 잡는다
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

const _w = 2.4;
const _box = 28.0;
const _round = 'stroke-linecap="round" stroke-linejoin="round"';

String _hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

/// 가로 폭 w칸 아이콘의 크기·viewBox(세로 칸 28/k, 모양 가운데 cy)
({double width, double height, String viewBox}) _boxOf(double size, double w, double cy, [double k = 1]) =>
    (width: size * w * k / _box, height: size, viewBox: '0 ${cy - _box / k / 2} $w ${_box / k}');

Widget _svg(String body, ({double width, double height, String viewBox}) b) => SvgPicture.string(
      '<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.viewBox}">$body</svg>',
      width: b.width,
      height: b.height,
    );

/// 책장: 같은 크기의 책 세 권, 세 번째는 앞 책에 기대 있다(−18°)
Widget shelfIcon(Color color, {double size = 26, bool filled = false}) {
  const bookW = 7.6;
  final inset = filled ? 0.0 : _w / 2;
  final c = _hex(color);
  final line = filled ? '' : 'stroke="$c" stroke-width="$_w" $_round';
  final fill = filled ? c : 'none';
  String bar(double x, [String t = '']) {
    final rx = (2 - inset * 0.6) < 0.6 ? 0.6 : 2 - inset * 0.6;
    return '<rect x="${x + inset}" y="${1.1 + inset}" width="${bookW - 2 * inset}" height="${24.9 - 2 * inset}" rx="$rx" fill="$fill" $line $t/>';
  }

  return _svg('${bar(0.6)}${bar(9.8)}${bar(24.46 - bookW / 2, 'transform="rotate(-18 24.46 13.5)"')}', _boxOf(size, 33, 13.5));
}

/// 갈피: 위가 둥글고 아래가 V로 파인 가름끈 종이
Widget bookmarkTabIcon(Color color, {double size = 26, bool filled = false}) {
  final c = _hex(color);
  return _svg(
    '<path d="M5.1 1.2 H14.9 A3.9 3.9 0 0 1 18.8 5.1 V21.3 A0.95 0.95 0 0 1 17.25 22.05 L11.05 17 Q10 16.15 8.95 17 L2.75 22.05 A0.95 0.95 0 0 1 1.2 21.3 V5.1 A3.9 3.9 0 0 1 5.1 1.2 Z" fill="${filled ? c : 'none'}" stroke="$c" stroke-width="$_w" $_round/>',
    _boxOf(size, 20, 11.7, 1.03),
  );
}

/// 읽기: 펼친 책(찬 모양은 가운데를 바탕색 선으로 나눈다)
Widget readTabIcon(Color color, Color bg, {double size = 26, bool filled = false}) {
  final c = _hex(color);
  return _svg(
    '<path d="M14.5 4.2 C12.7 2.2 10.3 1.2 7.3 1.2 H5.5 A4.3 4.3 0 0 0 1.2 5.5 V16 A4.3 4.3 0 0 0 5.5 20.3 H7.7 C10.3 20.3 12.5 21.1 14.5 22.8 C16.5 21.1 18.7 20.3 21.3 20.3 H23.5 A4.3 4.3 0 0 0 27.8 16 V5.5 A4.3 4.3 0 0 0 23.5 1.2 H21.7 C18.7 1.2 16.3 2.2 14.5 4.2 Z" fill="${filled ? c : 'none'}" stroke="$c" stroke-width="$_w" $_round/>'
    '<path d="M14.5 4.6 V22" fill="none" stroke="${filled ? _hex(bg) : c}" stroke-width="${filled ? 1.6 : _w}" $_round/>',
    _boxOf(size, 29, 11.95, 1.05),
  );
}

/// 기록: 달력(찬 모양은 머리줄을 바탕색 선으로 나눈다)
Widget recordTabIcon(Color color, Color bg, {double size = 26, bool filled = false}) {
  final c = _hex(color);
  return _svg(
    '<rect x="1.2" y="3.6" width="22.6" height="19.2" rx="4.2" fill="${filled ? c : 'none'}" stroke="$c" stroke-width="$_w" $_round/>'
    '<path d="M1.8 10.2 H23.2" fill="none" stroke="${filled ? _hex(bg) : c}" stroke-width="${filled ? 1.6 : _w}" $_round/>'
    '<path d="M7.6 1.2 V5.6 M17.4 1.2 V5.6" fill="none" stroke="$c" stroke-width="$_w" $_round/>',
    _boxOf(size, 25, 12, 1.08),
  );
}

/// 내 정보: 머리와 어깨(윤곽선은 면 안쪽으로)
Widget profileTabIcon(Color color, {double size = 26, bool filled = false}) {
  final c = _hex(color);
  final line = filled ? '' : 'stroke="$c" stroke-width="$_w" $_round';
  final d = filled
      ? 'M1 23.2 V21.8 A7.4 7.4 0 0 1 8.4 14.4 H15.6 A7.4 7.4 0 0 1 23 21.8 V23.2 A2.8 2.8 0 0 1 20.2 26 H3.8 A2.8 2.8 0 0 1 1 23.2 Z'
      : 'M2.2 23.2 V21.8 A6.2 6.2 0 0 1 8.4 15.6 H15.6 A6.2 6.2 0 0 1 21.8 21.8 V23.2 A1.6 1.6 0 0 1 20.2 24.8 H3.8 A1.6 1.6 0 0 1 2.2 23.2 Z';
  return _svg(
    '<circle cx="12" cy="6.8" r="${filled ? 6.6 : 6.6 - _w / 2}" fill="${filled ? c : 'none'}" $line/>'
    '<path d="$d" fill="${filled ? c : 'none'}" $line/>',
    _boxOf(size, 24, 13.1, 1.14),
  );
}

