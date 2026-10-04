package com.chaekjang.server.books;

import static org.assertj.core.api.Assertions.assertThat;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

class BookClassesTest {

    @Test
    void thickness() {
        Map<Integer, String> cases = Map.of(0, "medium", 120, "thin", 219, "thin", 220, "medium", 419, "medium", 600, "thick");
        cases.forEach((pages, want) -> assertThat(BookClasses.thicknessFromPages(pages)).as("%d", pages).isEqualTo(want));
    }

    @Test
    void height() {
        Map<String, String> formats = Map.of("128*188mm", "short", "152x225mm", "medium", "188×257", "tall",
                "A5", "medium", "B6", "short", "", "medium");
        formats.forEach((f, want) -> assertThat(BookClasses.heightFromFormat(f)).as(f).isEqualTo(want));
    }

    @Test
    void defaultMotifMatchesApp() {
        // app/src/domain/__tests__/catalog.test.ts 와 같은 기대값
        assertThat(BookClasses.defaultMotifFor("9788937460449")).isEqualTo("constellation");
        assertThat(BookClasses.defaultMotifFor("9791190090018")).isEqualTo("window");
    }

    // 앱 motif-slots.ts와 순서·해시가 같아야 같은 책이 같은 모티프를 받는다.
    @Test
    void motifSlotsMatchApp() throws IOException {
        Path src = Path.of("../app/src/domain/motif-slots.ts");
        Assumptions.assumeTrue(Files.exists(src), "app source not found");
        List<String> ids = new ArrayList<>();
        var m = Pattern.compile("\\{ id: '(\\w+)'").matcher(Files.readString(src));
        while (m.find()) ids.add(m.group(1));
        assertThat(ids).containsExactlyElementsOf(BookClasses.MOTIF_SLOTS);
    }

    @Test
    void dominantColorSkipsMarginsAndText() {
        BufferedImage img = new BufferedImage(100, 140, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < 140; y++) {
            for (int x = 0; x < 100; x++) {
                int c = 0xFFFAFAFA; // 흰 여백
                if (y > 30 && y < 110 && x > 10 && x < 90) c = 0xFF2F5A45;
                if (y > 50 && y < 60) c = 0xFF0A0A0A; // 검은 글자
                img.setRGB(x, y, c);
            }
        }
        assertThat(HttpColorExtractor.dominantColor(img)).isEqualTo("#2F5A45");
    }
}
