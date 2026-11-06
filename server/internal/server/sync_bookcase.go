package server

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"time"
)

// 연도 책장(V17) 올리기·받기. 해가 바뀔 때 앱이 그해 책장을 한 벌 만들어 올린다.
// 한 사용자에 한 해 한 벌이고 처음 올린 것이 남는다(보기 전용이라 고치지 않는다. 같은 해를 다시 올리면 skipped).
// 형식: {id, year, createdAt, updatedAt, shelves, placements, drawer, books:[{bookId, bindingId, status, rating, note, ribbonColor, currentPage}]}
// 선반·책 자리는 지금 책장과 같은 형식과 같은 검사(parseLayoutRows)를 쓴다. 책 목록에 없는 책의 자리는 버린다.
// 책과 장정은 서버에 있어야 한다(외래키). 없으면 missing_reference로 앱이 서재 전체를 다시 올린 뒤 다시 보낸다.

const maxBookcases = 50

type wireBookcaseBook struct {
	BookID      string   `json:"bookId"`
	BindingID   *string  `json:"bindingId,omitempty"`
	Status      string   `json:"status"`
	Rating      *float64 `json:"rating,omitempty"`
	Note        *string  `json:"note,omitempty"`
	RibbonColor *string  `json:"ribbonColor,omitempty"`
	CurrentPage *float64 `json:"currentPage,omitempty"`
}

type wireBookcase struct {
	ID         string              `json:"id"`
	Year       int                 `json:"year"`
	CreatedAt  string              `json:"createdAt"`
	UpdatedAt  string              `json:"updatedAt"`
	Shelves    []*wireShelf        `json:"shelves"`
	Placements []*wirePlacement    `json:"placements"`
	Drawer     []*string           `json:"drawer"`
	Books      []*wireBookcaseBook `json:"books"`
}

var bookStatuses = map[string]bool{"want": true, "reading": true, "read": true, "paused": true}

func emptyToNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func pushBookcases(ctx context.Context, tx pgx.Tx, user int64, raw json.RawMessage, skipped *[]string) (int, error) {
	var list []*wireBookcase
	if json.Unmarshal(raw, &list) != nil || len(list) > maxBookcases {
		return 0, bad
	}
	applied := 0
	for _, c := range list {
		if c == nil || !validLayoutID(c.ID) || c.Year < 2000 || c.Year > 9999 {
			return 0, bad
		}
		created, e := time.Parse(time.RFC3339Nano, c.CreatedAt)
		if e != nil {
			return 0, bad
		}
		updated, e := time.Parse(time.RFC3339Nano, c.UpdatedAt)
		if e != nil {
			return 0, bad
		}
		if len(c.Shelves)+len(c.Placements)+len(c.Drawer)+len(c.Books) > maxLayoutRows {
			return 0, bad
		}
		var books struct {
			id, status            []string
			binding, note, ribbon []*string
			rating, page          []*int32
		}
		known := map[string]bool{}
		for _, b := range c.Books {
			if b == nil || !validLayoutID(b.BookID) || !bookStatuses[b.Status] {
				return 0, bad
			}
			if b.BindingID != nil && *b.BindingID != "" && !validLayoutID(*b.BindingID) {
				return 0, bad
			}
			if known[b.BookID] {
				continue
			}
			known[b.BookID] = true
			rating := roundInt(b.Rating)
			if rating != nil && (*rating < 1 || *rating > 5) {
				rating = nil
			}
			page := roundInt(b.CurrentPage)
			if page != nil && *page < 0 {
				page = nil
			}
			books.id = append(books.id, b.BookID)
			books.status = append(books.status, b.Status)
			books.binding = append(books.binding, emptyToNil(b.BindingID))
			books.note = append(books.note, emptyToNil(b.Note))
			books.ribbon = append(books.ribbon, emptyToNil(b.RibbonColor))
			books.rating = append(books.rating, rating)
			books.page = append(books.page, page)
		}
		// 자리는 책 목록에 있는 책만(형식 검사는 parseLayoutRows가 전부 한다)
		placements := make([]*wirePlacement, 0, len(c.Placements))
		for _, p := range c.Placements {
			if p != nil && !known[p.BookID] {
				continue
			}
			placements = append(placements, p)
		}
		drawer := make([]*string, 0, len(c.Drawer))
		for _, id := range c.Drawer {
			if id != nil && !known[*id] {
				continue
			}
			drawer = append(drawer, id)
		}
		rows, e := parseLayoutRows(c.Shelves, placements, drawer)
		if e != nil {
			return 0, e
		}
		tag, e := tx.Exec(ctx, "INSERT INTO bookcases(user_id,id,year,created_at,updated_at,rev) VALUES($1,$2,$3,$4,$5,nextval('sync_rev_seq')) ON CONFLICT DO NOTHING", user, c.ID, c.Year, created, updated)
		if e != nil {
			return 0, e
		}
		if tag.RowsAffected() == 0 {
			*skipped = append(*skipped, "bookcases:"+c.ID)
			continue
		}
		b := &pgx.Batch{}
		b.Queue("INSERT INTO bookcase_shelves(user_id,bookcase_id,id,position) SELECT $1,$2,s.id,s.position FROM unnest($3::text[],$4::int[]) AS s(id,position)", user, c.ID, rows.shelfIDs, rows.shelfPos)
		b.Queue(`INSERT INTO bookcase_books(user_id,bookcase_id,book_id,binding_id,status,rating,note,ribbon_color,current_page)
			SELECT $1,$2,b.* FROM unnest($3::text[],$4::text[],$5::text[],$6::int[],$7::text[],$8::text[],$9::int[]) AS b(book_id,binding_id,status,rating,note,ribbon_color,current_page)`,
			user, c.ID, books.id, books.binding, books.status, books.rating, books.note, books.ribbon, books.page)
		b.Queue(`INSERT INTO bookcase_placements(user_id,bookcase_id,book_id,`+placementCols+`)
			SELECT $1,$21,p.* FROM `+placementUnnest, append(append([]any{user}, rows.args()...), c.ID)...)
		if e = tx.SendBatch(ctx, b).Close(); e != nil {
			return 0, e
		}
		applied++
	}
	return applied, nil
}

// 받기: rev가 (since, cut]인 연도 책장을 통째로. 가장 큰 rev도 돌려준다
func readBookcases(ctx context.Context, tx pgx.Tx, user, since, cut int64) ([]map[string]any, int64, error) {
	type head struct {
		id               string
		year             int32
		created, updated time.Time
		rev              int64
	}
	rows, e := tx.Query(ctx, "SELECT id,year,created_at,updated_at,rev FROM bookcases WHERE user_id=$1 AND rev>$2 AND rev<=$3 ORDER BY rev", user, since, cut)
	if e != nil {
		return nil, 0, e
	}
	var heads []head
	for rows.Next() {
		var h head
		if e = rows.Scan(&h.id, &h.year, &h.created, &h.updated, &h.rev); e != nil {
			rows.Close()
			return nil, 0, e
		}
		heads = append(heads, h)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return nil, 0, e
	}
	out := []map[string]any{}
	max := int64(0)
	for _, h := range heads {
		id := h.id
		body, e := readLayoutBody(ctx, tx, user, &id)
		if e != nil {
			return nil, 0, e
		}
		books := []wireBookcaseBook{}
		r, e := tx.Query(ctx, "SELECT book_id,binding_id,status,rating,note,ribbon_color,current_page FROM bookcase_books WHERE user_id=$1 AND bookcase_id=$2 ORDER BY book_id", user, id)
		if e != nil {
			return nil, 0, e
		}
		for r.Next() {
			var b wireBookcaseBook
			var rating, page *int32
			if e = r.Scan(&b.BookID, &b.BindingID, &b.Status, &rating, &b.Note, &b.RibbonColor, &page); e != nil {
				r.Close()
				return nil, 0, e
			}
			if rating != nil {
				v := float64(*rating)
				b.Rating = &v
			}
			if page != nil {
				v := float64(*page)
				b.CurrentPage = &v
			}
			books = append(books, b)
		}
		r.Close()
		if e = r.Err(); e != nil {
			return nil, 0, e
		}
		out = append(out, map[string]any{
			"id": id, "year": h.year, "createdAt": h.created.UTC().Format(time.RFC3339Nano), "updatedAt": h.updated.UTC().Format(time.RFC3339Nano),
			"shelves": body.Shelves, "placements": body.Placements, "drawer": body.Drawer, "books": books,
		})
		if h.rev > max {
			max = h.rev
		}
	}
	return out, max, nil
}
