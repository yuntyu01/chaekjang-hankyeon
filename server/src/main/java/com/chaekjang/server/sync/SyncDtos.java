package com.chaekjang.server.sync;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;

/**
 * 앱 ↔ 서버 동기화 형식. 앱의 서재 모델(Edition/MyBook/Binding/Round/Session/Bookmark)과 같은 모양이다.
 * 시각은 ISO-8601 문자열, 날짜(회차)는 YYYY-MM-DD. deleted=true면 삭제 표시(나머지 값은 무시).
 */
public final class SyncDtos {

    private SyncDtos() {
    }

    public record Art(String baseColor, String inkColor, String accentColor, String motifId, String layoutVariant, Integer version, String generatedAt) {
    }

    public record Edition(String id, String isbn13, String title, List<String> authors, String publisher, String publishedAt, Integer pageCount,
            Integer widthMm, Integer heightMm, String category, String seriesTitle, String coverUrl, String coverFileId, String coverSource,
            String source, String sourceName, Art art, String createdAt, String updatedAt, Boolean deleted) {
    }

    public record MyBook(String id, String editionId, String status, Integer rating, String note, Integer currentPage, String bindingId,
            String createdAt, String updatedAt, Boolean deleted) {
    }

    /** material: 장정 재질(paper/cloth/coated). 비우면 무광 종이. coverArtId: 기본 정면 장정 그림 id(앱 cover-artworks). 비우면 단색 정면. */
    public record Binding(String id, String myBookId, String spineColor, String inkColor, String accentColor, String motif, String layout,
            String material, String coverArtId, String source, String status, Integer seed, String coverArtFileId, String spineArtFileId, String createdAt,
            String updatedAt, Boolean deleted) {
    }

    public record Round(String id, String myBookId, Integer index, String startedAt, String finishedAt, Boolean paused, String createdAt,
            String updatedAt, Boolean deleted) {
    }

    public record Session(String id, String myBookId, String roundId, String startedAt, String endedAt, Long durationMs, Integer pagesRead,
            String memo, String createdAt, String updatedAt, Boolean deleted) {
    }

    public record Bookmark(String id, String myBookId, String text, Integer page, String memo, String photoFileId, Double photoRatio,
            String createdAt, String updatedAt, Boolean deleted) {
    }

    /**
     * 책장 배치 한 벌(선반 + 책 자리 + 서랍). 서버는 표(shelves·shelf_placements)로 나눠 저장한다.
     * layoutJson: 예전 앱이 보내던 같은 내용의 JSON 문자열. 올릴 때 shelves가 없으면 이것을 풀어 쓰고, 받을 때도 함께 내려 준다.
     */
    public record Layout(String layoutJson, Integer version, String updatedAt, List<Shelf> shelves, List<Placement> placements, List<String> drawer) {
    }

    public record Shelf(String id, Integer order) {
    }

    public record Lean(Double angle, String on) {
    }

    /** 앱 BookPlacement와 같은 이름(선반에 놓인 책 하나). 비어 있는 선택 값은 JSON에서 뺀다. */
    @JsonInclude(Include.NON_NULL)
    public record Placement(String bookId, String shelfId, Integer order, String pose, Integer tilt, String stackId, Integer stackOrder, Double pos, Lean lean,
            Double depth, Double spin, Double stackDx, Double stackDz, Boolean wallLean, Double pitch) {
    }

    /** 올리기: 종류별 변경분. 빠진 종류는 비어 있는 것으로 본다. */
    public record Push(List<Edition> editions, List<MyBook> books, List<Binding> bindings, List<Round> rounds, List<Session> sessions,
            List<Bookmark> bookmarks, Layout layout) {
    }

    /** skipped: 서버에 더 새로운 값이 있어 반영하지 않은 항목(다음 받기에서 서버 값이 내려간다). */
    public record PushResult(long rev, int applied, List<String> skipped) {
    }

    /** 받기: rev 이후 바뀐 것. more=true면 같은 방식으로 한 번 더 받는다(rev를 다음 since로). */
    public record Pull(long rev, boolean more, List<Edition> editions, List<MyBook> books, List<Binding> bindings, List<Round> rounds,
            List<Session> sessions, List<Bookmark> bookmarks, Layout layout) {
    }
}
