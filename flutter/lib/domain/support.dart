// 쌓기 더미의 상자들(아래 → 위): 위 책은 아래 책의 실제 윗면 높이에, 깊이는 아래 책 가운데에 맞춘다. 지금 앱 domain/support.ts
library;

import 'book3_physics.dart';
import 'geometry.dart';
import 'placed.dart';
import 'types.dart';

class StackMember {
  const StackMember(this.bookId, this.book, {this.spin, this.depth, this.dx, this.dz, this.flip = false});
  final String bookId;
  final Book book;
  final double? spin;
  final double? depth;
  final double? dx;
  final double? dz;
  final bool flip;
}

List<Placed> stackBoxes(List<StackMember> members, double x) {
  final offs = stackOffsets([for (final m in members) m.book], [for (final m in members) m.spin ?? 0]);
  final out = <Placed>[];
  for (var i = 0; i < members.length; i++) {
    final m = members[i];
    final size = boxSize(m.book, Pose.horizontal);
    final spin = m.spin ?? 0;
    final d = spunExtent(m.book, spin).d;
    var y = 0.0;
    var z = m.depth ?? defaultDepth(m.book, Pose.horizontal);
    if (i > 0) {
      final lower = out[i - 1];
      y = topY(fromPlaced(lower));
      final dl = spunExtent(members[i - 1].book, members[i - 1].spin ?? 0).d;
      z = lower.z + (dl - d) / 2 + (m.dz ?? 0);
    }
    out.add(Placed(m.bookId, Pose.horizontal, size, x + offs[i] + (i > 0 ? (m.dx ?? 0) : 0), y, z, 0, spin: spin, flip: m.flip));
  }
  return out;
}
