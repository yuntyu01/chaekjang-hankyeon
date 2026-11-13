// 실제 표지·책등 주소(YES24 도서 이미지): 같은 상품 번호에 크기만 다르다(S·M·L·XL). 책등은 /SIDE를 넣은 주소.
// 지금 앱 domain/cover-url.ts를 옮긴 것(흰 여백 재기는 표지 그림을 그리는 단계에서)
library;

final _yes24 = RegExp(r'^(https://image\.yes24\.com/goods/\d+)/(?:S|M|L|XL)$');

String? coverAtSize(String? uri, String size) {
  if (uri == null) return null;
  final m = _yes24.firstMatch(uri);
  return m != null ? '${m.group(1)}/$size' : uri;
}

String? spineOfCover(String? uri, String size) {
  final m = uri == null ? null : _yes24.firstMatch(uri);
  return m != null ? '${m.group(1)}/SIDE/$size' : null;
}

/// 책등 그림 판별: 진짜 책등은 좁고 길다. 책등이 없는 책은 '이미지 준비중' 대체 그림(넓은 그림)이 온다
bool isSpineImage(int width, int height) => height > 0 && width / height < 0.3;

String? _goodsOf(String? uri) => uri == null ? null : _yes24.firstMatch(uri)?.group(1);

/// 책등 사진 비율(폭/높이)을 재 둔 값: 실제 두께만 읽는다. 0 = 책등 사진이 없음, 없음 = 아직 못 쟀다(둘 다 쪽수 두께)
final _spineRatios = <String, double>{};
double? spineRatioOf(String? coverUri) {
  final g = _goodsOf(coverUri);
  return g == null ? null : _spineRatios[g];
}

void rememberSpineRatio(String coverUri, double ratio) {
  final g = _goodsOf(coverUri);
  if (g != null) _spineRatios[g] = ratio;
}

/// 기기에 저장해 둔 책등 비율 목록(지금 앱 spineRatioEntries: [YES24 상품 번호, 비율])
List<List<Object>> spineRatioEntries() => [for (final e in _spineRatios.entries) [e.key, e.value]];
void loadSpineRatioEntries(List<dynamic> entries) {
  for (final e in entries) {
    if (e is List && e.length == 2 && e[1] is num) _spineRatios['${e[0]}'] = (e[1] as num).toDouble();
  }
}

bool needsSpineRatio(String? coverUri) => _goodsOf(coverUri) != null && spineRatioOf(coverUri) == null;

// 표지에서 뽑은 갈피 색(지금 앱 coverAccentOf): ''는 고를 색이 없는 표지, 없음은 아직 못 쟀다. 공개 그림에서 다시 잴 수 있어 기기에만 둔다
final _coverAccents = <String, String>{};
String? coverAccentOf(String? coverUri) {
  final g = _goodsOf(coverUri);
  return g == null ? null : _coverAccents[g];
}

void rememberCoverAccent(String? coverUri, String accent) {
  final g = _goodsOf(coverUri);
  if (g != null) _coverAccents[g] = accent;
}

List<List<String>> coverAccentEntries() => [for (final e in _coverAccents.entries) [e.key, e.value]];
void loadCoverAccentEntries(List<dynamic> entries) {
  for (final e in entries) {
    if (e is List && e.length == 2) _coverAccents['${e[0]}'] = '${e[1]}';
  }
}

bool needsCoverAccent(String? coverUri) => _goodsOf(coverUri) != null && coverAccentOf(coverUri) == null;
