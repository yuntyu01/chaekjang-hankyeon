import 'package:chaekjang/domain/binding_draft.dart';
import 'package:chaekjang/domain/library.dart' show Binding;
import 'package:flutter_test/flutter_test.dart';

void main() {
  const rec = BindingDraft(spineColor: '#8F6E55', motif: 'none', inkColor: '#F5EFE6', accentColor: '#C9A46A', layout: 'spine_a');

  test('고르면 사용자 장정이 되고, 주지 않은 재질·그림은 그대로', () {
    final a = rec.custom(material: 'linen');
    expect(a.source, 'custom');
    expect(a.material, 'linen');
    final b = a.custom(coverArtId: 'art-1');
    expect(b.material, 'linen');
    expect(b.coverArtId, 'art-1');
    // null을 주면 비운다
    expect(b.custom(coverArtId: null).coverArtId, isNull);
    expect(b.custom(coverArtId: null).material, 'linen');
  });

  test('저장된 장정이 없으면 추천 그대로, 있으면 빈 글자색만 추천으로 채운다', () {
    expect(BindingDraft.saved(null, rec), rec);
    final bd = Binding(id: 'bd1', myBookId: 'bk1', spineColor: '#123456', motif: 'none', source: 'custom', status: 'ready', seed: 3, createdAt: '', updatedAt: '', material: 'matte');
    final v = BindingDraft.saved(bd, rec);
    expect(v.spineColor, '#123456');
    expect(v.inkColor, rec.inkColor);
    expect(v.material, 'matte');
    expect(v.seed, 3);
    expect(v.source, 'custom');
  });

  test('판본이 없으면 제목 없는 입력으로 추천을 계산한다', () {
    final v = BindingDraft.recommended(null);
    expect(v.spineColor, startsWith('#'));
    expect(v.source, 'default');
  });
}
