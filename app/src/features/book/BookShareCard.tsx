// 책 공유 카드(2026-11-09 사용자 시안): 벽에 움푹 파인 칸 안 선반에 책 한 권 + 아래 읽기 상태·제목·저자·한 줄 감상·별점·독서 시간·읽은 기간 + '책장 한켠'.
// 책은 책장과 같은 3D 책(BookNode)이고, 갈피 탭은 늘 꽂는다(색은 책장 갈피와 같은 규칙으로 표지에서 뽑는다, art tabsOf). 읽기 상태 글자도 그 갈피 색.
// 크기는 폭 360 기준 값(시안에서 잰 자리)에 k = width/360을 곱한다(미리보기·내보내기 같은 모양). 높이는 최소 9:16이고 감상이 길면 늘어난다.
// 공유 이미지는 화면을 그대로 뜨므로(makeImageFromView) 3D 캔버스는 그림으로 굳혀 둔다(BookVisual rasterize와 같은 방식). onReady = 책 그림까지 준비됨
import { Canvas, useCanvasRef } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';

import { rot, toWorld, fromPlaced, type Book3 } from '@/domain/book3';
import { shade } from '@/domain/color';
import { coverAtSize } from '@/domain/cover-url';
import { ribbonDesign } from '@/domain/ribbon-design';
import { outlineOf, standaloneFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { SKIN } from '@/scene-config/skin';
import { tabsOf, useBookArt, useBookShared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import { BOOK_PAD, frameCam } from '@/ui/book3d/StandaloneBook';
import { Star } from '@/ui/icons';
import { keepAll } from '@/ui/keep-all';
import { colors, fonts } from '@/ui/theme';
import { ALL_PARTS, type BookShareData, type ShareParts } from './book-share';

// 한 줄 감상 글자 크기: 짧으면 시안 크기, 길면 줄인다
function noteSize(text: string) {
  const n = text.replace(/\s+/g, '').length;
  if (n <= 24) return { size: 20, lh: 30 };
  if (n <= 60) return { size: 18, lh: 28 };
  return { size: 16, lh: 25 };
}

// 시안(941px)에서 잰 벽·칸·선반 색. 칸 안은 창빛이 덜 닿아 바깥 벽보다 어둡고, 왼쪽 앞에서 오는 빛이라 오른쪽 안쪽 면이 밝다
const NICHE = { top: 50, side: 20, depth: 14, ledgeTop: 321, ledgeH: 23 };

export function BookShareCard({ data, parts = ALL_PARTS, width, onReady }: { data: BookShareData; parts?: ShareParts; width: number; onReady?: () => void }) {
  const k = width / 360;
  const u = (v: number) => v * k;
  const shelf = useMemo(() => shelfColors(), []);
  const ribbon = useMemo(() => withRibbon(data.book), [data.book]);
  const ink = useMemo(() => shade(tabsOf(ribbon)[0]?.color ?? colors.star, -0.24), [ribbon]);
  const note = parts.note ? data.note : undefined;
  const nt = note ? noteSize(note) : null;
  const meta = [
    parts.rating && data.rating ? { key: 'rating', text: String(data.rating), star: true } : null,
    parts.time && data.readTime ? { key: 'time', text: data.readTime } : null,
    parts.period && data.period ? { key: 'period', text: data.period } : null,
  ].filter((m): m is { key: string; text: string; star?: boolean } => !!m);
  const nicheW = width - u(NICHE.side) * 2;
  const nicheH = u(NICHE.ledgeTop - NICHE.top);
  return (
    <View style={{ width, minHeight: (width * 16) / 9, backgroundColor: shelf.wall }} accessible accessibilityLabel={`${data.title} 공유 카드`}>
      {/* 움푹 파인 칸: 뒷벽 + 천장·양옆 안쪽 면 + 천장 아래 그늘 */}
      <View style={{ position: 'absolute', left: u(NICHE.side), top: u(NICHE.top), width: nicheW, height: nicheH }}>
        <Svg width={nicheW} height={nicheH}>
          <Defs>
            <LinearGradient id="back" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={shelf.backTop} />
              <Stop offset="0.75" stopColor={shelf.back} />
              <Stop offset="1" stopColor={shelf.backLow} />
            </LinearGradient>
            <LinearGradient id="ceilShade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={shelf.shadow} stopOpacity="0.2" />
              <Stop offset="0.4" stopColor={shelf.shadow} stopOpacity="0.07" />
              <Stop offset="1" stopColor={shelf.shadow} stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id="ceil" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={shelf.ceilFront} />
              <Stop offset="1" stopColor={shelf.ceilBack} />
            </LinearGradient>
            <LinearGradient id="left" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={shelf.leftFront} />
              <Stop offset="1" stopColor={shelf.leftBack} />
            </LinearGradient>
            <LinearGradient id="right" x1="1" y1="0" x2="0" y2="0">
              <Stop offset="0" stopColor={shelf.rightFront} />
              <Stop offset="1" stopColor={shelf.rightBack} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={nicheW} height={nicheH} fill="url(#back)" />
          <Rect x={u(NICHE.depth)} y={u(NICHE.depth)} width={nicheW - u(NICHE.depth) * 2} height={u(70)} fill="url(#ceilShade)" />
          <Polygon points={`0,0 ${u(NICHE.depth)},${u(NICHE.depth)} ${u(NICHE.depth)},${nicheH} 0,${nicheH}`} fill="url(#left)" />
          <Polygon points={`${nicheW},0 ${nicheW - u(NICHE.depth)},${u(NICHE.depth)} ${nicheW - u(NICHE.depth)},${nicheH} ${nicheW},${nicheH}`} fill="url(#right)" />
          <Polygon points={`0,0 ${nicheW},0 ${nicheW - u(NICHE.depth)},${u(NICHE.depth)} ${u(NICHE.depth)},${u(NICHE.depth)}`} fill="url(#ceil)" />
        </Svg>
      </View>

      {/* 책: 판 윗면에 발이 닿게(판 앞 끝보다 조금 안쪽) */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: u(NICHE.ledgeTop + 2), alignItems: 'center', justifyContent: 'flex-end' }}>
        <ShareBook book={ribbon} maxW={u(160)} maxH={u(214)} onReady={onReady} />
      </View>

      {/* 선반 판: 윗면 밝은 띠 + 앞면, 아래 벽에 떨어지는 그늘 */}
      <View style={{ position: 'absolute', left: u(NICHE.side - 1), right: u(NICHE.side - 1), top: u(NICHE.ledgeTop), height: u(NICHE.ledgeH), backgroundColor: shelf.plankFront, boxShadow: [{ offsetX: 0, offsetY: u(4), blurRadius: u(9), color: 'rgba(90,64,46,0.22)' }] }}>
        <View style={{ height: u(4.5), backgroundColor: shelf.plankTop, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: shelf.plankEdge }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: u(8), backgroundColor: shelf.plankLow, opacity: 0.6 }} />
      </View>

      <View style={{ paddingTop: u(382), paddingHorizontal: u(34), flex: 1 }}>
        <Text allowFontScaling={false} style={{ fontFamily: fonts.uiMedium, fontSize: u(14.5), lineHeight: u(20), color: ink, includeFontPadding: false }}>{data.status}</Text>
        <Text allowFontScaling={false} numberOfLines={2} style={{ fontFamily: fonts.uiTitle, fontSize: u(data.title.length > 18 ? 21 : 24), lineHeight: u(data.title.length > 18 ? 29 : 32), color: colors.ink, marginTop: u(5), includeFontPadding: false }}>{keepAll(data.title)}</Text>
        {data.author ? <Text allowFontScaling={false} numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: u(15), lineHeight: u(21), color: colors.inkSoft, marginTop: u(6), includeFontPadding: false }}>{data.author}</Text> : null}
        {note && nt ? <Text allowFontScaling={false} textBreakStrategy="highQuality" style={{ fontFamily: fonts.reading, fontSize: u(nt.size), lineHeight: u(nt.lh), color: '#2A2725', marginTop: u(22), includeFontPadding: false }}>{keepAll(note)}</Text> : null}
        {meta.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: u(8), marginTop: u(note ? 26 : 22) }}>
            {meta.map((m, i) => (
              <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {i > 0 ? <View style={{ width: StyleSheet.hairlineWidth * 2, height: u(18), backgroundColor: colors.line, marginHorizontal: u(19) }} /> : null}
                {m.star ? <Star size={u(15)} color={colors.inkSoft} fill={colors.inkSoft} strokeWidth={1} style={{ marginRight: u(7) }} /> : null}
                <Text allowFontScaling={false} style={{ fontFamily: fonts.ui, fontSize: u(14.5), lineHeight: u(20), color: colors.inkSoft, includeFontPadding: false, fontVariant: ['tabular-nums'] }}>{m.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1, minHeight: u(36) }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: u(16), paddingBottom: u(32) }}>
          <View style={{ width: u(18), height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.line }} />
          <Text allowFontScaling={false} style={{ fontFamily: fonts.ui, fontSize: u(13), lineHeight: u(18), color: '#8B95A1', includeFontPadding: false }}>책장 한켠</Text>
          <View style={{ width: u(18), height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.line }} />
        </View>
      </View>
    </View>
  );
}

// 공유 카드의 책은 늘 갈피 탭을 꽂는다(갈피 수만큼 1~2장)
function withRibbon(book: Book): Book {
  return { ...book, quotes: Math.max(1, book.quotes ?? 0), art: { ...book.art, ribbonVisible: true } };
}

// 고른 스킨(선반·틀·벽지) 색에서 칸·판 색을 만든다. 흰 틀·밝은 나무 판일 때 시안 값과 같다
function shelfColors() {
  const wall = SKIN.wall.color;
  const frame = SKIN.frame?.color ?? wall;
  const plank = SKIN.plank.color;
  return {
    wall,
    back: shade(frame, -0.015),
    backTop: shade(frame, -0.04),
    backLow: shade(plank, 0.45),
    shadow: '#4A3A30',
    ceilFront: shade(frame, -0.07),
    ceilBack: shade(frame, -0.13),
    leftFront: shade(frame, -0.01),
    leftBack: shade(frame, -0.07),
    rightFront: shade(frame, 0.35),
    rightBack: shade(frame, 0.05),
    plankTop: shade(plank, 0.62),
    plankEdge: shade(plank, -0.08),
    plankFront: shade(plank, -0.06),
    plankLow: shade(plank, -0.01),
  };
}

// 조금 돌려 세운 책 한 권(시안처럼 오른쪽 책배 두께가 보이게: 오른쪽 끝이 앞으로). 그림이 준비되면 캔버스를 그림으로 굳힌다
const SPIN = -9;
function spun(rest: Book3, spin: number): Book3 {
  const c = { x: rest.dims.T / 2, y: rest.dims.H / 2, z: rest.dims.W / 2 };
  const center = toWorld(rest, c);
  const r = rot(rest.roll, rest.yaw, c, spin, 0);
  return { ...rest, spin, t: { x: center.x - r.x, y: center.y - r.y, z: center.z - r.z } };
}

function ShareBook({ book: raw, maxW, maxH, onReady }: { book: Book; maxW: number; maxH: number; onReady?: () => void }) {
  const book = useMemo(() => (raw.coverArtUri ? { ...raw, coverArtUri: coverAtSize(raw.coverArtUri, 'XL') } : raw), [raw]);
  const frame = useMemo(() => standaloneFrame(book, 'front'), [book]);
  const cam = useMemo(() => frameCam(frame), [frame]);
  const rest = useMemo(() => fromPlaced(frame.box), [frame]);
  const pose = useMemo(() => spun(rest, SPIN), [rest]);
  const bb = useMemo(() => {
    const poly = outlineOf(cam, pose);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }, [cam, pose]);
  const out = ribbonDesign(book).out;
  const s = Math.min(maxW / bb.width, maxH / bb.height);
  const px = useMemo(() => ({ s, tx: (BOOK_PAD - bb.minX) * s, ty: (BOOK_PAD + out - bb.minY) * s }), [s, bb.minX, bb.minY, out]);
  const state = useSharedValue(pose);
  const camSV = useSharedValue(cam);
  useEffect(() => {
    state.value = pose;
    camSV.value = cam;
  }, [pose, cam, state, camSV]);
  const shared = useBookShared();
  // BookNode와 같은 값으로 물어 같은 그림(캐시)을 기다린다: 준비되면 몇 프레임 뒤 캔버스를 뜬다
  const art = useBookArt(book, s, rest.dims, shared);
  const canvas = useCanvasRef();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!art) return;
    let live = true;
    setUri(null);
    const t = setTimeout(() => {
      void canvas.current?.makeImageSnapshotAsync().then((img) => {
        if (live) setUri(`data:image/png;base64,${img.encodeToBase64()}`);
      }).catch(() => {});
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [art, s, canvas]);
  const w = (bb.width + BOOK_PAD * 2) * s;
  const h = (bb.height + out + BOOK_PAD * 2) * s;
  const top = (BOOK_PAD + out) * s;
  const left = BOOK_PAD * s;
  return (
    <View style={{ width: w, height: h, marginBottom: -BOOK_PAD * s }} accessible accessibilityLabel={`${book.title} 표지`}>
      {/* 뒷벽에 지는 그늘(왼쪽 앞에서 오는 빛) + 발밑 닿는 그늘 */}
      <View pointerEvents="none" style={{ position: 'absolute', left: left + bb.width * s * 0.08, top: top + bb.height * s * 0.04, width: bb.width * s * 0.92, height: bb.height * s * 0.95, borderRadius: 4, backgroundColor: 'rgba(120,100,90,0.18)', boxShadow: [{ offsetX: 9, offsetY: 2, blurRadius: 22, color: 'rgba(70,48,36,0.30)' }] }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: left + 2, width: bb.width * s - 2, top: top + bb.height * s - 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(60,40,28,0.16)', boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: 'rgba(60,40,28,0.22)' }] }} />
      <Canvas ref={canvas} style={StyleSheet.absoluteFill} pointerEvents="none">
        <BookNode book={book} dims={rest.dims} state={state} cam={camSV} px={px} shared={shared} />
      </Canvas>
      {uri ? <Image source={{ uri }} resizeMode="stretch" style={StyleSheet.absoluteFill} onLoad={onReady} /> : null}
    </View>
  );
}
