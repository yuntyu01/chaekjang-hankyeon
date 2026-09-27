package books

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Kakao는 카카오(다음) 책 검색 API 클라이언트.
type Kakao struct {
	Key     string
	BaseURL string // 기본 https://dapi.kakao.com
	Client  *http.Client
}

type kakaoDoc struct {
	Title     string   `json:"title"`
	Contents  string   `json:"contents"`
	ISBN      string   `json:"isbn"` // "ISBN10 ISBN13" 공백 구분
	Datetime  string   `json:"datetime"`
	Authors   []string `json:"authors"`
	Publisher string   `json:"publisher"`
	Thumbnail string   `json:"thumbnail"`
}

func (k *Kakao) call(ctx context.Context, q url.Values) ([]kakaoDoc, error) {
	base := k.BaseURL
	if base == "" {
		base = "https://dapi.kakao.com"
	}
	c := k.Client
	if c == nil {
		c = &http.Client{Timeout: 6 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v3/search/book?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "KakaoAK "+k.Key)
	res, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kakao search: status %d", res.StatusCode)
	}
	var body struct {
		Documents []kakaoDoc `json:"documents"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Documents, nil
}

func isbn13Of(s string) string {
	for _, part := range strings.Fields(s) {
		if len(part) == 13 {
			return part
		}
	}
	return ""
}

func (d kakaoDoc) item() SearchItem {
	date := d.Datetime
	if len(date) >= 10 {
		date = date[:10]
	}
	return SearchItem{
		ISBN13:       isbn13Of(d.ISBN),
		Title:        d.Title,
		Authors:      d.Authors,
		Publisher:    d.Publisher,
		PublishedAt:  date,
		ThumbnailURL: d.Thumbnail,
		Description:  d.Contents,
	}
}

func (k *Kakao) Search(ctx context.Context, query string) ([]SearchItem, error) {
	docs, err := k.call(ctx, url.Values{"query": {query}, "size": {"30"}})
	if err != nil {
		return nil, err
	}
	out := make([]SearchItem, 0, len(docs))
	for _, d := range docs {
		if it := d.item(); it.ISBN13 != "" {
			out = append(out, it)
		}
	}
	return out, nil
}

func (k *Kakao) LookupISBN(ctx context.Context, isbn13 string) (*SearchItem, error) {
	docs, err := k.call(ctx, url.Values{"query": {isbn13}, "target": {"isbn"}})
	if err != nil {
		return nil, err
	}
	for _, d := range docs {
		if it := d.item(); it.ISBN13 == isbn13 {
			return &it, nil
		}
	}
	return nil, nil
}
