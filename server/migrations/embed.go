// Package migrations는 SQL 파일을 바이너리에 넣는다.
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS
