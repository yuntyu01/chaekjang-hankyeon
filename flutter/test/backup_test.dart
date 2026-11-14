// 백업 파일(지금 앱 store/backup.ts 형식): 서재 JSON 왕복과 파일 검사
import 'dart:convert';

import 'package:chaekjang/domain/library.dart';
import 'package:chaekjang/domain/library_json.dart';
import 'package:chaekjang/store/backup.dart' show validateBackup;
import 'package:flutter_test/flutter_test.dart';

const t1 = '2026-10-05T01:00:00.000Z';

Library lib() => Library(
      editions: {
        'ed1': Edition(id: 'ed1', title: '채식주의자', authors: const ['한강'], source: 'photo', createdAt: t1, updatedAt: t1, widthMm: 128, heightMm: 205, coverUri: 'file:///img/cover_a.jpg', coverSource: 'photo',
            art: const BookArtParams('#6B7F92', '#F7EEDC', '#C9A46A', 'moon', 'spine_b', 'tall', 'medium', t1, 1)),
      },
      books: {'bk1': MyBook(id: 'bk1', editionId: 'ed1', status: ReadStatus.read, bindingId: 'bd1', createdAt: t1, updatedAt: t1, rating: 4.5, note: '좋다')},
      rounds: {'r1': Round(id: 'r1', myBookId: 'bk1', index: 1, createdAt: t1, updatedAt: t1, startedAt: '2026-10-01', finishedAt: '2026-10-04')},
      sessions: {'s1': Session(id: 's1', startedAt: t1, endedAt: t1, durationMs: 60000, createdAt: t1, updatedAt: t1, myBookId: 'bk1', roundId: 'r1', memo: '메모')},
      bookmarks: {'m1': Bookmark(id: 'm1', myBookId: 'bk1', text: '문장', createdAt: t1, updatedAt: t1, photoUri: 'file:///img/page_1.jpg', boardX: 10, boardW: 300)},
      bindings: {'bd1': Binding(id: 'bd1', myBookId: 'bk1', spineColor: '#6B7F92', motif: 'moon', source: 'custom', status: 'ready', seed: 0, createdAt: t1, updatedAt: t1, material: 'linen', coverArtId: 'moon-lake')},
    );

void main() {
  test('서재 JSON 왕복(지금 앱 Library 모양)', () {
    final j = libraryToJson(lib());
    expect(jsonEncode(libraryToJson(libraryFromJson(jsonDecode(jsonEncode(j)) as Map<String, Object?>))), jsonEncode(j));
    expect((j['editions']! as Map)['ed1']['size'], {'widthMm': 128, 'heightMm': 205});
  });

  Map<String, Object?> backup() {
    final l = mapImagesJson(libraryToJson(lib()), (u) => u == null ? null : 'img:${u.split('/').last}');
    return {
      'app': 'chaekjang',
      'format': 1,
      'exportedAt': t1,
      'library': l,
      'layout': '{"version":2,"shelves":[],"placements":[],"drawer":[]}',
      'view': null,
      'settings': {},
      'images': {'cover_a.jpg': 'AA==', 'page_1.jpg': 'AA=='},
      'bookcases': [],
    };
  }

  test('맞는 백업은 통과, 틀린 곳은 이유를 알린다', () {
    expect(validateBackup(jsonDecode(jsonEncode(backup()))), isNull);
    expect(validateBackup({...backup(), 'app': 'x'}), '책장 한켠 백업 파일이 아니에요.');
    expect(validateBackup({...backup(), 'images': {'cover_a.jpg': 'AA=='}}), '사진 파일을 찾지 못했어요.');
    expect(validateBackup({...backup(), 'layout': '{"version":3}'}), '책장 배치가 올바르지 않아요.');
    final broken = jsonDecode(jsonEncode(backup())) as Map<String, Object?>;
    ((broken['library']! as Map)['books'] as Map)['bk1']['editionId'] = 'nope';
    expect(validateBackup(broken), '책과 도서 정보의 연결이 올바르지 않아요.');
    final badId = jsonDecode(jsonEncode(backup())) as Map<String, Object?>;
    ((badId['library']! as Map)['bookmarks'] as Map)['m1']['id'] = 'other';
    expect(validateBackup(badId), '기록(bookmarks) 중 id가 맞지 않는 항목이 있어요.');
  });
}
