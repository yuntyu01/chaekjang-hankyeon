// 고르는 장정 값(지금 앱 BindingDraft): 장정 편집·책 추가가 고르고, 서재가 저장한다
library;

import 'library.dart' show Binding, BookArtParams, Edition;
import 'rebinding.dart' show RebindInput, buildBookArt, rebindInput;

/// 고르는 장정 값(지금 앱 BindingDraft)
class BindingDraft {
  const BindingDraft({required this.spineColor, required this.motif, this.seed = 0, this.source = 'default', this.inkColor, this.accentColor, this.layout, this.material, this.coverArtId});
  final String spineColor, motif, source;
  final num seed;
  final String? inkColor, accentColor, layout, material, coverArtId;

  /// 추천 장정 값(판본에 저장된 추천 장정)
  factory BindingDraft.of(BookArtParams a) => BindingDraft(spineColor: a.baseColor, motif: a.motifId, inkColor: a.inkColor, accentColor: a.accentColor, layout: a.layoutVariant);

  /// 판본의 추천 장정(저장된 값이 없으면 지금 입력으로 다시 계산)
  factory BindingDraft.recommended(Edition? e) {
    if (e?.art case final p?) return BindingDraft.of(p);
    final a = buildBookArt(e != null ? rebindInput(e) : const RebindInput(title: ''));
    return BindingDraft(spineColor: a.baseColor, motif: a.motifId, inkColor: a.inkColor, accentColor: a.accentColor, layout: a.layoutVariant);
  }

  /// 저장된 장정(없으면 추천 그대로)
  factory BindingDraft.saved(Binding? bd, BindingDraft rec) => bd == null
      ? rec
      : BindingDraft(
          spineColor: bd.spineColor,
          motif: bd.motif,
          seed: bd.seed,
          source: bd.source,
          inkColor: bd.inkColor ?? rec.inkColor,
          accentColor: bd.accentColor ?? rec.accentColor,
          layout: bd.layout ?? rec.layout,
          material: bd.material,
          coverArtId: bd.coverArtId,
        );

  /// 사용자가 고른 장정(source custom). 재질·그림은 null을 주면 비운다
  BindingDraft custom({String? spineColor, String? inkColor, String? accentColor, String? layout, Object? material = _keep, Object? coverArtId = _keep}) => BindingDraft(
    spineColor: spineColor ?? this.spineColor,
    motif: motif,
    seed: seed,
    source: 'custom',
    inkColor: inkColor ?? this.inkColor,
    accentColor: accentColor ?? this.accentColor,
    layout: layout ?? this.layout,
    material: identical(material, _keep) ? this.material : material as String?,
    coverArtId: identical(coverArtId, _keep) ? this.coverArtId : coverArtId as String?,
  );

  @override
  bool operator ==(Object other) =>
      other is BindingDraft &&
      other.spineColor == spineColor &&
      other.motif == motif &&
      other.source == source &&
      other.seed == seed &&
      other.inkColor == inkColor &&
      other.accentColor == accentColor &&
      other.layout == layout &&
      other.material == material &&
      other.coverArtId == coverArtId;

  @override
  int get hashCode => Object.hash(spineColor, motif, source, seed, inkColor, accentColor, layout, material, coverArtId);
}

const _keep = Object();
