// 지금 앱 domain/__tests__/sync.test.ts와 같은 시험
import 'package:chaekjang/db/library_write.dart' show LibKind;
import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/domain/sync.dart';
import 'package:flutter_test/flutter_test.dart';

const dir = 'file:///docs/images/';
const t1 = '2026-10-05T01:00:00.000Z';
const t2 = '2026-10-05T02:00:00.000Z';
const t3 = '2026-10-05T03:00:00.000Z';

Library lib() => Library(
      editions: {
        'ed1': Edition(
          id: 'ed1',
          isbn13: '9788937462788',
          title: '채식주의자',
          authors: const ['한강', '번역가'],
          widthMm: 128,
          heightMm: 205,
          coverUri: '${dir}cover_a.jpg',
          coverSource: 'photo',
          source: 'photo',
          createdAt: t1,
          updatedAt: t1,
          art: const BookArtParams('#6B7F92', '#F7EEDC', '#C9A46A', 'moon', 'spine_b', 'tall', 'medium', t1, 1),
        ),
      },
      books: {'bk1': MyBook(id: 'bk1', editionId: 'ed1', status: ReadStatus.read, bindingId: 'bd1', createdAt: t1, updatedAt: t1)},
      bindings: {
        'bd1': Binding(id: 'bd1', myBookId: 'bk1', spineColor: '#6B7F92', motif: 'moon', layout: 'spine_b', material: 'linen', coverArtId: 'moon-lake', source: 'custom', status: 'ready', seed: 0, createdAt: t1, updatedAt: t1),
      },
      bookmarks: {'bm1': Bookmark(id: 'bm1', myBookId: 'bk1', text: '', photoUri: '${dir}page_x1.jpg', photoRatio: 1.32, createdAt: t1, updatedAt: t1)},
    );

Map<String, Object?> pull([Map<String, Object?> p = const {}]) => {'rev': 1, 'more': false, 'editions': [], 'books': [], 'bindings': [], 'rounds': [], 'sessions': [], 'bookmarks': [], 'layout': null, ...p};

void main() {
  group('올리기 변환', () {
    test('사진 갈피·직접 찍은 표지는 파일 이름을 파일 id로 올린다', () {
      final r = buildPush(lib(), fullDirty(lib()), dir);
      expect(r.count, 4);
      expect(r.body['bookmarks']![0], containsPair('photoFileId', 'page_x1.jpg'));
      expect(r.body['bookmarks']![0]['photoRatio'], 1.32);
      final e = r.body['editions']![0];
      expect([e['coverFileId'], e['coverSource'], e['widthMm'], e['heightMm'], e['authors']], ['cover_a.jpg', 'photo', 128, 205, ['한강', '번역가']]);
      expect((e['art']! as Map)['motifId'], 'moon');
      expect((e['art']! as Map)['layoutVariant'], 'spine_b');
      final b = r.body['bindings']![0];
      expect([b['source'], b['layout'], b['material']], ['custom', 'spine_b', 'linen']);
    });
    test('삭제는 삭제 표시로, 이미 없고 삭제도 아닌 항목은 건너뛴다', () {
      final r = buildPush(lib(), {dirtyKey(LibKind.bookmarks, 'gone'): (deleted: true, at: t2), dirtyKey(LibKind.rounds, 'ghost'): (deleted: false, at: t2)}, dir);
      expect(r.count, 1);
      expect(r.body['bookmarks'], [
        {'id': 'gone', 'deleted': true, 'updatedAt': t2},
      ]);
      expect(r.body['rounds'], isEmpty);
    });
    test('파일 id는 앱 보관 폴더 안 안전한 이름만', () {
      expect(fileIdOf('${dir}a.jpg', dir), 'a.jpg');
      expect(fileIdOf('file:///elsewhere/a.jpg', dir), isNull);
      expect(fileIdOf('$dir../x.jpg', dir), isNull);
      expect(fileIdOf(null, dir), isNull);
    });
  });

  group('받은 변경 병합', () {
    Map<String, Object?> remoteBookmark(String updatedAt, [String text = '서버']) =>
        {'id': 'bm1', 'myBookId': 'bk1', 'text': text, 'photoFileId': 'page_x1.jpg', 'photoRatio': 1.32, 'createdAt': t1, 'updatedAt': updatedAt, 'deleted': false};
    test('서버가 더 새로우면 서버 값, 오래되면 이 기기 값을 유지', () {
      final newer = mergeRemote(lib(), pull({'bookmarks': [remoteBookmark(t2)]}), dir);
      expect(newer.lib.bookmarks['bm1']!.text, '서버');
      expect(newer.writes, hasLength(1));
      final same = mergeRemote(lib(), pull({'bookmarks': [remoteBookmark(t1)]}), dir);
      expect(same.lib.bookmarks['bm1']!.text, '');
      expect(same.writes, isEmpty);
    });
    test('같은 시각을 다른 표기(…:00Z / …:00.000Z)로 받아도 같은 시각으로 본다', () {
      final m = mergeRemote(lib(), pull({'bookmarks': [{'id': 'bm1', 'myBookId': 'bk1', 'text': '서버', 'createdAt': t1, 'updatedAt': '2026-10-05T01:00:00Z', 'deleted': false}]}), dir);
      expect(m.writes, isEmpty);
    });
    test('서버의 삭제 표시는 더 새로울 때만 지운다', () {
      final gone = mergeRemote(lib(), pull({'bookmarks': [{'id': 'bm1', 'deleted': true, 'updatedAt': t2}]}), dir);
      expect(gone.lib.bookmarks['bm1'], isNull);
      expect([for (final e in gone.erases) (e.kind, e.id)], [(LibKind.bookmarks, 'bm1')]);
      final local = lib();
      final m = local.bookmarks['bm1']!;
      local.bookmarks['bm1'] = Bookmark(id: m.id, myBookId: m.myBookId, text: m.text, photoUri: m.photoUri, photoRatio: m.photoRatio, createdAt: t1, updatedAt: t3);
      expect(mergeRemote(local, pull({'bookmarks': [{'id': 'bm1', 'deleted': true, 'updatedAt': t2}]}), dir).lib.bookmarks['bm1'], isNotNull);
    });
    test('아직 올리지 않은 삭제보다 오래된 서버 값은 되살리지 않는다', () {
      final merged = mergeRemote(Library(), pull({'bookmarks': [remoteBookmark(t2)]}), dir, {dirtyKey(LibKind.bookmarks, 'bm1'): (deleted: true, at: t3)});
      expect(merged.lib.bookmarks['bm1'], isNull);
      expect(merged.writes, isEmpty);
      final newer = mergeRemote(Library(), pull({'bookmarks': [remoteBookmark(t3)]}), dir, {dirtyKey(LibKind.bookmarks, 'bm1'): (deleted: true, at: t2)});
      expect(newer.lib.bookmarks['bm1']!.text, '서버');
    });
    test('다른 기기에서 만든 사진 갈피·표지: 받아 와야 할 파일과 로컬 주소', () {
      final m = mergeRemote(
          Library(),
          pull({
            'editions': [{'id': 'e9', 'title': '새 책', 'authors': ['저자'], 'widthMm': 120, 'heightMm': 190, 'coverFileId': 'cover_z.jpg', 'coverSource': 'photo', 'source': 'photo', 'updatedAt': t2, 'createdAt': t2, 'deleted': false}],
            'bookmarks': [{'id': 'm9', 'myBookId': 'b9', 'text': '', 'photoFileId': 'page_z.jpg', 'photoRatio': 1.5, 'createdAt': t2, 'updatedAt': t2, 'deleted': false}],
          }),
          dir);
      expect(m.lib.bookmarks['m9']!.photoUri, '${dir}page_z.jpg');
      expect(m.lib.editions['e9']!.coverUri, '${dir}cover_z.jpg');
      expect(m.files..sort(), ['cover_z.jpg', 'page_z.jpg']);
    });
    test('장정 재질: 아는 값만 받고 모르는 값·빈 값은 없음으로(예전 이름은 가장 가까운 새 재질로)', () {
      Map<String, Object?> bd(Object? material, String id) => {'id': id, 'myBookId': 'bk1', 'spineColor': '#6B7F92', 'motif': 'moon', 'material': material, 'source': 'custom', 'status': 'ready', 'createdAt': t1, 'updatedAt': t2, 'deleted': false};
      final m = mergeRemote(Library(), pull({'bindings': [bd('coated', 'a'), bd('metal', 'b'), bd(null, 'c')]}), dir).lib;
      expect([m.bindings['a']!.material, m.bindings['b']!.material, m.bindings['c']!.material], ['matte', null, null]);
    });
    test('표지 그림 id: 아는 그림만 받고 모르는 값·빈 값은 없음으로', () {
      Map<String, Object?> bd(Object? art, String id) => {'id': id, 'myBookId': 'bk1', 'spineColor': '#6B7F92', 'motif': 'moon', 'coverArtId': art, 'source': 'custom', 'status': 'ready', 'createdAt': t1, 'updatedAt': t2, 'deleted': false};
      final m = mergeRemote(Library(), pull({'bindings': [bd('winter-forest', 'a'), bd('mars', 'b'), bd(null, 'c')]}), dir).lib;
      expect([m.bindings['a']!.coverArtId, m.bindings['b']!.coverArtId, m.bindings['c']!.coverArtId], ['winter-forest', null, null]);
    });
    test('올렸다 받은 서재는 같은 모양으로 돌아온다(왕복)', () {
      final original = lib();
      final wire = buildPush(original, fullDirty(original), dir).body;
      final back = mergeRemote(Library(), pull({'editions': wire['editions'], 'books': wire['books'], 'bindings': wire['bindings'], 'bookmarks': wire['bookmarks']}), dir).lib;
      final e = back.editions['ed1']!;
      expect([e.title, e.authors, e.widthMm, e.heightMm, e.coverUri], ['채식주의자', ['한강', '번역가'], 128, 205, '${dir}cover_a.jpg']);
      expect([e.art!.baseColor, e.art!.motifId, e.art!.layoutVariant], ['#6B7F92', 'moon', 'spine_b']);
      final b = back.bindings['bd1']!;
      expect([b.source, b.motif, b.layout, b.material, b.coverArtId], ['custom', 'moon', 'spine_b', 'linen', 'moon-lake']);
      final m = back.bookmarks['bm1']!;
      expect([m.text, m.photoUri, m.photoRatio], ['', '${dir}page_x1.jpg', 1.32]);
    });
  });

  group('갈피 보드 자리 동기화', () {
    final mark = Bookmark(id: 'bm9', myBookId: 'bk1', text: '문장', boardX: 120.5, boardY: 80, boardRot: -2.5, createdAt: t1, updatedAt: t1);
    Library lib0([num? w]) => Library(bookmarks: {
          'bm9': Bookmark(id: 'bm9', myBookId: 'bk1', text: '문장', boardX: 120.5, boardY: 80, boardRot: -2.5, boardW: w, createdAt: t1, updatedAt: t1),
        });
    const wire = {'id': 'bm9', 'myBookId': 'bk1', 'text': '바뀜', 'createdAt': t1, 'updatedAt': t2};
    Map<String, Object?> pullOf(Map<String, Object?> b) => pull({'bookmarks': [b]});
    test('올릴 때 자리를 함께 보낸다', () {
      final b = buildPush(Library(bookmarks: {'bm9': mark}), {dirtyKey(LibKind.bookmarks, 'bm9'): (deleted: false, at: t1)}, dir).body['bookmarks']![0];
      expect([b['boardX'], b['boardY'], b['boardRot']], [120.5, 80, -2.5]);
    });
    test('받은 자리를 그대로 쓴다', () {
      final m = mergeRemote(lib0(), pullOf({...wire, 'boardX': 10, 'boardY': 20, 'boardRot': 1}), dir).lib.bookmarks['bm9']!;
      expect([m.text, m.boardX, m.boardY, m.boardRot], ['바뀜', 10, 20, 1]);
    });
    test('자리 칸이 없는 옛 서버 응답은 기기의 자리를 지우지 않는다', () {
      final m = mergeRemote(lib0(), pullOf(wire), dir).lib.bookmarks['bm9']!;
      expect([m.text, m.boardX, m.boardY, m.boardRot], ['바뀜', 120.5, 80, -2.5]);
    });
    test('카드 폭을 모르는 옛 서버의 응답은 기기의 폭을 지우지 않고, 아는 서버의 값은 따른다', () {
      final local = lib0(320);
      expect(mergeRemote(local, pullOf({...wire, 'boardX': 10, 'boardY': 20, 'boardRot': 1}), dir).lib.bookmarks['bm9']!.boardW, 320);
      expect(mergeRemote(local, pullOf({...wire, 'boardX': 10, 'boardY': 20, 'boardRot': 1, 'boardW': 280}), dir).lib.bookmarks['bm9']!.boardW, 280);
      expect(mergeRemote(local, pullOf({...wire, 'boardX': 10, 'boardY': 20, 'boardRot': 1, 'boardW': null}), dir).lib.bookmarks['bm9']!.boardW, isNull);
    });
    test('자리가 비었다고 온 새 서버 값(null)은 비운다', () {
      expect(mergeRemote(lib0(), pullOf({...wire, 'boardX': null, 'boardY': null, 'boardRot': null}), dir).lib.bookmarks['bm9']!.boardX, isNull);
    });
  });
}
