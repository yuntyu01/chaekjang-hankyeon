// 독서 기록 → 커뮤니티 공유 초안(지금 앱 domain/community-draft.ts, 순수 함수). 개인 기록은 자동으로 공개하지 않는다:
// 사용자가 고른 필드만 게시물에 복사하고, 고르지 않은 것(메모·날짜·다른 갈피·사진)은 보내지 않는다.
// - 분량은 시작 쪽과 도달한 쪽이 둘 다 있을 때만(확인된 분량). 하나만 있으면 보내지 않는다(지어내지 않는다)
// - 갈피 문장은 사진 갈피(글자 없음)는 고를 수 없다. 이 기록에서 남긴 갈피가 먼저, 그다음 같은 책의 최근 갈피
// - clientId는 기록 id: 같은 기록을 두 번 올려도(재시도·중복 누름) 서버에서 하나가 된다
library;

import 'library.dart';

class ShareSource {
  const ShareSource({required this.session, this.bookTitle, this.bookAuthor, this.isbn13, this.coverUrl, required this.durationMs, this.pagesRead, required this.quotes});
  final Session session;
  final String? bookTitle, bookAuthor, isbn13;
  final String? coverUrl; // 도서 정보 제공처 표지(https)일 때만
  final num durationMs;
  final int? pagesRead; // 확인된 분량(쪽)
  final List<Bookmark> quotes;
}

typedef ShareChoice = ({bool duration, bool pages, String? quoteId, String body});

/// 공개 표지 주소: 도서 정보 제공처 표지(api)만, http는 https로. 사용자가 찍은 표지·기기 파일은 보내지 않는다
String? publicCover(Edition? ed) {
  final u0 = ed?.coverUri;
  if (u0 == null || ed!.coverSource != 'api') return null;
  final u = u0.replaceFirst(RegExp(r'^http://'), 'https://');
  return u.startsWith('https://') && u.length <= 500 ? u : null;
}

int? sessionPages(num? startPage, num? pagesRead) {
  if (startPage == null || pagesRead == null) return null;
  final n = pagesRead - startPage;
  return n > 0 ? n.round() : null;
}

ShareSource? shareSourceOf(Library lib, String sessionId) {
  final session = lib.sessions[sessionId];
  if (session == null) return null;
  final book = session.myBookId == null ? null : lib.books[session.myBookId];
  final ed = book == null ? null : lib.editions[book.editionId];
  final quotes = book == null
      ? <Bookmark>[]
      : ([for (final b in lib.bookmarks.values) if (b.myBookId == book.id && b.text.trim().isNotEmpty) b]..sort((a, b) {
          final mine = (b.sessionId == sessionId ? 1 : 0) - (a.sessionId == sessionId ? 1 : 0);
          return mine != 0 ? mine : b.createdAt.compareTo(a.createdAt);
        }))
          .take(20)
          .toList();
  final isbn = ed?.isbn13;
  return ShareSource(
    session: session,
    bookTitle: ed?.title,
    bookAuthor: ed == null || ed.authors.isEmpty ? null : ed.authors.join(', '),
    isbn13: isbn != null && RegExp(r'^\d{13}$').hasMatch(isbn) ? isbn : null,
    coverUrl: publicCover(ed),
    durationMs: session.durationMs,
    pagesRead: sessionPages(session.startPage, session.pagesRead),
    quotes: quotes,
  );
}

/// 처음 고른 상태: 시간은 켜고, 분량은 확인된 것이 있을 때만, 갈피는 이 기록에서 남긴 것이 있으면 그것
ShareChoice defaultChoice(ShareSource src) => (
      duration: src.durationMs > 0,
      pages: src.pagesRead != null,
      quoteId: src.quotes.where((q) => q.sessionId == src.session.id).firstOrNull?.id,
      body: '',
    );

const _maxBody = 1000;
const _maxQuote = 1000;

String _cut(String s, int n) => s.length <= n ? s : s.substring(0, n);

/// 게시할 내용(서버에 보내는 JSON). 게시물은 책 기준이라 책(제목)은 늘 들어간다. 책 없이 읽은 기록은 게시할 수 없다(null)
Map<String, Object?>? sharePayload(ShareSource src, ShareChoice c) {
  final title = src.bookTitle;
  if (title == null) return null;
  final quote = c.quoteId == null ? null : src.quotes.where((q) => q.id == c.quoteId).firstOrNull;
  final body = _cut(c.body.trim(), _maxBody);
  return {
    'clientId': src.session.id,
    'isbn13': ?src.isbn13,
    'bookTitle': title,
    'bookAuthor': ?src.bookAuthor,
    'coverUrl': ?src.coverUrl,
    if (c.duration && src.durationMs > 0) 'durationMs': src.durationMs,
    if (c.pages && src.pagesRead != null) 'pagesRead': src.pagesRead,
    if (quote != null) 'quote': _cut(quote.text.trim(), _maxQuote),
    if (quote != null && quote.page != null && quote.page! > 0) 'quotePage': quote.page,
    if (body.isNotEmpty) 'body': body,
  };
}
