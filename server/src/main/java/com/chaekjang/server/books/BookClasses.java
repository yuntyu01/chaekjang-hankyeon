package com.chaekjang.server.books;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 앱 app/src/domain/catalog.ts 와 같은 규칙. */
public final class BookClasses {

    private BookClasses() {
    }

    public static String thicknessFromPages(int pages) {
        if (pages <= 0) return "medium";
        if (pages < 220) return "thin";
        if (pages < 420) return "medium";
        return "thick";
    }

    private static final Pattern SIZE = Pattern.compile("(\\d{2,3})\\s*[*xX×]\\s*(\\d{2,3})");
    private static final Pattern NAMED = Pattern.compile("\\b(A[4-6]|B[5-6])\\b");
    private static final Map<String, Integer> NAMED_MM = Map.of("A6", 148, "B6", 182, "A5", 210, "B5", 257, "A4", 297);

    public static String heightFromFormat(String format) {
        String f = format == null ? "" : format;
        int h = 0;
        Matcher m = SIZE.matcher(f);
        if (m.find()) {
            h = Math.max(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)));
        } else if ((m = NAMED.matcher(f.toUpperCase(Locale.ROOT))).find()) {
            h = NAMED_MM.get(m.group(1));
        }
        if (h == 0) return "medium";
        if (h < 195) return "short";
        if (h < 230) return "medium";
        return "tall";
    }

    /** app/src/domain/motif-slots.ts 와 같은 순서여야 한다(테스트로 확인). */
    public static final List<String> MOTIF_SLOTS = List.of(
            "leaf", "sprig", "cotton", "moon", "crescent", "star", "constellation", "wave", "ripple", "flower",
            "wildflower", "tulip", "camellia", "pine", "mountain", "cloud", "sun", "rain", "snow", "feather",
            "bird", "cat", "teacup", "candle", "key", "letter", "window", "lantern", "shell", "mushroom");

    // h*31 + 문자 해시. 앱과 같은 값이 나오도록 32비트 부호 없는 정수처럼 나눈다.
    private static int hash(String s) {
        int h = 0;
        for (int i = 0; i < s.length(); i++) h = h * 31 + s.charAt(i);
        return h;
    }

    public static String defaultMotifFor(String isbn13) {
        return MOTIF_SLOTS.get(Integer.remainderUnsigned(hash(isbn13), MOTIF_SLOTS.size()));
    }

    /** 표지를 못 구했을 때 쓰는 차분한 기본색(ISBN으로 고정). */
    private static final List<String> FALLBACK_PALETTE =
            List.of("#EFE6D3", "#2F5A45", "#B5503A", "#A8C3DA", "#223A63", "#F2C9A0", "#D98A7E", "#7D2E35");

    public static String fallbackColor(String isbn13) {
        return FALLBACK_PALETTE.get(Integer.remainderUnsigned(hash(isbn13), FALLBACK_PALETTE.size()));
    }
}
