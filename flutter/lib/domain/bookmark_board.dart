// 갈피 보드 배치(순수, 지금 앱 domain/bookmark-board.ts, 2026-11-02 사용자 시안): 책 한 권의 갈피를 화면보다 넓은 보드에 흩어 붙인다. 좌표는 보드 dp, 자리는 카드 중심.
// 새 갈피는 자동으로 놓이고(만든 순서로 두 줄에 번갈아) 손으로 옮긴 갈피만 저장된 자리(boardX·boardY·boardRot)를 쓴다.
// 자동 자리는 앞선 갈피들로만 정해지므로 뒤에 갈피가 늘어도 이미 놓인 갈피는 움직이지 않는다. 손으로 옮긴 갈피의 칸은 비워 둔다(옮겼다고 다른 갈피가 밀려 오지 않게).
library;

import 'dart:math' as math;

import 'library.dart' show Bookmark, Library;

const boardCardW = 216.0;
const _columnGap = 34.0;
const _rowGap = 30.0;
const _jitterX = 14.0;
const _jitterY = 8.0;
const _maxRot = 3.2;
const boardMinScale = 0.3;
const boardMaxScale = 2.6;
// 글자 칸 추정(높이를 재기 전 배치에 쓴다): 명조 18/29, 안쪽 여백 포함
const _lineH = 29.0;
const _charsPerLine = 11.5;
const boardMaxLines = 7;
// 카드 폭(손잡이로 바꾼다). 글은 폭에 맞춰 줄이 바뀌고, 사진은 폭에 맞춰 커진다
const boardMinW = 150.0;
const boardMaxW = 420.0;
const _notePad = 36.0; // 글 카드 좌우 안쪽 여백 합

/// 카드 자리(중심)와 크기
class BoardSpot {
  const BoardSpot(this.id, this.x, this.y, this.w, this.h, this.rot, this.placed);
  final String id;
  final double x, y, w, h, rot;
  final bool placed;

  BoardSpot at(double x, double y) => BoardSpot(id, x, y, w, h, rot, placed);

  @override
  bool operator ==(Object other) => other is BoardSpot && other.id == id && other.x == x && other.y == y && other.w == w && other.h == h && other.rot == rot && other.placed == placed;

  @override
  int get hashCode => Object.hash(id, x, y, w, h, rot, placed);

  @override
  String toString() => 'BoardSpot($id, $x, $y, $w×$h, $rot, $placed)';
}

/// 보기: 화면 = 보드 × s + (x, y)
class BoardView {
  const BoardView(this.x, this.y, this.s);
  final double x, y, s;
}

typedef BoardBounds = ({double x0, double y0, double x1, double y1});

/// 0 ~ 1(지금 앱 hash와 같은 값: FNV-1a 32비트, UTF-16 단위)
double _hash(String id, int salt) {
  var h = (2166136261 ^ salt) & 0xFFFFFFFF;
  for (final c in id.codeUnits) {
    h = ((h ^ c) * 16777619) & 0xFFFFFFFF;
  }
  return (h % 10007) / 10007;
}

/// 갈피마다 정해진 기울기(도): 다시 열어도 같다
double boardRotOf(String id) => (_hash(id, 1) * 2 - 1) * _maxRot;

/// 카드 크기(추정): 사진은 인화지 모양, 글은 줄 수만큼. 실제 높이는 그려 본 뒤 재지만, 자동 자리는 이 값으로 정해 재는 순서에 흔들리지 않게 한다
double boardPhotoRatio(num? ratio) => math.max(0.9, math.min(1.5, ratio != null && ratio > 0 ? ratio.toDouble() : 1.3));
int boardTextChars(String text) => text.replaceAll(RegExp(r'\s+'), ' ').trim().length;

/// 폭에 따른 높이. ratio가 있으면 사진, 없으면 글 chars자
double boardHeightAt(double w, int chars, double ratio) {
  if (ratio != 0) return ((w - 20) / ratio).roundToDouble() + 44;
  final perLine = _charsPerLine * (w - _notePad) / (boardCardW - _notePad);
  final lines = math.max(2, math.min(boardMaxLines, (chars / perLine).ceil()));
  return 68 + lines * _lineH;
}

/// 보드에 필요한 갈피 값(시험에서는 갈피 전체 대신 이것만 만든다)
class BoardMark {
  const BoardMark({required this.id, required this.text, required this.createdAt, this.photoUri, this.photoRatio, this.boardX, this.boardY, this.boardRot, this.boardW});
  factory BoardMark.of(Bookmark m) =>
      BoardMark(id: m.id, text: m.text, createdAt: m.createdAt, photoUri: m.photoUri, photoRatio: m.photoRatio, boardX: m.boardX, boardY: m.boardY, boardRot: m.boardRot, boardW: m.boardW);
  final String id, text, createdAt;
  final String? photoUri;
  final num? photoRatio, boardX, boardY, boardRot, boardW;
  bool get hasSpot => boardX != null && boardY != null;
}

({double w, double h}) boardCardSize({required String text, String? photoUri, num? photoRatio, num? boardW}) {
  final w = math.max(boardMinW, math.min(boardMaxW, (boardW ?? boardCardW).toDouble()));
  return (w: w, h: boardHeightAt(w, boardTextChars(text), photoUri != null ? boardPhotoRatio(photoRatio) : 0));
}

({double w, double h}) _sizeOf(BoardMark m) => boardCardSize(text: m.text, photoUri: m.photoUri, photoRatio: m.photoRatio, boardW: m.boardW);

/// 폭을 바꾼 뒤 저장할 값: 왼쪽 위 모서리는 그대로 둔다(손잡이는 오른쪽 아래)
({double boardW, double boardX, double boardY, double boardRot}) boardResized(BoardMark m, BoardSpot spot, double width) {
  final next = boardCardSize(text: m.text, photoUri: m.photoUri, photoRatio: m.photoRatio, boardW: width);
  return (boardW: next.w, boardX: spot.x + (next.w - spot.w) / 2, boardY: spot.y + (next.h - spot.h) / 2, boardRot: spot.rot);
}

/// 한 점을 그대로 두고 배율만 바꾼 보기(끌다가 화면 끝에 닿으면 보드가 넓어진다)
BoardView boardZoomAt(BoardView v, double k, double px, double py) => BoardView(px - (px - v.x) * k, py - (py - v.y) * k, v.s * k);

bool _overlaps(({double x, double y, double w, double h}) a, ({double x, double y, double w, double h}) b, [double gap = 6]) =>
    (a.x - b.x).abs() < (a.w + b.w) / 2 + gap && (a.y - b.y).abs() < (a.h + b.h) / 2 + gap;

({double x, double y, double w, double h}) _r(BoardSpot s) => (x: s.x, y: s.y, w: s.w, h: s.h);

List<BoardSpot> boardSpots(List<BoardMark> marks) {
  final sorted = [...marks]..sort((a, b) {
      final c = a.createdAt.compareTo(b.createdAt);
      return c != 0 ? c : a.id.compareTo(b.id);
    });
  final placed = [
    for (final m in sorted)
      if (m.hasSpot)
        () {
          final s = _sizeOf(m);
          return BoardSpot(m.id, m.boardX!.toDouble(), m.boardY!.toDouble(), s.w, s.h, (m.boardRot ?? boardRotOf(m.id)).toDouble(), true);
        }(),
  ];
  final out = [...placed];
  const colX = [boardCardW / 2, boardCardW * 1.5 + _columnGap];
  final colY = [0.0, 0.0];
  for (final m in sorted) {
    // 손으로 옮긴 갈피도 제 칸은 차지한다(옮겼다고 다른 갈피가 밀려 오지 않게)
    final size = _sizeOf(m);
    final c = colY[0] <= colY[1] ? 0 : 1;
    final slotY = colY[c] + size.h / 2;
    colY[c] += size.h + _rowGap;
    if (m.hasSpot) continue;
    var spot = (x: colX[c] + (_hash(m.id, 2) * 2 - 1) * _jitterX, y: slotY + (_hash(m.id, 3) * 2 - 1) * _jitterY, w: size.w, h: size.h);
    // 손으로 옮겨 둔 갈피를 덮지 않게 그 아래로 내린다
    var pushed = false;
    for (var guard = 0; guard < placed.length + 1; guard++) {
      final hit = placed.where((p) => _overlaps(spot, _r(p))).firstOrNull;
      if (hit == null) break;
      spot = (x: spot.x, y: hit.y + (hit.h + spot.h) / 2 + _rowGap, w: spot.w, h: spot.h);
      pushed = true;
    }
    if (pushed) colY[c] = math.max(colY[c], spot.y + spot.h / 2 + _rowGap);
    out.add(BoardSpot(m.id, spot.x, spot.y, size.w, size.h, boardRotOf(m.id), false));
  }
  return out;
}

BoardBounds boardBounds(List<BoardSpot> spots) {
  if (spots.isEmpty) return (x0: 0, y0: 0, x1: boardCardW, y1: boardCardW);
  return (
    x0: spots.map((s) => s.x - s.w / 2).reduce(math.min),
    y0: spots.map((s) => s.y - s.h / 2).reduce(math.min),
    x1: spots.map((s) => s.x + s.w / 2).reduce(math.max),
    y1: spots.map((s) => s.y + s.h / 2).reduce(math.max),
  );
}

/// 전체 보기: 모든 갈피가 화면 안에 들어오는 배율·자리(원래 크기보다 키우지는 않는다)
/// bottom: 화면 아래를 덮는 버튼 줄 높이(그 자리에는 갈피를 두지 않는다)
BoardView boardFit(List<BoardSpot> spots, double vw, double vh, [double bottom = 0, double pad = 28]) {
  final b = boardBounds(spots);
  final h = math.max(1.0, vh - bottom);
  final s = math.max(boardMinScale, [1.0, (vw - pad * 2) / math.max(1, b.x1 - b.x0), (h - pad * 2) / math.max(1, b.y1 - b.y0)].reduce(math.min));
  return BoardView((vw - s * (b.x0 + b.x1)) / 2, math.max(pad, (h - s * (b.y0 + b.y1)) / 2), s);
}

/// 보드가 화면 밖으로 사라지지 않게: 갈피가 있는 범위가 화면에 keep만큼은 걸쳐 있도록
BoardView boardClamp(BoardView v, BoardBounds b, double vw, double vh, [double keep = 72]) {
  final s = math.max(boardMinScale, math.min(boardMaxScale, v.s));
  final x = math.max(keep - s * b.x1, math.min(vw - keep - s * b.x0, v.x));
  final y = math.max(keep - s * b.y1, math.min(vh - keep - s * b.y0, v.y));
  return BoardView(x, y, s);
}

/// 지금 보이는 곳의 빈 자리(+ 갈피): 화면 가운데에서 바깥으로 훑어 다른 갈피와 겹치지 않는 첫 자리, 없으면 가운데
({int x, int y}) boardFreeSpot(List<({double x, double y, double w, double h})> spots, BoardView view, double vw, double vh, ({double w, double h}) size) {
  final cx = (vw / 2 - view.x) / view.s;
  final cy = (vh / 2 - view.y) / view.s;
  final halfW = math.max(0.0, vw / view.s / 2 - size.w / 2);
  final halfH = math.max(0.0, vh / view.s / 2 - size.h / 2);
  for (var ring = 0; ring <= 4; ring++) {
    final n = ring == 0 ? 1 : ring * 8;
    for (var i = 0; i < n; i++) {
      final a = i / n * math.pi * 2;
      final p = (x: cx + math.cos(a) * ring * halfW / 4, y: cy + math.sin(a) * ring * halfH / 4, w: size.w, h: size.h);
      if (!spots.any((o) => _overlaps(p, o))) return (x: p.x.round(), y: p.y.round());
    }
  }
  return (x: cx.round(), y: cy.round());
}

List<({double x, double y, double w, double h})> boardRects(List<BoardSpot> spots) => [for (final s in spots) _r(s)];

/// 보드 저장 값(기기마다, 마지막 위치·배율): 키
String boardViewKey(String bookId) => 'bookmark-board-view:$bookId';

/// 보드에서 옆으로 넘길 책들: 갈피 탭과 같은 최근 갈피 순. 처음 연 책은 갈피가 없어도 들어간다(2026-11-05 사용자 '옆으로 넘기면 옆에 책')
List<String> boardBookIds(Library lib, String first) {
  final marks = [for (final m in lib.bookmarks.values) if (lib.books.containsKey(m.myBookId)) m];
  // 같은 때에 만든 갈피는 원래 순서대로(안정 정렬)
  final idx = [for (var i = 0; i < marks.length; i++) i]..sort((a, b) {
      final c = marks[b].createdAt.compareTo(marks[a].createdAt);
      return c != 0 ? c : a - b;
    });
  final unique = <String>{for (final i in idx) marks[i].myBookId}.toList();
  return unique.contains(first) ? unique : [first, ...unique];
}

/// 가로로 끌 때 보드가 먼저 움직이고, 더 갈 곳이 없으면 남은 만큼(left)이 책 넘기기로 간다.
/// 보드가 화면 폭에 다 들어오면 보드는 가로로 움직이지 않고 전부 넘기기다. 더 넓으면(확대) 보드 끝이 화면 끝(pad)에 닿을 때까지 보드가 움직인다.
({double x, double left}) boardPageSlide(double x, double dx, double s, ({double x0, double x1}) bounds, double vw, [double pad = 16]) {
  if (s * (bounds.x1 - bounds.x0) + pad * 2 <= vw) return (x: x, left: dx);
  final lo = math.min(vw - pad - s * bounds.x1, x);
  final hi = math.max(pad - s * bounds.x0, x);
  final nx = math.max(lo, math.min(hi, x + dx));
  return (x: nx, left: dx - (nx - x));
}
