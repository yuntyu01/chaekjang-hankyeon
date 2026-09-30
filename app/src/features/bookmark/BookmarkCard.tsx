// 갈피 카드(문학잡지형): 겹친 종이 위 아이보리 카드, 먹색 명조, 넉넉한 여백과 왼쪽으로 치우친 비대칭 조판.
// 문장을 먼저 크게 읽게 하고 표지·제목·저자·쪽수·날짜는 아래 보조 정보로. 개인 메모는 showMemo일 때만.
// 화면(갈피 상세)과 공유 이미지가 같은 부품을 쓴다(공유는 이 뷰를 그대로 이미지로 뜬다).
// 긴 문장은 글자를 줄여 넣지 않고 카드가 아래로 길어진다(단계별로 조금만 작아지고 그 뒤로는 크기 유지).
import { useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { mix } from '@/ui/book/BookBody';
import { colors, fonts } from '@/ui/theme';

export const CARD_PAPER = '#F8F4EC';
export const PAGE_BG = '#F2EDE3';

export type BookmarkCardData = {
  text: string;
  title: string;
  author?: string;
  page?: number;
  date: string; // YYYY.MM.DD
  memo?: string;
  color: string; // 책 색(장정 책등 색)
  coverUri?: string;
};

// 문장 길이에 따른 글자 크기(가장 작아도 19): 짧으면 크게, 길면 조금 작게. 그 이상은 줄이지 않고 카드가 길어진다
export function quoteType(text: string) {
  const n = text.replace(/\s+/g, '').length;
  if (n <= 36) return { size: 27, lh: 44 };
  if (n <= 80) return { size: 24, lh: 40 };
  if (n <= 160) return { size: 21, lh: 36 };
  return { size: 19, lh: 33 };
}

// 한국어 줄바꿈을 낱말 단위로: 안드로이드 글자 배치는 한글을 글자마다 끊어('투쟁한/다') 낱말 가운데서 줄이 바뀐다.
// (WORD JOINER U+2060을 끼워 봤지만 안드로이드 줄바꿈이 따르지 않았다.) 낱말마다 글자 조각으로 두고 줄 단위로 감싸면
// 띄어쓰기 자리에서만 줄이 바뀐다. 한 낱말이 한 줄보다 길면 그 낱말만 안에서 끊긴다(넘치지 않는다).
export function WordWrap({ text, style, maxLines }: { text: string; style: StyleProp<TextStyle>; maxLines?: number }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const lh = (flat.lineHeight as number | undefined) ?? ((flat.fontSize as number | undefined) ?? 16) * 1.5;
  const words = text.split(/ +/).filter(Boolean);
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap' }, maxLines ? { maxHeight: lh * maxLines, overflow: 'hidden' } : null]} accessible accessibilityLabel={text}>
      {words.map((w, i) => (
        <Text key={i} style={[style, { maxWidth: '100%' }]}>
          {i < words.length - 1 ? `${w} ` : w}
        </Text>
      ))}
    </View>
  );
}

// 찢긴 아래 가장자리(책 id로 정해지는 모양 — 다시 그려도 같다)
function tornPath(w: number, seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  let d = `M0 0 L${w} 0 L${w} 6`;
  for (let x = w; x > 0; x -= 7 + rnd() * 9) d += ` L${x.toFixed(1)} ${(4 + rnd() * 8).toFixed(1)}`;
  return `${d} L0 7 Z`;
}

export function BookmarkCard({ data, showMemo, width, seed }: { data: BookmarkCardData; showMemo: boolean; width: number; seed: string }) {
  const [coverOk, setCoverOk] = useState(true);
  const accent = mix(data.color, '#7F95AD', 0.35);
  const sheetA = mix(accent, PAGE_BG, 0.45);
  const sheetB = mix('#D9CFBE', PAGE_BG, 0.25);
  const qt = quoteType(data.text);
  const paras = data.text.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  const cardW = width - 36;
  const coverW = 64;
  const coverH = coverW / 0.68;
  return (
    <View style={{ width, paddingTop: 40, paddingBottom: 36, alignItems: 'center' }}>
      {/* 겹친 종이(뒤) */}
      <View style={[st.sheet, { width: cardW, backgroundColor: sheetB, transform: [{ translateX: 10 }, { rotate: '3deg' }], top: 34, bottom: 18 }]} />
      <View style={[st.sheet, { width: cardW, backgroundColor: sheetA, transform: [{ translateX: -12 }, { rotate: '-3.2deg' }], top: 22, bottom: 36 }]} />
      {/* 카드 */}
      <View style={[st.card, { width: cardW }]}>
        {/* 오른쪽 위 테이프 */}
        <View style={[st.tape, { backgroundColor: accent }]} />
        <View style={st.pageRow}>
          <View style={[st.bar, { backgroundColor: accent }]} />
          <Text style={st.pageTop}>{data.page ? `p. ${data.page}` : ' '}</Text>
        </View>
        <View style={{ marginTop: 26, paddingRight: 18 }}>
          {paras.map((p, i) => (
            <View key={i} style={{ marginTop: i ? qt.lh * 0.55 : 0 }}>
              <WordWrap text={p} style={[st.quote, { fontSize: qt.size, lineHeight: qt.lh }]} />
            </View>
          ))}
        </View>
        <View style={st.rule} />
        <View style={st.srcRow}>
          <View style={[st.cover, { width: coverW, height: coverH }]}>
            {data.coverUri && coverOk ? (
              <Image source={{ uri: data.coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setCoverOk(false)} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: data.color, padding: 6, justifyContent: 'flex-start' }]}>
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.35)', marginTop: 10, marginBottom: 6 }} />
                <Text style={{ fontFamily: fonts.serif, fontSize: 9.5, lineHeight: 13, color: '#F7F1E4' }} numberOfLines={4}>
                  {data.title}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <WordWrap text={data.author ? `${data.title}  ·  ${data.author}` : data.title} style={st.srcTitle} />
            {data.page ? <Text style={st.meta}>p. {data.page}</Text> : null}
            <Text style={st.meta}>{data.date}</Text>
          </View>
        </View>
        {showMemo && data.memo ? (
          <>
            <View style={st.rule} />
            <WordWrap text={data.memo} style={st.memo} />
          </>
        ) : null}
        {/* 찢긴 아래 가장자리 */}
        <Svg width={cardW} height={14} style={{ position: 'absolute', left: 0, bottom: -12 }}>
          <Path d={tornPath(cardW, seed)} fill={CARD_PAPER} />
        </Svg>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { position: 'absolute', borderRadius: 2 },
  card: { backgroundColor: CARD_PAPER, paddingLeft: 34, paddingRight: 26, paddingTop: 30, paddingBottom: 34, borderRadius: 2, elevation: 2, shadowColor: '#5C4A36', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  tape: { position: 'absolute', right: 14, top: -10, width: 46, height: 40, opacity: 0.8, transform: [{ rotate: '3deg' }] },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginLeft: -6 },
  bar: { width: 2.5, height: 24 },
  pageTop: { fontFamily: fonts.serif, fontSize: 14, color: '#8C877E' },
  quote: { fontFamily: fonts.serif, color: colors.ink, letterSpacing: -0.2 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: '#CFC7B9', marginVertical: 22 },
  srcRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  cover: { borderRadius: 2, overflow: 'hidden', backgroundColor: '#E8E0D2', elevation: 2, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 1, height: 2 } },
  srcTitle: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24, color: colors.ink },
  srcAuthor: { fontFamily: fonts.serif, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.serif, fontSize: 13.5, color: '#8C877E' },
  memo: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 26, color: colors.ink },
});
