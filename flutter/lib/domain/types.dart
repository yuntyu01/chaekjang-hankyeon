// 서재의 값들(책·자리). app/src/domain/types.ts에서 책장을 그리는 데 쓰는 것만 옮긴 것.
library;

/// 책 높이 등급
enum HeightClass { short, medium, tall }

/// 책 두께 등급
enum ThicknessClass { thin, medium, thick }

/// 자세: 세움 · 눕힘 · 표지 전시
enum Pose { upright, horizontal, front }

/// 실제 판형·쪽수(있으면 등급 대신 이걸로 크기를 정한다)
class Physical {
  const Physical({this.widthMm, this.heightMm, this.pages});
  final double? widthMm;
  final double? heightMm;
  final int? pages;
}

/// 그리는 책 크기(DU): 실제 판형에서 정한 값(지금 앱 Book.dims, jacket-proportions realDimensions)
class BookDims {
  const BookDims(this.height, this.thickness, this.coverWidth);
  final double height;
  final double thickness;
  final double coverWidth;
}

class Book {
  const Book({
    required this.id,
    required this.title,
    this.author,
    this.themeColor = 0x8F6E55,
    this.heightClass = HeightClass.medium,
    this.thicknessClass = ThicknessClass.medium,
    this.coverAspectRatio = 0.68,
    this.physical,
    this.coverUri,
    this.inkColor,
    this.dims,
    this.coverArtUri,
    this.ribbonColor,
    this.titleTop,
    this.quotes = 0,
    this.startedAt,
    this.finishedAt,
  });

  final String id;
  final String title;
  final String? author;

  /// 장정 대표 색(0xRRGGBB)
  final int themeColor;
  final HeightClass heightClass;
  final ThicknessClass thicknessClass;

  /// 표지 너비/높이
  final double coverAspectRatio;
  final Physical? physical;
  final String? coverUri;

  /// 장정에 저장된 제목 색(#rrggbb, 없으면 자동)
  final String? inkColor;

  /// 그리는 크기(있으면 등급·판형보다 먼저)
  final BookDims? dims;

  /// 표지 그림 주소(재장정 그림 또는 YES24 표지 L). 받기 전·못 받으면 코드로 그린 장정
  final String? coverArtUri;

  /// 사용자가 고른 갈피 색(없으면 표지에서 뽑은 색·책 색)
  final String? ribbonColor;

  /// 책등 제목 시작 높이(책등 조판 변형 spine_b 0.16·spine_c 0.11, 지금 앱 layoutArt). 없으면 제목 길이로 정한다
  final double? titleTop;

  /// 저장된 문장 수(갈피 표시)
  final int quotes;
  final String? startedAt;
  final String? finishedAt;
}

/// 책 하나의 자리(선반 안에서)
class BookPlacement {
  const BookPlacement({
    required this.bookId,
    required this.shelfId,
    required this.order,
    this.pose = Pose.upright,
    this.tilt = 0,
    this.stackId,
    this.stackOrder,
    this.pos,
    this.leanAngle,
    this.leanOn,
    this.leanSlide,
    this.depth,
    this.spin,
    this.pitch,
    this.stackDx,
    this.stackDz,
    this.flip = false,
    this.overhang = false,
    this.wallLean = false,
  });

  final String bookId;
  final String shelfId;
  final int order;
  final Pose pose;
  final int tilt;
  final String? stackId;
  final int? stackOrder;

  /// 선반 좌표(DU, 사용 범위 왼쪽 끝 = 0)에서의 자리 왼쪽 끝
  final double? pos;
  final double? leanAngle;
  final String? leanOn;
  final double? leanSlide;
  final double? depth;
  final double? spin;
  final double? pitch;
  final double? stackDx;
  final double? stackDz;
  final bool flip;
  final bool overhang;

  /// (예전 저장본) 표지 책이 벽에 기대 있는지. 지금은 pitch로 저장한다
  final bool wallLean;

  /// 값 바꾸기(지금 앱 { ...p, k: v }). 비울 수 있는 값은 [unset]을 넘기면 지운다(undefined)
  BookPlacement copyWith({
    String? shelfId,
    int? order,
    Pose? pose,
    int? tilt,
    Object? stackId = _keep,
    Object? stackOrder = _keep,
    Object? pos = _keep,
    Object? leanAngle = _keep,
    Object? leanOn = _keep,
    Object? leanSlide = _keep,
    Object? depth = _keep,
    Object? spin = _keep,
    Object? pitch = _keep,
    Object? stackDx = _keep,
    Object? stackDz = _keep,
    bool? flip,
    bool? overhang,
    bool? wallLean,
  }) {
    T? v<T>(Object? next, T? cur) => identical(next, _keep) ? cur : (identical(next, unset) ? null : next as T?);
    return BookPlacement(
      bookId: bookId,
      shelfId: shelfId ?? this.shelfId,
      order: order ?? this.order,
      pose: pose ?? this.pose,
      tilt: tilt ?? this.tilt,
      stackId: v<String>(stackId, this.stackId),
      stackOrder: v<int>(stackOrder, this.stackOrder),
      pos: v<double>(pos, this.pos),
      leanAngle: v<double>(leanAngle, this.leanAngle),
      leanOn: v<String>(leanOn, this.leanOn),
      leanSlide: v<double>(leanSlide, this.leanSlide),
      depth: v<double>(depth, this.depth),
      spin: v<double>(spin, this.spin),
      pitch: v<double>(pitch, this.pitch),
      stackDx: v<double>(stackDx, this.stackDx),
      stackDz: v<double>(stackDz, this.stackDz),
      flip: flip ?? this.flip,
      overhang: overhang ?? this.overhang,
      wallLean: wallLean ?? this.wallLean,
    );
  }

  /// 기대기 값 지우기(lean: undefined)
  BookPlacement withoutLean() => copyWith(leanAngle: unset, leanOn: unset, leanSlide: unset);
}

const Object _keep = _Keep();

/// copyWith에서 값을 지울 때(지금 앱 undefined)
const Object unset = _Unset();

class _Keep {
  const _Keep();
}

class _Unset {
  const _Unset();
}

/// 기울기 방향 → 저장 값(지금 앱 tiltToward)
int tiltToward(int dir) => dir * 7;

/// 선반 하나
class Shelf {
  const Shelf(this.id, this.position);
  final String id;
  final int position;
}
