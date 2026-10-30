package com.chaekjang.server.sync;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import com.chaekjang.server.common.ApiException;
import com.chaekjang.server.sync.SyncDtos.Layout;
import com.chaekjang.server.sync.SyncDtos.Placement;
import com.chaekjang.server.sync.SyncDtos.Shelf;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * 배치 한 벌 ↔ 표 행(shelves, shelf_placements). 예전 앱이 보내는 layoutJson도 같은 모양으로 풀어 쓴다.
 * 같은 책이 두 번 나오면 먼저 나온 자리를 쓰고, 없는 선반을 가리키는 자리는 버린다(앱 안의 어긋남으로 동기화가 멈추지 않게).
 */
final class LayoutRows {

    // 예전 저장본의 모르는 키(version, x 등)는 건너뛴다
    private static final JsonMapper JSON = JsonMapper.builder().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
    private static final Set<String> POSES = Set.of("spine", "horizontal", "front");
    static final int MAX_ROWS = 5000;

    private record Body(List<Shelf> shelves, List<Placement> placements, List<String> drawer) {
    }

    private final List<Shelf> shelves;
    private final List<Placement> placements;
    private final List<String> drawer;

    private LayoutRows(List<Shelf> shelves, List<Placement> placements, List<String> drawer) {
        this.shelves = shelves;
        this.placements = placements;
        this.drawer = drawer;
    }

    static LayoutRows from(Layout l) {
        List<Shelf> s = l.shelves();
        List<Placement> p = l.placements();
        List<String> d = l.drawer();
        if (s == null && p == null && d == null) {
            if (l.layoutJson() == null) throw ApiException.BAD_REQUEST;
            try {
                Body b = JSON.readValue(l.layoutJson(), Body.class);
                s = b.shelves();
                p = b.placements();
                d = b.drawer();
            } catch (JacksonException e) {
                throw ApiException.BAD_REQUEST;
            }
        }
        s = s == null ? List.of() : s;
        p = p == null ? List.of() : p;
        d = d == null ? List.of() : d;
        if (s.size() + p.size() + d.size() > MAX_ROWS) throw ApiException.BAD_REQUEST;
        List<Shelf> shelves = new ArrayList<>();
        Set<String> shelfIds = new HashSet<>();
        for (int i = 0; i < s.size(); i++) {
            Shelf x = s.get(i);
            if (x == null || !validId(x.id())) throw ApiException.BAD_REQUEST;
            if (shelfIds.add(x.id())) shelves.add(new Shelf(x.id(), x.order() == null ? i : x.order()));
        }
        Set<String> seen = new HashSet<>();
        List<Placement> placements = new ArrayList<>();
        for (Placement x : p) {
            if (x == null || !validId(x.bookId())) throw ApiException.BAD_REQUEST;
            if (x.pose() == null || !POSES.contains(x.pose())) throw ApiException.BAD_REQUEST;
            if (!shelfIds.contains(x.shelfId()) || !seen.add(x.bookId())) continue;
            placements.add(x);
        }
        List<String> drawer = new ArrayList<>();
        for (String id : d) {
            if (!validId(id)) throw ApiException.BAD_REQUEST;
            if (seen.add(id)) drawer.add(id);
        }
        return new LayoutRows(shelves, placements, drawer);
    }

    private static boolean validId(String id) {
        return id != null && !id.isBlank() && id.length() <= 80;
    }

    List<Object[]> shelves(long user) {
        List<Object[]> out = new ArrayList<>();
        for (Shelf s : shelves) out.add(new Object[] {user, s.id(), s.order()});
        return out;
    }

    // 선반 자리와 서랍(shelf_id 비움)을 한 표에. 열 순서는 SyncService의 INSERT와 같다.
    List<Object[]> placements(long user) {
        List<Object[]> out = new ArrayList<>();
        for (Placement p : placements) {
            int tilt = p.tilt() != null && (p.tilt() == 7 || p.tilt() == -7) ? p.tilt() : 0;
            boolean lean = p.lean() != null && p.lean().angle() != null && validId(p.lean().on());
            out.add(new Object[] {user, p.bookId(), p.shelfId(), p.order() == null ? 0 : p.order(), p.pose(), tilt, p.stackId(), p.stackOrder(), p.pos(),
                    lean ? p.lean().angle() : null, lean ? p.lean().on() : null, p.depth(), p.spin(), p.pitch(), p.stackDx(), p.stackDz(),
                    Boolean.TRUE.equals(p.wallLean())});
        }
        for (int i = 0; i < drawer.size(); i++) {
            out.add(new Object[] {user, drawer.get(i), null, i, null, null, null, null, null, null, null, null, null, null, null, null, false});
        }
        return out;
    }

    /** 받는 쪽: 예전 앱을 위해 같은 내용의 layoutJson을 붙인다. */
    static Layout withJson(Layout l) {
        String json = JSON.writeValueAsString(new Body(l.shelves(), l.placements(), l.drawer()));
        // 앱의 ShelfLayout은 version을 첫 키로 갖는다(모양만 맞으면 순서는 상관없다)
        json = "{\"version\":" + (l.version() == null ? 2 : l.version()) + "," + json.substring(1);
        return new Layout(json, l.version(), l.updatedAt(), l.shelves(), l.placements(), l.drawer());
    }
}
