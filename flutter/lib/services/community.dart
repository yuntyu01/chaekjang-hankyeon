// 커뮤니티(공개 데이터) API(지금 앱 services/community.ts). 개인 서재 동기화(/sync)와 엔드포인트·서버 표가 따로다.
// 공개되는 것은 사용자가 게시·평가할 때 고른 필드뿐이고, 다른 사람의 개인 기록은 볼 수 없다.
// 서버 주소가 없는 빌드·커뮤니티가 닫힌 서버에서는 '쓸 수 없음'을 그대로 알린다(가짜 피드를 채우지 않는다)
library;

import 'sync.dart';

class PublicProfile {
  PublicProfile.of(Map j)
      : userId = (j['userId'] as num).toInt(),
        nickname = (j['nickname'] as String?) ?? '',
        bio = j['bio'] as String?,
        followers = ((j['followers'] as num?) ?? 0).toInt(),
        following = ((j['following'] as num?) ?? 0).toInt(),
        posts = ((j['posts'] as num?) ?? 0).toInt();
  final int userId, followers, following, posts;
  final String nickname;
  final String? bio;
}

class Post {
  Post({required this.id, required this.userId, required this.nickname, required this.bookTitle, required this.likes, required this.liked, required this.comments, required this.mine, required this.createdAt, this.isbn13, this.bookAuthor, this.coverUrl, this.durationMs, this.pagesRead, this.quote, this.quotePage, this.body});
  Post.of(Map j)
      : id = (j['id'] as num).toInt(),
        userId = (j['userId'] as num).toInt(),
        nickname = (j['nickname'] as String?) ?? '',
        isbn13 = j['isbn13'] as String?,
        bookTitle = (j['bookTitle'] as String?) ?? '',
        bookAuthor = j['bookAuthor'] as String?,
        coverUrl = j['coverUrl'] as String?,
        durationMs = j['durationMs'] as num?,
        pagesRead = j['pagesRead'] as num?,
        quote = j['quote'] as String?,
        quotePage = j['quotePage'] as num?,
        body = j['body'] as String?,
        likes = ((j['likes'] as num?) ?? 0).toInt(),
        liked = j['liked'] == true,
        comments = ((j['comments'] as num?) ?? 0).toInt(),
        mine = j['mine'] == true,
        createdAt = (j['createdAt'] as String?) ?? '';
  final int id, userId, likes, comments;
  final String nickname, bookTitle, createdAt;
  final String? isbn13, bookAuthor, coverUrl, quote, body;
  final num? durationMs, pagesRead, quotePage;
  final bool liked, mine;

  Post copyWith({bool? liked, int? likes, int? comments}) => Post(
        id: id,
        userId: userId,
        nickname: nickname,
        bookTitle: bookTitle,
        likes: likes ?? this.likes,
        liked: liked ?? this.liked,
        comments: comments ?? this.comments,
        mine: mine,
        createdAt: createdAt,
        isbn13: isbn13,
        bookAuthor: bookAuthor,
        coverUrl: coverUrl,
        durationMs: durationMs,
        pagesRead: pagesRead,
        quote: quote,
        quotePage: quotePage,
        body: body,
      );
}

class Comment {
  Comment.of(Map j)
      : id = (j['id'] as num).toInt(),
        userId = (j['userId'] as num).toInt(),
        nickname = (j['nickname'] as String?) ?? '',
        body = (j['body'] as String?) ?? '',
        mine = j['mine'] == true,
        createdAt = (j['createdAt'] as String?) ?? '';
  final int id, userId;
  final String nickname, body, createdAt;
  final bool mine;
}

class Review {
  Review.of(Map j)
      : userId = (j['userId'] as num).toInt(),
        nickname = j['nickname'] as String?,
        isbn13 = (j['isbn13'] as String?) ?? '',
        bookTitle = j['bookTitle'] as String?,
        rating = (j['rating'] as num?) ?? 0,
        body = j['body'] as String?;
  final int userId;
  final String? nickname, bookTitle, body;
  final String isbn13;
  final num rating;
}

class BookReviews {
  BookReviews.of(Map j)
      : average = j['average'] as num?,
        count = ((j['count'] as num?) ?? 0).toInt(),
        mine = j['mine'] is Map ? Review.of(j['mine'] as Map) : null,
        items = [for (final x in (j['items'] as List?) ?? const []) Review.of(x as Map)];
  final num? average;
  final int count;
  final Review? mine;
  final List<Review> items;
}

class UserPage {
  UserPage.of(Map j)
      : profile = PublicProfile.of(j['profile'] as Map),
        followed = j['followed'] == true,
        blocked = j['blocked'] == true,
        me = j['me'] == true,
        posts = [for (final x in (j['posts'] as List?) ?? const []) Post.of(x as Map)],
        reviews = [for (final x in (j['reviews'] as List?) ?? const []) Review.of(x as Map)];
  final PublicProfile profile;
  final bool followed, blocked, me;
  final List<Post> posts;
  final List<Review> reviews;
}

class MyProfile {
  MyProfile.of(Map j)
      : profile = j['profile'] is Map ? PublicProfile.of(j['profile'] as Map) : null,
        socialLinked = j['socialLinked'] == true;
  final PublicProfile? profile;
  final bool socialLinked;
}

/// 커뮤니티를 쓸 수 있는지(서버 주소 → 서버가 커뮤니티를 열었는지 /healthz community). reason: no-server · old-server · offline
typedef Availability = ({bool ok, String reason, String message});

Future<Availability>? _checked;

Future<Availability> communityAvailability({bool force = false}) {
  if (syncBase.isEmpty) return Future.value((ok: false, reason: 'no-server', message: '이 빌드는 서버 없이 이 기기에만 저장해요. 커뮤니티는 서버가 있는 빌드에서 쓸 수 있어요.'));
  if (force || _checked == null) {
    _checked = api('GET', '/healthz', null).then<Availability>((h) {
      return (h is Map && h['community'] == true)
          ? (ok: true, reason: '', message: '')
          : (ok: false, reason: 'old-server', message: '연결된 서버가 아직 커뮤니티를 지원하지 않아요. 서버가 업데이트되면 쓸 수 있어요.');
    }, onError: (Object e) {
      _checked = null; // 연결 실패는 다음에 다시 확인
      return (ok: false, reason: 'offline', message: communityError(e));
    });
  }
  return _checked!;
}

Future<Object?> _call(String method, String path, [Object? body]) async => api(method, path, await SyncService.instance.serverToken(), body);

// 서버 오류 코드 → 다음 행동(화면이 고른다)
bool needsSocial(Object e) => e is ApiError && e.code == 'needs_social_account';
bool needsProfile(Object e) => e is ApiError && e.code == 'needs_profile';
bool isNotFound(Object e) => e is ApiError && e.status == 404;

String communityError(Object e) {
  if (e is ApiError) return e.message;
  final m = e is StateError ? e.message : '$e';
  return RegExp('SocketException|Connection|HandshakeException', caseSensitive: false).hasMatch(m) ? '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' : m;
}

String _enc(String s) => Uri.encodeComponent(s);
Map _m(Object? v) => (v as Map?) ?? const {};

abstract final class Community {
  static Future<MyProfile> myProfile() async => MyProfile.of(_m(await _call('GET', '/community/profile')));
  static Future<MyProfile> saveProfile(String nickname, String? bio) async => MyProfile.of(_m(await _call('PUT', '/community/profile', {'nickname': nickname, 'bio': bio})));
  static Future<UserPage> user(int id) async => UserPage.of(_m(await _call('GET', '/community/users/$id')));
  static Future<bool> follow(int id, bool on) async => _m(await _call(on ? 'PUT' : 'DELETE', '/community/users/$id/follow'))['followed'] == true;
  static Future<List<({int userId, String nickname})>> blocks() async =>
      [for (final x in (_m(await _call('GET', '/community/blocks'))['items'] as List?) ?? const []) (userId: ((x as Map)['userId'] as num).toInt(), nickname: (x['nickname'] as String?) ?? '')];
  static Future<bool> block(int id, bool on) async => _m(await _call(on ? 'PUT' : 'DELETE', '/community/users/$id/block'))['blocked'] == true;
  static Future<({List<Post> items, int? nextBefore})> feed(String scope, [int? before]) async {
    final f = _m(await _call('GET', '/community/feed?scope=$scope${before != null ? '&before=$before' : ''}'));
    return (items: [for (final x in (f['items'] as List?) ?? const []) Post.of(x as Map)], nextBefore: (f['nextBefore'] as num?)?.toInt());
  }

  static Future<Post> post(int id) async => Post.of(_m(await _call('GET', '/community/posts/$id')));
  static Future<Post> createPost(Map<String, Object?> d) async => Post.of(_m(await _call('POST', '/community/posts', d)));
  static Future<void> deletePost(int id) => _call('DELETE', '/community/posts/$id');
  static Future<Post> like(int id, bool on) async => Post.of(_m(await _call(on ? 'PUT' : 'DELETE', '/community/posts/$id/like')));
  static Future<List<Comment>> comments(int id) async => [for (final x in (_m(await _call('GET', '/community/posts/$id/comments'))['items'] as List?) ?? const []) Comment.of(x as Map)];
  static Future<List<Comment>> addComment(int id, String body, String clientId) async =>
      [for (final x in (_m(await _call('POST', '/community/posts/$id/comments', {'body': body, 'clientId': clientId}))['items'] as List?) ?? const []) Comment.of(x as Map)];
  static Future<void> deleteComment(int id) => _call('DELETE', '/community/comments/$id');
  static Future<BookReviews> reviews(String isbn13) async => BookReviews.of(_m(await _call('GET', '/community/books/${_enc(isbn13)}/reviews')));
  static Future<BookReviews> saveReview(String isbn13, num rating, String? body, String bookTitle) async =>
      BookReviews.of(_m(await _call('PUT', '/community/books/${_enc(isbn13)}/review', {'rating': rating, 'body': body, 'bookTitle': bookTitle})));
  static Future<BookReviews> deleteReview(String isbn13) async => BookReviews.of(_m(await _call('DELETE', '/community/books/${_enc(isbn13)}/review')));
  static Future<void> report(String kind, Object id, [String? reason]) => _call('POST', '/community/reports', {'kind': kind, 'id': '$id', 'reason': reason});
}
