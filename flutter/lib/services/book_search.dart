// 도서 검색 연결부(지금 앱 services/book-search.ts). 책 정보는 YES24 기준이다.
// 우리 서버(API_URL, 서버가 YES24를 부른다) → 서버에 닿지 않거나 결과가 없을 때만 Google Books → Open Library.
// - 우리 서버 /books/search: YES24 키는 서버에만 둔다. YES24는 쪽수·가로·세로(mm)·분류·시리즈까지 준다.
//   YES24 약관: 앱에 보일 때 출처(YES24)와 상품 페이지 링크(link)를 함께 보인다.
// - Google Books: 키가 없으면 공용 할당량(하루 한도가 차면 429).
// - Open Library: 검색 색인에는 판본별 쪽수가 없고, 판본 기록(/books/{id}.json)에 number_of_pages·physical_dimensions가 있다.
// 쪽수·판형은 판본 기록에 있을 때만 '확인된 정보'로 쓴다(없으면 비워 두고 추정값을 채워 넣지 않는다)
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

/// 우리 서버 주소(빌드 때 --dart-define=API_URL=…, 없으면 운영 서버. 지금 앱 EXPO_PUBLIC_API_URL과 같은 기본값)
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'https://covebook.kodeploy.com');
const _googleKey = String.fromEnvironment('GOOGLE_BOOKS_KEY');

typedef SizeMm = ({int widthMm, int heightMm});

class BookCandidate {
  const BookCandidate({
    required this.key,
    required this.title,
    required this.authors,
    required this.sourceName,
    this.publisher,
    this.publishedAt,
    this.isbn13,
    this.pageCount,
    this.size,
    this.coverUrl,
    this.category,
    this.seriesTitle,
    this.detailRef,
    this.link,
    this.productId,
  });
  final String key, title, sourceName;
  final List<String> authors;
  final String? publisher, publishedAt, isbn13, coverUrl, category, seriesTitle, detailRef, link, productId;
  final int? pageCount;
  final SizeMm? size;

  BookCandidate copyWith({int? pageCount, SizeMm? size, String? isbn13, String? publisher, String? publishedAt, String? coverUrl}) => BookCandidate(
        key: key,
        title: title,
        authors: authors,
        sourceName: sourceName,
        publisher: publisher ?? this.publisher,
        publishedAt: publishedAt ?? this.publishedAt,
        isbn13: isbn13 ?? this.isbn13,
        pageCount: pageCount ?? this.pageCount,
        size: size ?? this.size,
        coverUrl: coverUrl ?? this.coverUrl,
        category: category,
        seriesTitle: seriesTitle,
        detailRef: detailRef,
        link: link,
        productId: productId,
      );
}

/// 검색 결과: 성공(목록·제공처) 또는 실패(network · quota · auth · unknown)
typedef SearchResult = ({bool ok, List<BookCandidate> items, String? provider, String? reason, String? message, String? diag});

SearchResult _ok(List<BookCandidate> items, [String? provider, String? diag]) => (ok: true, items: items, provider: provider, reason: null, message: null, diag: diag);
SearchResult _fail(String reason, String message, String diag) => (ok: false, items: const [], provider: null, reason: reason, message: message, diag: diag);

const _offline = '인터넷에 연결되지 않았어요. 직접 입력으로 추가할 수 있어요.';
const _providerName = {'yes24': 'YES24'};

final _http = HttpClient()..connectionTimeout = const Duration(seconds: 12);

/// GET → (상태, JSON). 끊기면 SocketException 등을 던진다
Future<(int, Object?)> _getJson(String url) async {
  final req = await _http.getUrl(Uri.parse(url));
  final res = await req.close().timeout(const Duration(seconds: 15));
  final body = await res.transform(utf8.decoder).join();
  Object? json;
  try {
    json = body.isEmpty ? null : jsonDecode(body);
  } catch (_) {
    json = null;
  }
  return (res.statusCode, json);
}

String? _s(Object? v) => v is String && v.isNotEmpty ? v : null;
int? _i(Object? v) => v is num && v > 0 ? v.round() : null;

/// 서버 검색 결과 한 권(server/internal/server/books.go searchItem)
BookCandidate fromServer(Map<String, Object?> i) {
  final w = _i(i['widthMm']), h = _i(i['heightMm']);
  final isbn = _s(i['isbn13']);
  return BookCandidate(
    key: '${i['provider'] ?? 'server'}:${isbn ?? ''}',
    title: _s(i['title']) ?? '(제목 없음)',
    authors: [for (final a in (i['authors'] as List?) ?? const []) a as String],
    publisher: _s(i['publisher']),
    publishedAt: _s(i['publishedAt']),
    isbn13: isbn,
    pageCount: _i(i['pages']),
    size: w != null && h != null ? (widthMm: math.min(w, h), heightMm: math.max(w, h)) : null,
    coverUrl: _s(i['thumbnailUrl'])?.replaceFirst(RegExp(r'^http:'), 'https:'),
    category: _s(i['category']),
    seriesTitle: _s(i['series']),
    sourceName: _providerName[i['provider']] ?? '도서 정보',
    link: _s(i['link']),
    productId: _s(i['productId']),
  );
}

List<BookCandidate> _serverItems(Object? json) => [
      for (final i in ((json as Map?)?['items'] as List?)?.cast<Map<String, Object?>>() ?? const <Map<String, Object?>>[])
        if (i['provider'] != null && i['provider'] != 'mock') fromServer(i),
    ];

/// 인기 책(책 추가 첫 화면): 서버의 YES24 베스트셀러. 못 받으면 빈 목록(화면은 검색창만)
List<BookCandidate>? _popularCache;
Future<List<BookCandidate>> popularBooks() async {
  final hit = _popularCache;
  if (hit != null) return hit;
  try {
    final (status, json) = await _getJson('$apiUrl/books/popular');
    if (status != 200) return const [];
    final items = _serverItems(json);
    if (items.isNotEmpty) _popularCache = items;
    return items;
  } catch (_) {
    return const [];
  }
}

Future<SearchResult> _searchServer(String q) async {
  try {
    final (status, json) = await _getJson('$apiUrl/books/search?q=${Uri.encodeQueryComponent(q)}');
    if (status != 200) return _fail(status == 429 ? 'quota' : 'unknown', '검색하지 못했어요($status).', 'server $status');
    final items = _serverItems(json);
    return _ok(items, items.isNotEmpty ? items.first.sourceName : '서버');
  } catch (e) {
    return _fail('network', _offline, 'server network $e');
  }
}

int? _cm(Object? v) {
  final n = v is String ? double.tryParse(v.replaceAll(RegExp(r'[^\d.]'), '')) : null;
  return n != null && n.isFinite ? (n * 10).round() : null;
}

/// "21 x 14 x 2 centimeters", "8.5 x 5.5 x 1 inches" → 가로·세로(mm)
SizeMm? parseDimensions(String? s) {
  if (s == null) return null;
  final nums = [for (final m in RegExp(r'[\d.]+').allMatches(s)) ?double.tryParse(m.group(0)!)].where((n) => n > 0).toList();
  if (nums.length < 2) return null;
  final k = RegExp('inch', caseSensitive: false).hasMatch(s)
      ? 25.4
      : RegExp('mm|millimet', caseSensitive: false).hasMatch(s)
          ? 1.0
          : 10.0;
  final a = (nums[0] * k).round(), b = (nums[1] * k).round();
  if (math.max(a, b) < 80 || math.max(a, b) > 450) return null; // 두께·잘못된 값 거르기
  return (widthMm: math.min(a, b), heightMm: math.max(a, b));
}

BookCandidate _fromGoogle(Map<String, Object?> v) {
  final i = (v['volumeInfo'] as Map?)?.cast<String, Object?>() ?? const {};
  final dims = (i['dimensions'] as Map?)?.cast<String, Object?>();
  final h = _cm(dims?['height']), w = _cm(dims?['width']);
  final links = (i['imageLinks'] as Map?)?.cast<String, Object?>();
  final thumb = _s(links?['thumbnail']) ?? _s(links?['smallThumbnail']);
  final ids = ((i['industryIdentifiers'] as List?) ?? const []).cast<Map<String, Object?>>();
  return BookCandidate(
    key: v['id'] as String,
    title: [?_s(i['title']), ?_s(i['subtitle'])].join(': ').isEmpty ? '(제목 없음)' : [?_s(i['title']), ?_s(i['subtitle'])].join(': '),
    authors: [for (final a in (i['authors'] as List?) ?? const []) a as String],
    publisher: _s(i['publisher']),
    publishedAt: _s(i['publishedDate']),
    isbn13: _s(ids.where((x) => x['type'] == 'ISBN_13').firstOrNull?['identifier']),
    pageCount: _i(i['pageCount']),
    size: h != null && w != null ? (widthMm: math.min(w, h), heightMm: math.max(w, h)) : null,
    coverUrl: thumb?.replaceFirst(RegExp(r'^http:'), 'https:').replaceAll('&edge=curl', ''),
    category: (i['categories'] as List?)?.join('>'),
    sourceName: 'Google Books',
    detailRef: 'https://www.googleapis.com/books/v1/volumes/${v['id']}${_googleKey.isNotEmpty ? '?key=$_googleKey' : ''}',
  );
}

Future<SearchResult> _searchGoogle(String q) async {
  try {
    final (status, json) =
        await _getJson('https://www.googleapis.com/books/v1/volumes?q=${Uri.encodeQueryComponent(q)}&maxResults=20&printType=books${_googleKey.isNotEmpty ? '&key=$_googleKey' : ''}');
    if (status != 200) {
      final err = (json as Map?)?['error'] as Map?;
      final reason = (((err?['errors'] as List?)?.firstOrNull as Map?)?['reason'] ?? err?['status'] ?? '') as String;
      final diag = 'Google Books $status $reason';
      if (status == 429 || RegExp('rateLimit|quota', caseSensitive: false).hasMatch(reason)) return _fail('quota', '검색 사용량 한도가 찼어요. 다른 검색으로 찾아볼게요.', diag);
      if (status == 400 || status == 401 || status == 403) return _fail('auth', '검색 설정(키)에 문제가 있어요. 다른 검색으로 찾아볼게요.', diag);
      return _fail('unknown', '검색하지 못했어요($status).', diag);
    }
    return _ok([for (final v in ((json as Map?)?['items'] as List?)?.cast<Map<String, Object?>>() ?? const <Map<String, Object?>>[]) _fromGoogle(v)], 'Google Books');
  } catch (e) {
    return _fail('network', _offline, 'network $e');
  }
}

Future<SearchResult> _searchOpenLibrary(String q) async {
  try {
    const fields = 'key,title,author_name,editions,editions.key,editions.title,editions.publisher,editions.publish_date,editions.isbn,editions.cover_i';
    final (status, json) = await _getJson('https://openlibrary.org/search.json?q=${Uri.encodeQueryComponent(q)}&limit=20&fields=$fields');
    if (status != 200) return _fail('unknown', '검색하지 못했어요($status).', 'Open Library $status');
    return _ok([
      for (final d in ((json as Map?)?['docs'] as List?)?.cast<Map<String, Object?>>() ?? const <Map<String, Object?>>[])
        () {
          final ed = (((d['editions'] as Map?)?['docs'] as List?)?.firstOrNull as Map?)?.cast<String, Object?>();
          final cover = ed?['cover_i'];
          return BookCandidate(
            key: 'ol:${ed?['key'] ?? d['key']}',
            title: _s(ed?['title']) ?? _s(d['title']) ?? '(제목 없음)',
            authors: [for (final a in (d['author_name'] as List?) ?? const []) a as String],
            publisher: _s((ed?['publisher'] as List?)?.firstOrNull),
            publishedAt: _s((ed?['publish_date'] as List?)?.firstOrNull),
            isbn13: _s(((ed?['isbn'] as List?) ?? const []).cast<String>().where((x) => x.length == 13).firstOrNull),
            coverUrl: cover != null ? 'https://covers.openlibrary.org/b/id/$cover-M.jpg' : null,
            sourceName: 'Open Library',
            detailRef: ed?['key'] != null ? 'https://openlibrary.org${ed!['key']}.json' : null,
          );
        }(),
    ], 'Open Library');
  } catch (e) {
    return _fail('network', _offline, 'network $e');
  }
}

/// 검색(서버 → Google Books → Open Library). 모든 곳에 닿지 않을 때만 '인터넷 연결 없음'
Future<SearchResult> searchBooks(String query) async {
  final q = query.trim();
  if (q.isEmpty) return _ok(const []);
  final sv = await _searchServer(q);
  if (sv.ok && sv.items.isNotEmpty) return sv;
  final g = await _searchGoogle(q);
  if (g.ok && g.items.isNotEmpty) return (ok: true, items: g.items, provider: g.provider, reason: null, message: null, diag: !sv.ok ? '서버 검색 실패(${sv.diag}) → Google Books' : g.diag);
  if (!g.ok && g.reason == 'network') return g;
  final o = await _searchOpenLibrary(q);
  if (o.ok) return o;
  return g;
}

/// 고른 판본의 상세(쪽수·판형·ISBN)를 읽어 채운다. 실패하면 목록 값 그대로
Future<BookCandidate> candidateDetails(BookCandidate c) async {
  final ref = c.detailRef;
  if (ref == null) return c;
  try {
    final (status, json) = await _getJson(ref);
    if (status != 200 || json is! Map) return c;
    final j = json.cast<String, Object?>();
    if (c.sourceName == 'Open Library') {
      final covers = (j['covers'] as List?)?.cast<num>();
      return c.copyWith(
        pageCount: _i(j['number_of_pages']),
        size: parseDimensions(_s(j['physical_dimensions'])),
        isbn13: _s((j['isbn_13'] as List?)?.firstOrNull),
        publisher: _s((j['publishers'] as List?)?.firstOrNull),
        publishedAt: _s(j['publish_date']),
        coverUrl: c.coverUrl ?? (covers != null && covers.isNotEmpty ? 'https://covers.openlibrary.org/b/id/${covers.first}-M.jpg' : null),
      );
    }
    final v = _fromGoogle(j);
    return c.copyWith(pageCount: v.pageCount, size: v.size, isbn13: v.isbn13);
  } catch (_) {
    return c;
  }
}
