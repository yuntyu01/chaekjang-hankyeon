package server

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"math"
	"strings"
	"time"
)

// 책장 배치 한 벌(선반 + 책 자리 + 서랍) ↔ 표(shelves, shelf_placements, V8).
// 앱은 표 모양(shelves·placements·drawer)과 같은 내용의 layoutJson을 함께 보낸다. 표 모양이 없으면(예전 앱) layoutJson을 풀어 쓰고,
// 받을 때도 예전 앱을 위해 layoutJson을 붙여 내려 준다.
// 같은 책이 두 번 나오면 먼저 나온 자리를 쓰고, 없는 선반이나 서버에 없는 책을 가리키는 자리는 버린다(앱 안의 어긋남으로 동기화가 멈추지 않게).

const maxLayoutRows = 5000

var poses = map[string]bool{"spine": true, "horizontal": true, "front": true}

type wireShelf struct {
	ID    string   `json:"id"`
	Order *float64 `json:"order"`
}
type wireLean struct {
	Angle *float64 `json:"angle"`
	On    *string  `json:"on"`
	Slide *float64 `json:"slide,omitempty"`
}

// 앱 BookPlacement와 같은 이름. 비어 있는 선택 값은 JSON에서 뺀다.
type wirePlacement struct {
	BookID     string    `json:"bookId"`
	ShelfID    *string   `json:"shelfId"`
	Order      *float64  `json:"order"`
	Pose       *string   `json:"pose"`
	Tilt       *float64  `json:"tilt"`
	StackID    *string   `json:"stackId,omitempty"`
	StackOrder *float64  `json:"stackOrder,omitempty"`
	Pos        *float64  `json:"pos,omitempty"`
	Lean       *wireLean `json:"lean,omitempty"`
	Depth      *float64  `json:"depth,omitempty"`
	Spin       *float64  `json:"spin,omitempty"`
	StackDx    *float64  `json:"stackDx,omitempty"`
	StackDz    *float64  `json:"stackDz,omitempty"`
	WallLean   *bool     `json:"wallLean,omitempty"`
	Flip       *bool     `json:"flip,omitempty"`
	Pitch      *float64  `json:"pitch,omitempty"`
	Overhang   *bool     `json:"overhang,omitempty"`
}

// 앱 ShelfLayout은 version을 첫 키로 갖는다(모양만 맞으면 순서는 상관없다)
type layoutBody struct {
	Version    int             `json:"version"`
	Shelves    []wireShelf     `json:"shelves"`
	Placements []wirePlacement `json:"placements"`
	Drawer     []string        `json:"drawer"`
}

func validLayoutID(id string) bool { return strings.TrimSpace(id) != "" && len(id) <= 80 }

func roundInt(v *float64) *int32 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return nil
	}
	n := int32(math.Round(*v))
	return &n
}

func finite(v *float64) *float64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return nil
	}
	return v
}

// 올리기: 앱 시각이 더 새로우면 그 사용자의 선반·책 자리를 통째로 바꾼다. 반영하지 않았으면 false.
func pushLayout(ctx context.Context, tx pgx.Tx, user int64, raw json.RawMessage) (bool, error) {
	var l struct {
		LayoutJSON *string           `json:"layoutJson"`
		Version    *int              `json:"version"`
		UpdatedAt  string            `json:"updatedAt"`
		Shelves    *[]*wireShelf     `json:"shelves"`
		Placements *[]*wirePlacement `json:"placements"`
		Drawer     *[]*string        `json:"drawer"`
	}
	if json.Unmarshal(raw, &l) != nil {
		return false, bad
	}
	at, e := time.Parse(time.RFC3339Nano, l.UpdatedAt)
	if e != nil {
		return false, bad
	}
	var shelves []*wireShelf
	var placements []*wirePlacement
	var drawer []*string
	if l.Shelves == nil && l.Placements == nil && l.Drawer == nil {
		if l.LayoutJSON == nil {
			return false, bad
		}
		var b struct {
			Shelves    []*wireShelf     `json:"shelves"`
			Placements []*wirePlacement `json:"placements"`
			Drawer     []*string        `json:"drawer"`
		}
		if json.Unmarshal([]byte(*l.LayoutJSON), &b) != nil {
			return false, bad
		}
		shelves, placements, drawer = b.Shelves, b.Placements, b.Drawer
	} else {
		if l.Shelves != nil {
			shelves = *l.Shelves
		}
		if l.Placements != nil {
			placements = *l.Placements
		}
		if l.Drawer != nil {
			drawer = *l.Drawer
		}
	}
	if len(shelves)+len(placements)+len(drawer) > maxLayoutRows {
		return false, bad
	}

	// 값 검사와 정리(쓰기 전에 다 한다)
	var shelfIDs []string
	var shelfPos []int32
	known := map[string]bool{}
	for i, x := range shelves {
		if x == nil || !validLayoutID(x.ID) {
			return false, bad
		}
		if known[x.ID] {
			continue
		}
		known[x.ID] = true
		pos := int32(i)
		if o := roundInt(x.Order); o != nil {
			pos = *o
		}
		shelfIDs = append(shelfIDs, x.ID)
		shelfPos = append(shelfPos, pos)
	}
	var rows struct {
		book, stackID, leanOn            []*string
		shelf, pose                      []*string
		position, tilt, stackOrder       []*int32
		pos, leanAngle, leanSlide, depth []*float64
		spin, pitch, stackDx, stackDz    []*float64
		wallLean, flip, overhang         []bool
	}
	type spot struct {
		book                       string
		shelf, pose, stackID       *string
		position, tilt, stackOrder *int32
		pos, leanAngle, leanSlide  *float64
		leanOn                     *string
		depth, spin, pitch, dx, dz *float64
		wall, flip, overhang       bool
	}
	add := func(x spot) {
		b := x.book
		rows.book = append(rows.book, &b)
		rows.shelf = append(rows.shelf, x.shelf)
		rows.position = append(rows.position, x.position)
		rows.pose = append(rows.pose, x.pose)
		rows.tilt = append(rows.tilt, x.tilt)
		rows.stackID = append(rows.stackID, x.stackID)
		rows.stackOrder = append(rows.stackOrder, x.stackOrder)
		rows.pos = append(rows.pos, x.pos)
		rows.leanAngle = append(rows.leanAngle, x.leanAngle)
		rows.leanOn = append(rows.leanOn, x.leanOn)
		rows.leanSlide = append(rows.leanSlide, x.leanSlide)
		rows.depth = append(rows.depth, x.depth)
		rows.spin = append(rows.spin, x.spin)
		rows.pitch = append(rows.pitch, x.pitch)
		rows.stackDx = append(rows.stackDx, x.dx)
		rows.stackDz = append(rows.stackDz, x.dz)
		rows.wallLean = append(rows.wallLean, x.wall)
		rows.flip = append(rows.flip, x.flip)
		rows.overhang = append(rows.overhang, x.overhang)
	}
	seen := map[string]bool{}
	for _, x := range placements {
		if x == nil || !validLayoutID(x.BookID) || x.Pose == nil || !poses[*x.Pose] {
			return false, bad
		}
		if x.ShelfID == nil || !known[*x.ShelfID] || seen[x.BookID] {
			continue
		}
		seen[x.BookID] = true
		position := int32(0)
		if o := roundInt(x.Order); o != nil {
			position = *o
		}
		tilt := int32(0)
		if t := roundInt(x.Tilt); t != nil && (*t == 7 || *t == -7) {
			tilt = *t
		}
		r := spot{book: x.BookID, shelf: x.ShelfID, pose: x.Pose, position: &position, tilt: &tilt, stackID: x.StackID, stackOrder: roundInt(x.StackOrder), pos: finite(x.Pos),
			depth: finite(x.Depth), spin: finite(x.Spin), pitch: finite(x.Pitch), dx: finite(x.StackDx), dz: finite(x.StackDz),
			wall: x.WallLean != nil && *x.WallLean, flip: x.Flip != nil && *x.Flip, overhang: x.Overhang != nil && *x.Overhang}
		if x.Lean != nil && finite(x.Lean.Angle) != nil && x.Lean.On != nil && validLayoutID(*x.Lean.On) {
			r.leanAngle, r.leanOn, r.leanSlide = x.Lean.Angle, x.Lean.On, finite(x.Lean.Slide)
		}
		add(r)
	}
	order := int32(0)
	for _, id := range drawer {
		if id == nil || !validLayoutID(*id) {
			return false, bad
		}
		if seen[*id] {
			continue
		}
		seen[*id] = true
		position := order
		order++
		add(spot{book: *id, position: &position})
	}

	version := 2
	if l.Version != nil {
		version = *l.Version
	}
	tag, e := tx.Exec(ctx, `INSERT INTO shelf_layouts(user_id,version,client_updated_at,updated_at,rev) VALUES($1,$2,$3,now(),nextval('sync_rev_seq')) ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,client_updated_at=EXCLUDED.client_updated_at,updated_at=now(),rev=EXCLUDED.rev WHERE shelf_layouts.client_updated_at <= EXCLUDED.client_updated_at`, user, version, at)
	if e != nil {
		return false, e
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	b := &pgx.Batch{}
	b.Queue("DELETE FROM shelf_placements WHERE user_id=$1", user)
	b.Queue("DELETE FROM shelves WHERE user_id=$1", user)
	b.Queue("INSERT INTO shelves(user_id,id,position) SELECT $1,s.id,s.position FROM unnest($2::text[],$3::int[]) AS s(id,position)", user, shelfIDs, shelfPos)
	// 서버에 아직 없는 책을 가리키는 자리는 버린다(외래키로 올리기 전체가 멈추지 않게. 앱이 책을 올린 뒤 다음 배치 올리기에서 다시 채운다)
	b.Queue(`INSERT INTO shelf_placements(user_id,book_id,shelf_id,position,pose,tilt,stack_id,stack_order,pos,lean_angle,lean_on,lean_slide,depth,spin,pitch,stack_dx,stack_dz,wall_lean,flip,overhang)
		SELECT $1,p.* FROM unnest($2::text[],$3::text[],$4::int[],$5::text[],$6::smallint[],$7::text[],$8::int[],$9::float8[],$10::float8[],$11::text[],$12::float8[],$13::float8[],$14::float8[],$15::float8[],$16::float8[],$17::float8[],$18::bool[],$19::bool[],$20::bool[])
			AS p(book_id,shelf_id,position,pose,tilt,stack_id,stack_order,pos,lean_angle,lean_on,lean_slide,depth,spin,pitch,stack_dx,stack_dz,wall_lean,flip,overhang)
		WHERE EXISTS (SELECT 1 FROM my_books m WHERE m.user_id=$1 AND m.id=p.book_id)`,
		user, rows.book, rows.shelf, rows.position, rows.pose, rows.tilt, rows.stackID, rows.stackOrder, rows.pos, rows.leanAngle, rows.leanOn, rows.leanSlide,
		rows.depth, rows.spin, rows.pitch, rows.stackDx, rows.stackDz, rows.wallLean, rows.flip, rows.overhang)
	if e = tx.SendBatch(ctx, b).Close(); e != nil {
		return false, e
	}
	return true, nil
}

// 받기: 선반 순서 → 선반 안 순서 → 쌓기 순서로 모은다(앱 normalize와 같은 순서). 서랍은 서랍 순서.
func readLayout(ctx context.Context, tx pgx.Tx, user int64, version int, at time.Time) (map[string]any, error) {
	body := layoutBody{Version: version, Shelves: []wireShelf{}, Placements: []wirePlacement{}, Drawer: []string{}}
	rows, e := tx.Query(ctx, "SELECT id,position FROM shelves WHERE user_id=$1 ORDER BY position,id", user)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var x wireShelf
		var pos int32
		if e = rows.Scan(&x.ID, &pos); e != nil {
			rows.Close()
			return nil, e
		}
		order := float64(pos)
		x.Order = &order
		body.Shelves = append(body.Shelves, x)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return nil, e
	}
	rows, e = tx.Query(ctx, `SELECT p.book_id,p.shelf_id,p.position,p.pose,p.tilt,p.stack_id,p.stack_order,p.pos,p.lean_angle,p.lean_on,p.lean_slide,p.depth,p.spin,p.pitch,p.stack_dx,p.stack_dz,p.wall_lean,p.flip,p.overhang
		FROM shelf_placements p LEFT JOIN shelves s ON s.user_id=p.user_id AND s.id=p.shelf_id
		WHERE p.user_id=$1 ORDER BY p.shelf_id IS NULL, s.position, p.shelf_id, p.position, p.stack_order NULLS FIRST, p.book_id`, user)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var x wirePlacement
		var position int32
		var tilt, stackOrder *int32
		var leanAngle, leanSlide *float64
		var leanOn *string
		var wall, flip, overhang bool
		if e = rows.Scan(&x.BookID, &x.ShelfID, &position, &x.Pose, &tilt, &x.StackID, &stackOrder, &x.Pos, &leanAngle, &leanOn, &leanSlide, &x.Depth, &x.Spin, &x.Pitch, &x.StackDx, &x.StackDz, &wall, &flip, &overhang); e != nil {
			rows.Close()
			return nil, e
		}
		if x.ShelfID == nil {
			body.Drawer = append(body.Drawer, x.BookID)
			continue
		}
		num := func(v *int32) *float64 {
			if v == nil {
				return nil
			}
			f := float64(*v)
			return &f
		}
		x.Order, x.Tilt, x.StackOrder = num(&position), num(tilt), num(stackOrder)
		if leanAngle != nil {
			x.Lean = &wireLean{Angle: leanAngle, On: leanOn, Slide: leanSlide}
		}
		if wall {
			x.WallLean = &wall
		}
		if flip {
			x.Flip = &flip
		}
		if overhang {
			x.Overhang = &overhang
		}
		body.Placements = append(body.Placements, x)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return nil, e
	}
	layoutJSON, e := json.Marshal(body)
	if e != nil {
		return nil, e
	}
	return map[string]any{
		"layoutJson": string(layoutJSON), "version": version, "updatedAt": at.UTC().Format(time.RFC3339Nano),
		"shelves": body.Shelves, "placements": body.Placements, "drawer": body.Drawer,
	}, nil
}
