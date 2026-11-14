// 책 옮겨 가기(row_tween): 같은 줄에서 자리가 바뀐 책만 이전 자세에서 새 자세로, 움직이는 중에 다시 바뀌면 그 중간에서 이어서
import 'package:chaekjang/domain/book3.dart';
import 'package:chaekjang/domain/shelf_row.dart';
import 'package:chaekjang/domain/vec3.dart';
import 'package:chaekjang/features/home/row_tween.dart';
import 'package:flutter_test/flutter_test.dart';

Book3 _b(String id, double x) => Book3(id: id, dims: const Dims(20, 200, 130), t: Vec3(x, 100, 60));
RowCase _row(List<Book3> books) => buildRow(books, 300);

void main() {
  test('자리가 바뀐 책만 섞이고, 끝나면 새 줄 그대로', () {
    final t = RowTween();
    final a = [_row([_b('x', 10), _b('y', 40)])];
    expect(t.retarget(a), isTrue);
    expect(t.active, isFalse);
    expect(identical(t.at(0), a), isTrue);
    final b = [_row([_b('x', 10), _b('y', 80)])];
    expect(t.retarget(b), isTrue);
    expect(t.active, isTrue);
    final half = t.at(0.5);
    expect(half.first.books.firstWhere((v) => v.id == 'y').t.x, closeTo(60, 1e-9));
    expect(half.first.books.firstWhere((v) => v.id == 'x').t.x, 10);
    // 같은 목록을 다시 줘도 처음부터 다시 재지 않는다
    expect(t.retarget(b), isFalse);
    expect(identical(t.at(1), b), isTrue);
    expect(t.active, isFalse);
  });

  test('움직이는 중에 목록이 바뀌면 보이던 중간 자세에서 이어서', () {
    final t = RowTween();
    t.retarget([_row([_b('y', 0)])]);
    t.retarget([_row([_b('y', 100)])]);
    t.at(0.25); // 25에 보인다
    t.retarget([_row([_b('y', 0)])]);
    expect(t.at(0).first.books.single.t.x, closeTo(25, 1e-9));
    expect(t.at(0.5).first.books.single.t.x, closeTo(12.5, 1e-9));
  });

  test('움직임 줄이기·줄 수가 바뀌면 바로 놓는다', () {
    final t = RowTween();
    t.retarget([_row([_b('y', 0)])]);
    t.retarget([_row([_b('y', 100)])], animate: false);
    expect(t.active, isFalse);
    t.retarget([_row([_b('y', 0)]), _row(const [])]);
    expect(t.active, isFalse);
  });
}
