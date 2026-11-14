// 커뮤니티 공통 조각(지금 앱 features/community: Avatar·PostCard·actions·ReportSheet·Unavailable)
library;

import 'package:flutter/material.dart';

import '../../domain/library.dart' show formatDurationPrecise;
import '../../services/community.dart';
import '../../ui/alert.dart';
import '../../ui/kit.dart';
import '../../ui/theme.dart';
import '../settings/backup_screen.dart' show openBackup;
import 'community_screens.dart' show openCommunityProfile;

const _palette = ['#7F95A8', '#8E9A78', '#B98270', '#6E879E', '#A0906F', '#9A7F8F', '#6F8F86', '#A8826A'];
Color _hex(String h) => Color(0xFF000000 | int.parse(h.substring(1), radix: 16));

/// 공개 프로필 동그라미: 프로필 사진 기능이 없어서 닉네임 첫 글자를 차분한 색 동그라미에 쓴다(사진을 지어내지 않는다). 색은 사용자 번호로 고정
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, required this.id, this.size = 40});
  final String name;
  final int id;
  final double size;

  @override
  Widget build(BuildContext context) {
    final t = name.trim();
    final initial = t.isEmpty ? '?' : String.fromCharCode(t.runes.first).toUpperCase();
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: _hex(_palette[id.abs() % _palette.length]), shape: BoxShape.circle),
        alignment: Alignment.center,
        child: Text(initial, style: TextStyle(fontFamily: AppFonts.uiBold, fontSize: (size * 0.42).roundToDouble(), height: 1.2, color: AppColors.onAccent)),
      ),
    );
  }
}

String ago(String iso, [DateTime? now]) {
  final t = DateTime.tryParse(iso);
  if (t == null) return '';
  final m = ((now ?? DateTime.now()).difference(t).inSeconds / 60).round().clamp(0, 1 << 30);
  if (m < 1) return '방금';
  if (m < 60) return '$m분 전';
  final h = (m / 60).round();
  if (h < 24) return '$h시간 전';
  final d = (h / 24).round();
  if (d < 7) return '$d일 전';
  final l = t.toLocal();
  return '${l.year}.${l.month}.${l.day}';
}

/// 다음 쪽을 이어 붙일 때 같은 게시물이 두 번 오지 않게
List<Post> mergePosts(List<Post> prev, List<Post> page) {
  final seen = {for (final p in prev) p.id};
  return [...prev, for (final p in page) if (!seen.contains(p.id)) p];
}

// 표지가 없을 때의 색: 제목으로 고정한 차분한 책등 색(같은 책은 늘 같은 색)
String _coverColor(String title) {
  var h = 0;
  for (final c in title.codeUnits) {
    h = (h * 31 + c) & 0xFFFFFFFF;
  }
  return _palette[h % _palette.length];
}

String postFacts(num? durationMs, num? pagesRead) =>
    [if (durationMs != null && durationMs > 0) '${formatDurationPrecise(durationMs)} 읽음', if (pagesRead != null && pagesRead > 0) '$pagesRead쪽'].join(' · ');

/// 커뮤니티 독서 게시물 한 장(2026-11-01 사용자 '에타·토스증권·스레드처럼'): 사람이 주인공인 글 한 줄 묶음.
/// [프로필 동그라미] 닉네임 · 시간 / 쓴 글 / 갈피 문장(왼쪽 세로줄) / 책(테두리만 있는 첨부 줄) / 좋아요·댓글.
/// 상자로 감싸지 않고 글과 글 사이는 얇은 선(목록 쪽에서)으로 나눈다
class PostCard extends StatelessWidget {
  const PostCard({super.key, required this.post, this.onOpen, this.onAuthor, this.onLike, this.onMore, this.full = false});
  final Post post;
  final VoidCallback? onOpen, onAuthor, onLike, onMore;
  final bool full;

  @override
  Widget build(BuildContext context) {
    final p = post;
    final facts = postFacts(p.durationMs, p.pagesRead);
    final bookMeta = [if (p.bookAuthor != null && p.bookAuthor!.isNotEmpty) p.bookAuthor!, if (facts.isNotEmpty) facts].join(' · ');
    const meta = TextStyle(fontFamily: AppFonts.ui, fontSize: 13, height: 18 / 13, color: AppColors.inkSoft);
    return Semantics(
      button: onOpen != null,
      label: '${p.nickname}님의 ${p.bookTitle} 독서 기록',
      child: Pressable(
        onPress: onOpen,
        disabled: onOpen == null,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: Space.page),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            GestureDetector(onTap: onAuthor, child: Avatar(name: p.nickname, id: p.userId, size: full ? 44 : 40)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 22),
                  // 이름·시간은 왼쪽(이름만 줄어든다), 더보기는 줄 끝(Flexible과 Spacer를 한 줄에 두면 남는 폭을 반씩 나눠 끝까지 못 간다)
                  child: Row(children: [
                    Expanded(
                      child: Row(children: [
                        Flexible(
                          child: GestureDetector(
                            onTap: onAuthor,
                            child: Text(p.nickname, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: AppFonts.uiBold, fontSize: 15, height: 21 / 15, color: AppColors.ink)),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(ago(p.createdAt), style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 14, height: 20 / 14, color: AppColors.inkSoft)),
                      ]),
                    ),
                    if (onMore != null) MoreDots(label: '더보기', onPress: onMore!),
                  ]),
                ),
                if (p.body != null && p.body!.isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(top: full ? 6 : 4),
                    child: Text(p.body!, maxLines: full ? null : 6, overflow: full ? null : TextOverflow.ellipsis, style: TextStyle(fontFamily: AppFonts.ui, fontSize: full ? 17 : 16, height: full ? 26 / 17 : 24 / 16, color: AppColors.ink)),
                  ),
                // 갈피 문장: 왼쪽 세로줄 인용(명조). 게시물 안에 상자를 겹치지 않는다
                if (p.quote != null && p.quote!.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 10),
                    padding: const EdgeInsets.only(left: 12, top: 2, bottom: 2),
                    decoration: const BoxDecoration(border: Border(left: BorderSide(color: AppColors.track, width: 3))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(p.quote!, maxLines: full ? null : 4, overflow: full ? null : TextOverflow.ellipsis, style: const TextStyle(fontFamily: AppFonts.serif, fontSize: 15, height: 24 / 15, color: AppColors.ink)),
                      if (p.quotePage != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${p.quotePage}쪽', style: meta)),
                    ]),
                  ),
                // 책 첨부: 회색으로 채우지 않고 얇은 테두리만
                Semantics(
                  label: '책 ${p.bookTitle}${bookMeta.isNotEmpty ? ', $bookMeta' : ''}',
                  excludeSemantics: true,
                  child: Container(
                    margin: const EdgeInsets.only(top: 12),
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                    decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.line)),
                    child: Row(children: [
                      RealCover(uri: p.coverUrl, title: p.bookTitle, color: _coverColor(p.bookTitle), width: 36, ratio: 0.7),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(p.bookTitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: AppFonts.uiBold, fontSize: 15, height: 21 / 15, color: AppColors.ink)),
                          if (bookMeta.isNotEmpty) Text(bookMeta, maxLines: 1, overflow: TextOverflow.ellipsis, style: meta),
                        ]),
                      ),
                    ]),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Row(children: [
                    Semantics(
                      button: onLike != null,
                      selected: p.liked,
                      label: '좋아요 ${p.likes}${p.liked ? ', 누름' : ''}',
                      excludeSemantics: true,
                      onTap: onLike,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: onLike,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(minHeight: 32, minWidth: 32),
                          child: Row(mainAxisSize: MainAxisSize.min, children: [
                            LucideIcon('Heart', size: 20, color: p.liked ? AppColors.danger : AppColors.inkSoft, fill: p.liked ? AppColors.danger : null),
                            if (p.likes > 0) Padding(padding: const EdgeInsets.only(left: 4), child: Text('${p.likes}', style: TextStyle(fontFamily: AppFonts.ui, fontSize: 14, height: 20 / 14, color: p.liked ? AppColors.danger : AppColors.inkSoft))),
                          ]),
                        ),
                      ),
                    ),
                    const SizedBox(width: 20),
                    Semantics(
                      label: '댓글 ${p.comments}',
                      excludeSemantics: true,
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        const LucideIcon('MessageCircle', size: 20, color: AppColors.inkSoft),
                        if (p.comments > 0) Padding(padding: const EdgeInsets.only(left: 4), child: Text('${p.comments}', style: const TextStyle(fontFamily: AppFonts.ui, fontSize: 14, height: 20 / 14, color: AppColors.inkSoft))),
                      ]),
                    ),
                  ]),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// 커뮤니티 쓰기(게시·좋아요·댓글·팔로우·평가)가 막혔을 때 다음 행동으로 안내한다. 공개 활동은 소셜 계정 연결 + 공개 닉네임이 있어야 한다(서버가 판단)
void explainWriteError(BuildContext context, Object e, [String fallbackTitle = '처리하지 못했어요']) {
  if (needsSocial(e)) {
    appAlert(context, '계정을 먼저 연결해 주세요', '공개 활동은 Google이나 카카오 계정을 연결한 뒤 할 수 있어요. 이 기기의 개인 기록은 공개되지 않아요.', [
      const AlertButton('나중에', style: AlertStyle.cancel),
      AlertButton('계정 연결', onPress: () => openBackup(context)),
    ]);
  } else if (needsProfile(e)) {
    appAlert(context, '공개 닉네임을 정해 주세요', '게시물·후기·댓글에는 계정 이름 대신 공개 닉네임이 보여요.', [
      const AlertButton('나중에', style: AlertStyle.cancel),
      AlertButton('닉네임 정하기', onPress: () => openCommunityProfile(context)),
    ]);
  } else {
    appAlert(context, fallbackTitle, communityError(e));
  }
}

/// 신고 사유(짧게 고르기). 운영자가 /admin/reports에서 확인한다
const reportReasons = ['스팸·광고', '욕설·혐오', '개인정보 노출', '저작권 침해', '기타'];

Future<void> showReportSheet(BuildContext context, {required String kind, required Object id, required String label}) => showSheet<void>(
      context,
      title: '$label 신고',
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('신고 사유를 골라 주세요.', style: AppType.sub)),
        ListGroup(children: [
          for (final r in reportReasons)
            ListItem(
              label: r,
              onPress: () {
                Navigator.pop(ctx);
                Community.report(kind, id, r).then((_) {
                  if (context.mounted) appAlert(context, '신고를 접수했어요', '운영자가 확인한 뒤 처리해요.');
                }, onError: (Object e) {
                  if (context.mounted) explainWriteError(context, e, '신고하지 못했어요');
                });
              },
            ),
        ]),
      ]),
    );

/// 커뮤니티를 쓸 수 없을 때(서버 없는 빌드·예전 서버·연결 실패): 이유와 다음 행동만. 예시 게시물을 실제처럼 채우지 않는다
class Unavailable extends StatelessWidget {
  const Unavailable({super.key, required this.a, required this.onRetry});
  final Availability a;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Empty(
        title: a.reason == 'no-server'
            ? '이 빌드에서는 커뮤니티를 쓸 수 없어요'
            : a.reason == 'old-server'
                ? '커뮤니티 준비 중이에요'
                : '커뮤니티에 연결하지 못했어요',
        body: a.message,
        action: a.reason == 'no-server' ? null : '다시 시도',
        onAction: onRetry,
        actionKind: 'secondary',
      );
}

/// 줄 끝 작은 더보기(⋯): 아이콘 크기 그대로 두어 머리줄 높이(22)를 늘리지 않고, 누를 자리는 왼쪽 빈자리로 넓힌다(지금 앱 hitSlop 10)
class MoreDots extends StatelessWidget {
  const MoreDots({super.key, required this.label, required this.onPress});
  final String label;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: label,
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onPress,
          child: const Padding(padding: EdgeInsets.fromLTRB(16, 2, 0, 2), child: LucideIcon('MoreHorizontal', size: 18, color: AppColors.inkSoft)),
        ),
      );
}
