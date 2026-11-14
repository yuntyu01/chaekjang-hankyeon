// 책장 배치 JSON(지금 앱 ShelfLayout v2 모양 그대로): 서버 동기화·백업·연도 책장 전송이 같이 쓴다.
// { version: 2, shelves: [{id, order}], placements: [{bookId, shelfId, order, pose, tilt, stackId?, stackOrder?, pos?, lean?: {angle, on, slide?}, depth?, spin?, pitch?, stackDx?, stackDz?, wallLean?, flip?, overhang?}], drawer: [] }
library;

import 'dart:convert';

import 'layout.dart' show ShelfLayout;
import 'types.dart';

String _poseName(Pose p) => switch (p) { Pose.front => 'front', Pose.horizontal => 'horizontal', Pose.upright => 'spine' };
Pose _poseOf(Object? v) => switch (v) { 'front' => Pose.front, 'horizontal' => Pose.horizontal, _ => Pose.upright };

Map<String, Object?> placementToJson(BookPlacement p) => {
      'bookId': p.bookId,
      'shelfId': p.shelfId,
      'order': p.order,
      'pose': _poseName(p.pose),
      'tilt': p.tilt,
      if (p.stackId != null) 'stackId': p.stackId,
      if (p.stackOrder != null) 'stackOrder': p.stackOrder,
      if (p.pos != null) 'pos': p.pos,
      if (p.leanAngle != null && p.leanOn != null) 'lean': {'angle': p.leanAngle, 'on': p.leanOn, if (p.leanSlide != null) 'slide': p.leanSlide},
      if (p.depth != null) 'depth': p.depth,
      if (p.spin != null) 'spin': p.spin,
      if (p.pitch != null) 'pitch': p.pitch,
      if (p.stackDx != null) 'stackDx': p.stackDx,
      if (p.stackDz != null) 'stackDz': p.stackDz,
      if (p.wallLean) 'wallLean': true,
      if (p.flip) 'flip': true,
      if (p.overhang) 'overhang': true,
    };

double? _d(Object? v) => v is num ? v.toDouble() : null;

BookPlacement? placementFromJson(Object? raw) {
  if (raw is! Map) return null;
  final m = raw.cast<String, Object?>();
  final bookId = m['bookId'], shelfId = m['shelfId'];
  if (bookId is! String || shelfId is! String) return null;
  final lean = m['lean'] is Map ? (m['lean']! as Map).cast<String, Object?>() : null;
  final on = lean?['on'];
  return BookPlacement(
    bookId: bookId,
    shelfId: shelfId,
    order: ((m['order'] as num?) ?? 0).toInt(),
    pose: _poseOf(m['pose']),
    tilt: ((m['tilt'] as num?) ?? 0).toInt(),
    stackId: m['stackId'] as String?,
    stackOrder: (m['stackOrder'] as num?)?.toInt(),
    pos: _d(m['pos']),
    leanAngle: on is String ? _d(lean!['angle']) : null,
    leanOn: on is String && _d(lean!['angle']) != null ? on : null,
    leanSlide: on is String ? _d(lean!['slide']) : null,
    depth: _d(m['depth']),
    spin: _d(m['spin']),
    pitch: _d(m['pitch']),
    stackDx: _d(m['stackDx']),
    stackDz: _d(m['stackDz']),
    wallLean: m['wallLean'] == true,
    flip: m['flip'] == true,
    overhang: m['overhang'] == true,
  );
}

Map<String, Object?> layoutToMap(ShelfLayout l) => {
      'version': 2,
      'shelves': [for (final s in l.shelves) {'id': s.id, 'order': s.position}],
      'placements': [for (final p in l.placements) placementToJson(p)],
      'drawer': l.drawer,
    };

String layoutToJson(ShelfLayout l) => jsonEncode(layoutToMap(l));

/// v2 배치 JSON → 배치(모르는 형식·깨진 JSON이면 null: 표 대신 그대로 둔다)
ShelfLayout? layoutFromJson(String json) {
  try {
    final m = jsonDecode(json);
    if (m is! Map || m['version'] != 2 || m['shelves'] is! List || m['placements'] is! List) return null;
    return layoutFromMap(m.cast<String, Object?>());
  } catch (_) {
    return null;
  }
}

ShelfLayout layoutFromMap(Map<String, Object?> m) => ShelfLayout(
      [
        for (final s in (m['shelves'] as List?) ?? const [])
          if (s is Map && s['id'] is String) Shelf(s['id'] as String, ((s['order'] as num?) ?? 0).toInt()),
      ],
      [for (final p in (m['placements'] as List?) ?? const []) ?placementFromJson(p)],
      [for (final d in (m['drawer'] as List?) ?? const []) if (d is String) d],
    );
