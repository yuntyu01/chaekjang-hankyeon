// 갈피 종이 결·테이프 경로·갈피 색·문장 크기·날짜·낱말 줄바꿈이 지금 앱과 같은지(tool/dump_bookmark.test.ts가 뽑은 값)
import 'dart:convert';
import 'dart:io';

import 'package:chaekjang/domain/color.dart';
import 'package:chaekjang/features/book/labels.dart';
import 'package:chaekjang/features/bookmark/bookmark_card.dart';
import 'package:chaekjang/features/bookmark/paper_grain.dart';
import 'package:chaekjang/ui/keep_all.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final d = jsonDecode(File('test/fixtures/bookmark_cases.json').readAsStringSync()) as Map<String, dynamic>;

  test('종이 결 경로', () {
    for (final c in (d['paper'] as List).cast<Map<String, dynamic>>()) {
      final g = makeGrain(c['seed'] as String);
      expect(g.fine, c['fine'], reason: '${c['seed']} fine');
      expect(g.broad, c['broad'], reason: '${c['seed']} broad');
      expect(g.pulp, c['pulp'], reason: '${c['seed']} pulp');
      expect(g.cloud, c['cloud'], reason: '${c['seed']} cloud');
    }
  });

  test('테이프 경로', () {
    for (final c in (d['tape'] as List).cast<Map<String, dynamic>>()) {
      final t = tapeMaterial(c['seed'] as String);
      final s = c['seed'];
      expect(t.shape, c['shape'], reason: '$s shape');
      expect(t.torn, c['torn'], reason: '$s torn');
      expect(t.swirl, c['swirl'], reason: '$s swirl');
      expect(t.short, c['short'], reason: '$s short');
      expect(t.long, c['long'], reason: '$s long');
      expect(t.pulp, c['pulp'], reason: '$s pulp');
      expect(t.flecks, c['flecks'], reason: '$s flecks');
      expect(t.fringe, c['fringe'], reason: '$s fringe');
    }
  });

  test('갈피 색', () {
    for (final c in (d['colors'] as List).cast<Map<String, dynamic>>()) {
      final p = paperColors(c['accent'] as String?, c['key'] as String);
      expect(p.paper, c['paper'], reason: '${c['accent']} ${c['key']}');
      expect(p.tape, c['tape'], reason: '${c['accent']} ${c['key']}');
    }
  });

  test('문장 크기·날짜·낱말 줄바꿈', () {
    for (final c in (d['quotes'] as List).cast<Map<String, dynamic>>()) {
      final q = quoteType(c['text'] as String);
      expect([q.size, q.lh], [c['size'], c['lh']], reason: c['text'] as String);
    }
    for (final c in (d['dates'] as List).cast<Map<String, dynamic>>()) {
      expect(ymd(c['iso'] as String), c['ymd']);
    }
    for (final c in (d['keep'] as List).cast<Map<String, dynamic>>()) {
      expect(keepAll(c['text'] as String), c['out']);
    }
  });
}
