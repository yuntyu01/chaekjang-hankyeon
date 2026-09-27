package books

import (
	"regexp"
	"strconv"
	"strings"
)

// 앱 app/src/domain/catalog.ts 와 같은 규칙.

func ThicknessFromPages(pages int) string {
	switch {
	case pages <= 0:
		return "medium"
	case pages < 220:
		return "thin"
	case pages < 420:
		return "medium"
	default:
		return "thick"
	}
}

var (
	sizeRe  = regexp.MustCompile(`(\d{2,3})\s*[*xX×]\s*(\d{2,3})`)
	namedRe = regexp.MustCompile(`\b(A[4-6]|B[5-6])\b`)
	named   = map[string]int{"A6": 148, "B6": 182, "A5": 210, "B5": 257, "A4": 297}
)

func HeightFromFormat(format string) string {
	h := 0
	if m := sizeRe.FindStringSubmatch(format); m != nil {
		a, _ := strconv.Atoi(m[1])
		b, _ := strconv.Atoi(m[2])
		h = max(a, b)
	} else if m := namedRe.FindStringSubmatch(strings.ToUpper(format)); m != nil {
		h = named[m[1]]
	}
	switch {
	case h == 0:
		return "medium"
	case h < 195:
		return "short"
	case h < 230:
		return "medium"
	default:
		return "tall"
	}
}

// MotifSlots는 app/src/domain/motif-slots.ts 와 같은 순서여야 한다(테스트로 확인).
var MotifSlots = []string{
	"leaf", "sprig", "cotton", "moon", "crescent", "star", "constellation", "wave", "ripple", "flower",
	"wildflower", "tulip", "camellia", "pine", "mountain", "cloud", "sun", "rain", "snow", "feather",
	"bird", "cat", "teacup", "candle", "key", "letter", "window", "lantern", "shell", "mushroom",
}

func DefaultMotifFor(isbn13 string) string {
	var h uint32
	for _, ch := range isbn13 {
		h = h*31 + uint32(ch)
	}
	return MotifSlots[h%uint32(len(MotifSlots))]
}
