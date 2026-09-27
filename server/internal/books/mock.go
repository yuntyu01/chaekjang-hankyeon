package books

import (
	"context"
	"strings"
)

// 키가 없을 때 쓰는 가짜 도서 목록(개발용). 실제 ISBN이 아니며 source는 "mock".
var mockBooks = []SearchItem{
	{ISBN13: "9790000000018", Title: "여름의 숲", Authors: []string{"가짜 작가"}, Publisher: "샘플 출판", PublishedAt: "2021-06-01"},
	{ISBN13: "9790000000025", Title: "여름의 숲", Authors: []string{"가짜 작가"}, Publisher: "샘플 출판 개정판", PublishedAt: "2025-03-15"},
	{ISBN13: "9790000000032", Title: "달과 나", Authors: []string{"시험 저자"}, Publisher: "개발 문고", PublishedAt: "2019-11-20"},
	{ISBN13: "9790000000049", Title: "고요한 우연", Authors: []string{"시험 저자"}, Publisher: "개발 문고", PublishedAt: "2023-02-08"},
	{ISBN13: "9790000000056", Title: "작은 것들의 깊이", Authors: []string{"목업 작가", "공동 저자"}, Publisher: "샘플 출판", PublishedAt: "2024-09-01"},
}

var mockPages = map[string]int{"9790000000018": 180, "9790000000025": 196, "9790000000032": 312, "9790000000049": 460, "9790000000056": 240}

type MockSearcher struct{}

func (MockSearcher) Search(_ context.Context, q string) ([]SearchItem, error) {
	var out []SearchItem
	for _, b := range mockBooks {
		if strings.Contains(b.Title, q) || strings.Contains(strings.Join(b.Authors, " "), q) {
			out = append(out, b)
		}
	}
	return out, nil
}

func (MockSearcher) LookupISBN(_ context.Context, isbn13 string) (*SearchItem, error) {
	for _, b := range mockBooks {
		if b.ISBN13 == isbn13 {
			b := b
			return &b, nil
		}
	}
	return nil, nil
}

type MockDetailer struct{}

func (MockDetailer) Detail(_ context.Context, isbn13 string) (*Detail, error) {
	if p, ok := mockPages[isbn13]; ok {
		return &Detail{PageCount: p}, nil
	}
	return nil, nil
}
