package books

import (
	"context"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"time"
)

// DominantColor는 표지의 주조색을 고른다. 거의 흰색·검은색(여백, 글자)은 빼고
// 채널당 16단계로 묶은 색 중 가장 많은 묶음의 평균을 쓴다. 전부 빠지면 전체에서 고른다.
func DominantColor(img image.Image) string {
	type acc struct{ n, r, g, b int }
	pick := func(skipExtremes bool) (acc, bool) {
		buckets := map[int]*acc{}
		bounds := img.Bounds()
		step := max(1, bounds.Dx()/80)
		for y := bounds.Min.Y; y < bounds.Max.Y; y += step {
			for x := bounds.Min.X; x < bounds.Max.X; x += step {
				r16, g16, b16, a16 := img.At(x, y).RGBA()
				if a16 < 0x8000 {
					continue
				}
				r, g, b := int(r16>>8), int(g16>>8), int(b16>>8)
				if skipExtremes && ((r > 238 && g > 238 && b > 238) || (r < 22 && g < 22 && b < 22)) {
					continue
				}
				k := (r>>4)<<8 | (g>>4)<<4 | b>>4
				a := buckets[k]
				if a == nil {
					a = &acc{}
					buckets[k] = a
				}
				a.n++
				a.r += r
				a.g += g
				a.b += b
			}
		}
		var best acc
		for _, a := range buckets {
			if a.n > best.n {
				best = *a
			}
		}
		return best, best.n > 0
	}
	best, ok := pick(true)
	if !ok {
		best, ok = pick(false)
	}
	if !ok {
		return FallbackColor("")
	}
	return fmt.Sprintf("#%02X%02X%02X", best.r/best.n, best.g/best.n, best.b/best.n)
}

// 표지를 못 구했을 때 쓰는 차분한 기본색(ISBN으로 고정).
var fallbackPalette = []string{"#EFE6D3", "#2F5A45", "#B5503A", "#A8C3DA", "#223A63", "#F2C9A0", "#D98A7E", "#7D2E35"}

func FallbackColor(isbn13 string) string {
	var h uint32
	for _, ch := range isbn13 {
		h = h*31 + uint32(ch)
	}
	return fallbackPalette[h%uint32(len(fallbackPalette))]
}

// HTTPColorExtractor는 표지 이미지를 받아 주조색을 뽑는다(최대 5MB).
type HTTPColorExtractor struct{ Client *http.Client }

func (e HTTPColorExtractor) ThemeColor(ctx context.Context, url string) (string, error) {
	c := e.Client
	if c == nil {
		c = &http.Client{Timeout: 8 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := c.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("cover %s: %d", url, res.StatusCode)
	}
	img, _, err := image.Decode(io.LimitReader(res.Body, 5<<20))
	if err != nil {
		return "", err
	}
	return DominantColor(img), nil
}
