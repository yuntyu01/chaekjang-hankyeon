// 지금 앱 domain/__tests__/bookmark-board.test.ts와 같은 시험
import 'package:chaekjang/domain/bookmark_board.dart';
import 'package:chaekjang/domain/library.dart';
import 'package:flutter_test/flutter_test.dart';

String at(int n) => '2026-10-${n.toString().padLeft(2, '0')}T00:00:00.000Z';
BoardMark mk(int n, {String text = '천천히 읽어야 보이는 문장이 있다.', num? boardX, num? boardY, num? boardRot, num? boardW}) =>
    BoardMark(id: 'm$n', text: text, createdAt: at(n), boardX: boardX, boardY: boardY, boardRot: boardRot, boardW: boardW);
bool overlap(({double x, double y, double w, double h}) a, ({double x, double y, double w, double h}) b) => (a.x - b.x).abs() < (a.w + b.w) / 2 && (a.y - b.y).abs() < (a.h + b.h) / 2;
({double x, double y, double w, double h}) r(BoardSpot s) => (x: s.x, y: s.y, w: s.w, h: s.h);

void main() {
  group('갈피 보드 자동 배치', () {
    test('자동으로 놓인 갈피끼리 겹치지 않고 빠지지 않는다', () {
      final spots = boardSpots([for (var i = 0; i < 30; i++) mk(i + 1, text: i % 3 == 0 ? '긴 문장 ' * 30 : '천천히 읽어야 보이는 문장이 있다.')]);
      expect(spots, hasLength(30));
      for (var i = 0; i < spots.length; i++) {
        for (var j = i + 1; j < spots.length; j++) {
          expect(overlap(r(spots[i]), r(spots[j])), isFalse);
        }
      }
    });
    test('갈피가 늘어도 이미 놓인 갈피는 움직이지 않는다', () {
      final a = boardSpots([mk(1), mk(2), mk(3)]);
      final b = boardSpots([mk(1), mk(2), mk(3), mk(4), mk(5)]);
      for (final s in a) {
        expect(b.firstWhere((o) => o.id == s.id), s);
      }
    });
    test('한 장을 손으로 옮겨도 다른 갈피는 그 자리에 있다', () {
      final a = boardSpots([mk(1), mk(2), mk(3), mk(4)]);
      final b = boardSpots([mk(1), mk(2, boardX: 900, boardY: 900, boardRot: 1), mk(3), mk(4)]);
      for (final id in ['m1', 'm3', 'm4']) {
        expect(b.firstWhere((o) => o.id == id), a.firstWhere((o) => o.id == id));
      }
      final m2 = b.firstWhere((o) => o.id == 'm2');
      expect([m2.x, m2.y, m2.rot, m2.placed], [900, 900, 1, true]);
    });
    test('새 갈피는 손으로 옮겨 둔 갈피를 덮지 않는다', () {
      final first = boardSpots([mk(1)])[0];
      final spots = boardSpots([mk(1, boardX: first.x + 250, boardY: first.y + 200), mk(2), mk(3)]);
      final moved = spots.firstWhere((s) => s.id == 'm1');
      for (final s in spots) {
        if (s.id != 'm1') expect(overlap(r(s), r(moved)), isFalse);
      }
    });
    test('기울기는 갈피마다 정해져 있고 크지 않다', () {
      expect(boardRotOf('abc'), boardRotOf('abc'));
      for (var i = 0; i < 50; i++) {
        expect(boardRotOf('b$i').abs(), lessThanOrEqualTo(3.2));
      }
    });
    test('사진 갈피는 인화지 크기, 긴 글은 줄 수 한도까지만 커진다', () {
      expect(boardCardSize(text: '', photoUri: 'x', photoRatio: 1.5).h, lessThan(boardCardSize(text: '', photoUri: 'x', photoRatio: 0.9).h));
      expect(boardCardSize(text: '가' * 900).h, boardCardSize(text: '가' * 2000).h);
    });
  });

  group('갈피 보드 보기', () {
    final spots = boardSpots([for (var i = 0; i < 12; i++) mk(i + 1)]);
    const vw = 390.0, vh = 620.0;
    test('전체 보기: 모든 갈피가 화면 안에 들어오고 원래 크기보다 키우지 않는다', () {
      final v = boardFit(spots, vw, vh);
      final b = boardBounds(spots);
      expect(v.s, lessThanOrEqualTo(1));
      expect(b.x0 * v.s + v.x, greaterThanOrEqualTo(0));
      expect(b.x1 * v.s + v.x, lessThanOrEqualTo(vw));
      expect(b.y1 * v.s + v.y, lessThanOrEqualTo(vh));
      expect(boardFit([spots[0]], vw, vh).s, 1);
    });
    test('전체 보기: 아래 버튼 줄이 덮는 자리에는 갈피를 두지 않는다', () {
      final b = boardBounds(spots);
      const bar = 94.0;
      final v = boardFit(spots, vw, vh, bar);
      expect(b.y1 * v.s + v.y, lessThanOrEqualTo(vh - bar));
      expect(b.y0 * v.s + v.y, greaterThanOrEqualTo(0));
      final few = spots.sublist(0, 1);
      final w = boardFit(few, vw, vh, bar);
      expect(w.s, 1);
      expect(boardBounds(few).y1 + w.y, lessThanOrEqualTo(vh - bar));
    });
    test('이동·확대 한도: 배율은 범위 안, 갈피가 화면에서 사라지지 않는다', () {
      final b = boardBounds(spots);
      expect(boardClamp(const BoardView(0, 0, 99), b, vw, vh).s, boardMaxScale);
      expect(boardClamp(const BoardView(0, 0, 0.01), b, vw, vh).s, boardMinScale);
      final far = boardClamp(const BoardView(99999, 99999, 1), b, vw, vh);
      expect(far.x + b.x0, lessThanOrEqualTo(vw));
      expect(far.y + b.y0, lessThanOrEqualTo(vh));
      final back = boardClamp(const BoardView(-99999, -99999, 1), b, vw, vh);
      expect(back.x + b.x1, greaterThanOrEqualTo(0));
    });
    test('빈 자리: 지금 보이는 곳에서 다른 갈피와 겹치지 않는 곳', () {
      final two = spots.sublist(0, 2);
      final v = boardFit(two, vw, vh);
      final p = boardFreeSpot(boardRects(two), v, vw, vh, (w: 216, h: 130));
      for (final s in two) {
        expect(overlap((x: p.x.toDouble(), y: p.y.toDouble(), w: 216, h: 130), r(s)), isFalse);
      }
    });
    test('빈 곳이 없으면 가운데', () {
      final p = boardFreeSpot([(x: 195, y: 310, w: 2000, h: 2000)], const BoardView(0, 0, 1), vw, vh, (w: 216, h: 130));
      expect([p.x, p.y], [195, 310]);
    });
  });

  group('옆 책으로 넘기기', () {
    MyBook book(String id) => MyBook(id: id, editionId: 'e', status: ReadStatus.want, createdAt: '', updatedAt: '');
    Bookmark mark(String id, String book, String created) => Bookmark(id: id, myBookId: book, text: '', createdAt: created, updatedAt: created);
    final lib = Library(
      books: {'a': book('a'), 'b': book('b'), 'c': book('c')},
      bookmarks: {'m1': mark('m1', 'a', '2026-11-01'), 'm2': mark('m2', 'b', '2026-11-03'), 'm3': mark('m3', 'a', '2026-11-02'), 'm4': mark('m4', 'gone', '2026-11-04')},
    );
    test('책 순서는 최근 갈피 순이고 지운 책은 뺀다', () => expect(boardBookIds(lib, 'a'), ['b', 'a']));
    test('갈피가 없는 책으로 열어도 그 책이 들어간다', () => expect(boardBookIds(lib, 'c'), ['c', 'b', 'a']));

    const wide = (x0: 0.0, x1: 1000.0);
    test('보드가 화면에 다 들어오면 가로 끌기는 전부 넘기기다', () => expect(boardPageSlide(40, -30, 0.5, (x0: 0, x1: 500), 360), (x: 40.0, left: -30.0)));
    test('보드가 더 넓으면 끝에 닿을 때까지 보드가 움직이고 남은 만큼만 넘긴다', () {
      expect(boardPageSlide(0, -100, 1, wide, 360), (x: -100.0, left: 0.0));
      expect(boardPageSlide(-650, -20, 1, wide, 360), (x: -656.0, left: -14.0));
      expect(boardPageSlide(10, 20, 1, wide, 360), (x: 16.0, left: 14.0));
    });
    test('범위 밖에 있던 보드는 튀어 들어오지 않는다', () {
      expect(boardPageSlide(100, 20, 1, wide, 360), (x: 100.0, left: 20.0));
      expect(boardPageSlide(100, -20, 1, wide, 360), (x: 80.0, left: 0.0));
    });
  });

  group('카드 크기 바꾸기', () {
    final text = '가' * 46;
    test('기본 폭은 그대로이고 넓히면 줄이 줄어 낮아진다', () {
      final base = boardCardSize(text: text);
      expect(base.w, boardCardW);
      final wide = boardCardSize(text: text, boardW: 400);
      expect(wide.w, 400);
      expect(wide.h, lessThan(base.h));
      expect(boardCardSize(text: text, boardW: 160).h, greaterThan(base.h));
    });
    test('범위 밖 폭은 잘린다', () {
      expect(boardCardSize(text: text, boardW: 9999).w, boardMaxW);
      expect(boardCardSize(text: text, boardW: 1).w, boardMinW);
    });
    test('사진은 폭에 맞춰 커진다', () {
      final small = boardCardSize(text: '', photoUri: 'x', photoRatio: 1);
      final big = boardCardSize(text: '', photoUri: 'x', photoRatio: 1, boardW: 396);
      expect(big.h - small.h, 180);
    });
    test('폭을 바꿔도 왼쪽 위 모서리는 그대로다', () {
      final size = boardCardSize(text: text);
      final spot = BoardSpot('a', 100, 200, size.w, size.h, 2, true);
      final res = boardResized(BoardMark(id: 'a', text: text, createdAt: ''), spot, 320);
      final next = boardCardSize(text: text, boardW: res.boardW);
      expect(res.boardX - next.w / 2, closeTo(100 - size.w / 2, 1e-9));
      expect(res.boardY - next.h / 2, closeTo(200 - size.h / 2, 1e-9));
      expect(res.boardRot, 2);
    });
    test('폭을 바꾼 카드는 보드 범위에도 반영된다', () {
      final s = boardSpots([mk(1, boardX: 0, boardY: 0, boardW: 400)]).single;
      expect(s.w, 400);
      expect(boardBounds([s]).x1, 200);
    });
    test('보드를 넓혀도 기준점은 화면에서 그대로다', () {
      const v = BoardView(50, 80, 0.8);
      final n = boardZoomAt(v, 0.5, 200, 300);
      expect(n.s, closeTo(0.4, 1e-9));
      final boardX = (200 - v.x) / v.s;
      expect(n.x + boardX * n.s, closeTo(200, 1e-9));
    });
  });

  test('기울기가 지금 앱과 같다(같은 해시)', () {
    // 지금 앱 boardRotOf 값(node로 잰 값)
    expect(boardRotOf('m1'), closeTo(-1.3740781452982913, 1e-12));
    expect(boardRotOf('갈피-가'), closeTo(3.144358948735885, 1e-12));
  });
}
