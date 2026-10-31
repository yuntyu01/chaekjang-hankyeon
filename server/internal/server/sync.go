package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type field struct {
	json, col, typ string
	required       bool
}
type kind struct {
	name, table string
	fields      []field
}

var common = []field{{"createdAt", "created_at", "time", false}, {"updatedAt", "updated_at", "time", true}}
var kinds = []kind{
	{"editions", "editions", []field{{"isbn13", "isbn13", "string", false}, {"title", "title", "string", true}, {"publisher", "publisher", "string", false}, {"publishedAt", "published_at", "string", false}, {"pageCount", "page_count", "number", false}, {"widthMm", "width_mm", "number", false}, {"heightMm", "height_mm", "number", false}, {"category", "category", "string", false}, {"seriesTitle", "series_title", "string", false}, {"coverUrl", "cover_url", "string", false}, {"coverFileId", "cover_file_id", "string", false}, {"coverSource", "cover_source", "string", false}, {"source", "source", "string", true}, {"sourceName", "source_name", "string", false}, {"productId", "product_id", "string", false}, {"link", "link", "string", false}, {"art.baseColor", "art_base_color", "string", false}, {"art.inkColor", "art_ink_color", "string", false}, {"art.accentColor", "art_accent_color", "string", false}, {"art.motifId", "art_motif_id", "string", false}, {"art.layoutVariant", "art_layout", "string", false}, {"art.version", "art_version", "number", false}, {"art.generatedAt", "art_generated_at", "time", false}}},
	{"books", "my_books", []field{{"editionId", "edition_id", "string", true}, {"status", "status", "string", true}, {"rating", "rating", "number", false}, {"note", "note", "string", false}, {"currentPage", "current_page", "number", false}, {"bindingId", "binding_id", "string", false}}},
	{"bindings", "bindings", []field{{"myBookId", "my_book_id", "string", true}, {"spineColor", "spine_color", "string", true}, {"inkColor", "ink_color", "string", false}, {"accentColor", "accent_color", "string", false}, {"motif", "motif", "string", true}, {"layout", "layout", "string", false}, {"material", "material", "string", false}, {"coverArtId", "cover_art_id", "string", false}, {"source", "source", "string", true}, {"status", "status", "string", true}, {"seed", "seed", "seed", false}, {"coverArtFileId", "cover_art_file_id", "string", false}, {"spineArtFileId", "spine_art_file_id", "string", false}}},
	{"rounds", "rounds", []field{{"myBookId", "my_book_id", "string", true}, {"index", "idx", "number", true}, {"startedAt", "started_on", "date", false}, {"finishedAt", "finished_on", "date", false}, {"paused", "paused", "bool", false}}},
	{"sessions", "sessions", []field{{"myBookId", "my_book_id", "string", false}, {"roundId", "round_id", "string", false}, {"startedAt", "started_at", "time", true}, {"endedAt", "ended_at", "time", true}, {"durationMs", "duration_ms", "number", true}, {"startPage", "start_page", "number", false}, {"pagesRead", "pages_read", "number", false}, {"memo", "memo", "string", false}}},
	{"bookmarks", "bookmarks", []field{{"myBookId", "my_book_id", "string", true}, {"text", "body", "text", false}, {"page", "page", "number", false}, {"memo", "memo", "string", false}, {"photoFileId", "photo_file_id", "string", false}, {"photoRatio", "photo_ratio", "number", false}, {"sessionId", "session_id", "string", false}, {"savedAt", "saved_at", "time", false}}},
}

func fields(k kind) []field { out := append([]field{}, k.fields...); return append(out, common...) }
func getValue(m map[string]any, key string) any {
	p := strings.Split(key, ".")
	if len(p) == 1 {
		return m[key]
	}
	a, _ := m[p[0]].(map[string]any)
	return a[p[1]]
}
func parseField(v any, f field) (any, error) {
	if v == nil {
		if f.required {
			return nil, bad
		}
		switch f.typ {
		case "seed":
			return 0, nil
		case "bool":
			return false, nil
		case "text":
			return "", nil
		}
		return nil, nil
	}
	switch f.typ {
	case "string", "text":
		s, ok := v.(string)
		if !ok {
			return nil, bad
		}
		if strings.TrimSpace(s) == "" && f.typ == "string" {
			if f.required {
				return nil, bad
			}
			return nil, nil
		}
		return s, nil
	case "time", "date":
		s, ok := v.(string)
		if !ok {
			return nil, bad
		}
		if s == "" && !f.required {
			return nil, nil
		}
		layout := time.RFC3339Nano
		if f.typ == "date" {
			layout = "2006-01-02"
		}
		t, e := time.Parse(layout, s)
		if e != nil {
			return nil, bad
		}
		return t, nil
	case "number", "seed":
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, bad
		}
		return n, nil
	case "bool":
		b, ok := v.(bool)
		if !ok {
			return nil, bad
		}
		return b, nil
	}
	return nil, bad
}
func (s *Server) push(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var body map[string]json.RawMessage
	if err = decode(r, &body); err != nil {
		return err
	}
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// 같은 사용자에 대한 모든 동기화 쓰기를 커밋까지 직렬화한다.
	// 시퀀스는 커밋 전에 발급되므로 이 잠금이 없으면 늦게 커밋한 낮은 rev를 놓칠 수 있다.
	var lockedUser int64
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", user).Scan(&lockedUser); err != nil {
		return err
	}
	applied := 0
	skipped := []string{}
	for _, k := range kinds {
		var items []map[string]any
		if raw := body[k.name]; len(raw) > 0 && string(raw) != "null" {
			if json.Unmarshal(raw, &items) != nil || len(items) > 1000 {
				return bad
			}
		}
		n, e := pushKind(ctx, tx, user, k, items, &skipped)
		if e != nil {
			return e
		}
		applied += n
	}
	if raw := body["layout"]; len(raw) > 0 && string(raw) != "null" {
		ok, e := pushLayout(ctx, tx, user, raw)
		if e != nil {
			return e
		}
		if ok {
			applied++
		} else {
			skipped = append(skipped, "layout")
		}
	}
	var rev int64
	e := tx.QueryRow(ctx, `SELECT COALESCE(MAX(r),0) FROM (SELECT MAX(rev) r FROM editions WHERE user_id=$1 UNION ALL SELECT MAX(rev) FROM my_books WHERE user_id=$1 UNION ALL SELECT MAX(rev) FROM bindings WHERE user_id=$1 UNION ALL SELECT MAX(rev) FROM rounds WHERE user_id=$1 UNION ALL SELECT MAX(rev) FROM sessions WHERE user_id=$1 UNION ALL SELECT MAX(rev) FROM bookmarks WHERE user_id=$1 UNION ALL SELECT MAX(rev) FROM shelf_layouts WHERE user_id=$1) t`, user).Scan(&rev)
	if e != nil {
		return e
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"rev": rev, "applied": applied, "skipped": skipped})
	return nil
}

// 종류마다 고정된 upsert 문(모든 열을 늘 보내므로 항목마다 같다)
var upsertSQL = func() map[string]string {
	out := map[string]string{}
	for _, k := range kinds {
		cols := []string{"user_id", "id"}
		params := []string{"$1", "$2"}
		updates := []string{}
		for _, f := range fields(k) {
			cols = append(cols, f.col)
			params = append(params, fmt.Sprintf("$%d", len(cols)))
			if f.col != "created_at" {
				updates = append(updates, f.col+"=EXCLUDED."+f.col)
			}
		}
		cols = append(cols, "rev", "deleted_at")
		params = append(params, "nextval('sync_rev_seq')", "NULL")
		updates = append(updates, "rev=EXCLUDED.rev", "deleted_at=NULL")
		out[k.name] = "INSERT INTO " + k.table + " (" + strings.Join(cols, ",") + ") VALUES (" + strings.Join(params, ",") + ") ON CONFLICT(user_id,id) DO UPDATE SET " + strings.Join(updates, ",") + " WHERE " + k.table + ".updated_at <= EXCLUDED.updated_at"
	}
	return out
}()

// 한 종류를 묶어서 쓴다: 값 검사를 먼저 다 하고, upsert·삭제 표시를 한 번의 batch로 보낸다(항목마다 왕복하지 않게).
// 반영된 판본은 저자 표를 그 판본만 지우고 다시 넣는다(두 번째 batch).
func pushKind(ctx context.Context, tx pgx.Tx, user int64, k kind, items []map[string]any, skipped *[]string) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	type pending struct {
		id      string
		deleted bool
		authors []string
	}
	list := make([]pending, 0, len(items))
	batch := &pgx.Batch{}
	for _, item := range items {
		id, ok := item["id"].(string)
		if !ok || strings.TrimSpace(id) == "" || len(id) > 80 {
			return 0, bad
		}
		at, err := parseField(item["updatedAt"], field{typ: "time", required: true})
		if err != nil {
			return 0, err
		}
		p := pending{id: id}
		p.deleted, _ = item["deleted"].(bool)
		if p.deleted {
			batch.Queue("UPDATE "+k.table+" SET deleted_at=$3, updated_at=$3, rev=nextval('sync_rev_seq') WHERE user_id=$1 AND id=$2 AND updated_at <= $3", user, id, at)
			list = append(list, p)
			continue
		}
		args := []any{user, id}
		for _, f := range fields(k) {
			v := getValue(item, f.json)
			if f.json == "createdAt" && v == nil {
				v = item["updatedAt"]
			}
			parsed, e := parseField(v, f)
			if e != nil {
				return 0, e
			}
			args = append(args, parsed)
		}
		if k.name == "editions" {
			if a, ok := item["authors"].([]any); ok {
				p.authors = make([]string, len(a))
				for i, v := range a {
					if p.authors[i], ok = v.(string); !ok {
						return 0, bad
					}
				}
			}
		}
		batch.Queue(upsertSQL[k.name], args...)
		list = append(list, p)
	}
	results := tx.SendBatch(ctx, batch)
	applied := 0
	authors := &pgx.Batch{}
	for _, p := range list {
		tag, err := results.Exec()
		if err != nil {
			results.Close()
			return 0, err
		}
		if tag.RowsAffected() == 0 {
			*skipped = append(*skipped, k.name+":"+p.id)
			continue
		}
		applied++
		if k.name == "editions" && !p.deleted {
			authors.Queue("DELETE FROM edition_authors WHERE user_id=$1 AND edition_id=$2", user, p.id)
			for i, name := range p.authors {
				if strings.TrimSpace(name) != "" {
					authors.Queue("INSERT INTO edition_authors(user_id,edition_id,position,name) VALUES($1,$2,$3,$4)", user, p.id, i, name)
				}
			}
		}
	}
	if err := results.Close(); err != nil {
		return 0, err
	}
	if authors.Len() > 0 {
		if err := tx.SendBatch(ctx, authors).Close(); err != nil {
			return 0, err
		}
	}
	return applied, nil
}

type syncRow struct {
	rev  int64
	data map[string]any
}

func (s *Server) pull(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	since := int64(0)
	if v := r.URL.Query().Get("since"); v != "" {
		since, err = strconv.ParseInt(v, 10, 64)
		if err != nil {
			return bad
		}
	}
	limit := 500
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, err = strconv.Atoi(v)
		if err != nil {
			return bad
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 1000 {
		limit = 1000
	}
	ctx := r.Context()
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	data := map[string][]syncRow{}
	cut := int64(math.MaxInt64)
	more := false
	for _, k := range kinds {
		rows, e := tx.Query(ctx, "SELECT rev,row_to_json(t) FROM "+k.table+" t WHERE user_id=$1 AND rev>$2 ORDER BY rev LIMIT $3", user, since, limit+1)
		if e != nil {
			return e
		}
		list := []syncRow{}
		for rows.Next() {
			var v syncRow
			var raw []byte
			if e = rows.Scan(&v.rev, &raw); e != nil {
				rows.Close()
				return e
			}
			if e = json.Unmarshal(raw, &v.data); e != nil {
				rows.Close()
				return e
			}
			list = append(list, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if len(list) > limit {
			more = true
			list = list[:limit]
			if list[len(list)-1].rev < cut {
				cut = list[len(list)-1].rev
			}
		}
		data[k.name] = list
	}
	max := since
	out := map[string]any{"more": more, "syncEpoch": 2}
	for _, k := range kinds {
		items := []map[string]any{}
		for _, v := range data[k.name] {
			if v.rev > cut {
				break
			}
			if v.rev > max {
				max = v.rev
			}
			row := v.data
			item := map[string]any{"id": row["id"], "updatedAt": row["updated_at"], "deleted": row["deleted_at"] != nil}
			if row["deleted_at"] == nil {
				for _, f := range fields(k) {
					if strings.HasPrefix(f.json, "art.") {
						if row["art_base_color"] != nil {
							a, _ := item["art"].(map[string]any)
							if a == nil {
								a = map[string]any{}
								item["art"] = a
							}
							a[strings.TrimPrefix(f.json, "art.")] = row[f.col]
						}
						continue
					}
					item[f.json] = row[f.col]
				}
				if k.name == "editions" {
					item["authors"] = []string{}
				}
			}
			items = append(items, item)
		}
		out[k.name] = items
	}
	// 판본마다 왕복하지 않고 현재 페이지의 저자만 한 번에 읽는다.
	editions := out["editions"].([]map[string]any)
	byID := make(map[string]map[string]any, len(editions))
	ids := make([]string, 0, len(editions))
	for _, item := range editions {
		if item["deleted"] == true {
			continue
		}
		id := item["id"].(string)
		ids = append(ids, id)
		byID[id] = item
	}
	if len(ids) > 0 {
		rows, e := tx.Query(ctx, "SELECT edition_id,name FROM edition_authors WHERE user_id=$1 AND edition_id=ANY($2::text[]) ORDER BY edition_id,position", user, ids)
		if e != nil {
			return e
		}
		for rows.Next() {
			var id, name string
			if e = rows.Scan(&id, &name); e != nil {
				rows.Close()
				return e
			}
			item := byID[id]
			item["authors"] = append(item["authors"].([]string), name)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
	}
	var version int
	var at time.Time
	var lr int64
	e := tx.QueryRow(ctx, "SELECT version,client_updated_at,rev FROM shelf_layouts WHERE user_id=$1 AND rev>$2 AND rev<=$3", user, since, cut).Scan(&version, &at, &lr)
	if e != nil && e != pgx.ErrNoRows {
		return e
	}
	out["layout"] = nil
	if e == nil {
		layout, e := readLayout(ctx, tx, user, version, at)
		if e != nil {
			return e
		}
		out["layout"] = layout
		if lr > max {
			max = lr
		}
	}
	out["rev"] = max
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 200, out)
	return nil
}
